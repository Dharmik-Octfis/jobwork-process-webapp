import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  FifoCostLotTrackingQuery,
  FifoCostLotTrackingRow,
  PaginatedFifoCostLotTrackingResponse,
} from './fifoCostLotTracking.schemas.ts';
import { format, differenceInDays } from 'date-fns';

/**
 * 🔴 THE LOTS ARE THE COST LAYERS (docs/FIFO_COSTING_PLAN.md §5.2).
 *
 * This report used to pair inward and outward quantities by replaying FIFO in
 * JavaScript, and never priced an outflow at all. Now every row is fact: a lot is
 * one `stock_cost_layers` row, and what it dispersed is exactly the draws the
 * postings made on it — at the lot's real cost.
 *
 * Only own stock at our own places has layers, so customer-owned and physical-only
 * movements no longer appear (valuation never counted them either). A document's
 * corrections of itself — an edited bill taking its old layer back, a cancelled
 * receipt withdrawing its output — are netted out rather than listed as dispersals.
 */

interface LayerRow {
  id: string;
  itemId: string;
  itemName: string;
  uomName: string | null;
  inDate: Date;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  remainingQty: Prisma.Decimal;
  isLegacy: boolean;
  inDocType: string | null;
  inDocId: string | null;
}

interface DrawRow {
  layerId: string;
  qty: Prisma.Decimal;
  outDocType: string;
  outDocId: string | null;
  outDate: Date;
}

const DOC_LABELS: Record<string, string> = {
  bill: 'Bill',
  invoice: 'Invoice',
  job_receipt: 'Job Receipt',
  job_issue: 'Job Issue',
  job_order_step: 'Job Order Write-off',
  purchase_order: 'Purchase Order',
  item_opening_stock: 'Opening Balance',
  inventory_adjustment: 'Inventory Adjustment By Quantity',
  item_assembly: 'Assemblies',
};

export async function getFifoCostLotTracking(
  organizationId: string,
  _query: FifoCostLotTrackingQuery,
): Promise<PaginatedFifoCostLotTrackingResponse> {
  return runAsTenant<PaginatedFifoCostLotTrackingResponse>(organizationId, async (tx) => {
    const { fromDate, toDate, itemName, locationName, reportBasis } = _query;
    const isProductOut = reportBasis === 'product_out';

    const layers = await tx.$queryRaw<LayerRow[]>`
      SELECT
        l.id,
        l.item_id AS "itemId",
        i.name AS "itemName",
        u.unit_name AS "uomName",
        l.in_date AS "inDate",
        l.qty,
        l.value,
        l.remaining_qty AS "remainingQty",
        l.is_legacy AS "isLegacy",
        e.source_doc_type AS "inDocType",
        e.source_doc_id AS "inDocId"
      FROM stock_cost_layers l
      JOIN items i ON i.id = l.item_id
      LEFT JOIN units_of_measurement u ON u.id = i.stocking_uom_id
      JOIN locations loc ON loc.id = l.location_id
      LEFT JOIN stock_ledger e ON e.id = l.in_ledger_entry_id
      -- a job receipt is a lot from the day it posts; its bill settles the charge only
      WHERE l.organization_id = ${organizationId}::uuid
        AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
        ${itemName ? Prisma.sql`AND i.name ILIKE ${'%' + itemName + '%'}` : Prisma.empty}
        ${locationName ? Prisma.sql`AND loc.name ILIKE ${'%' + locationName + '%'}` : Prisma.empty}
      ORDER BY i.name ASC, l.in_date ASC, l.in_seq ASC`;

    const draws = layers.length
      ? await tx.$queryRaw<DrawRow[]>`
          SELECT
            d.layer_id AS "layerId",
            d.qty,
            o.source_doc_type AS "outDocType",
            o.source_doc_id AS "outDocId",
            o.posted_at AS "outDate"
          FROM stock_layer_draws d
          JOIN stock_ledger o ON o.id = d.out_ledger_entry_id
          WHERE d.organization_id = ${organizationId}::uuid
            AND d.reversed_at IS NULL
            AND d.layer_id = ANY(${layers.map((layer) => layer.id)}::uuid[])
          ORDER BY o.posted_at ASC, d.created_at ASC`
      : [];

    const drawsByLayer = new Map<string, DrawRow[]>();
    for (const draw of draws) {
      drawsByLayer.set(draw.layerId, [...(drawsByLayer.get(draw.layerId) ?? []), draw]);
    }

    const docInfo = await describeParties(tx, [
      ...layers.flatMap((layer) =>
        layer.inDocType && layer.inDocId ? [{ type: layer.inDocType, id: layer.inDocId }] : [],
      ),
      ...draws.flatMap((draw) =>
        draw.outDocId ? [{ type: draw.outDocType, id: draw.outDocId }] : [],
      ),
    ]);

    const describe = (type: string | null, id: string | null) => {
      const label = type ? (DOC_LABELS[type] ?? type) : 'FIFO Cut-over Balance';
      const info = id ? docInfo.get(id) : undefined;
      return {
        transaction: info ? `${label} # ${info.number}` : label,
        partyName: info?.partyName ?? '',
        partyId: info?.partyId ?? null,
        partyType: info?.partyId ? info.partyType : null,
      };
    };

    const from = fromDate ? new Date(fromDate).getTime() : -Infinity;
    const to = toDate ? new Date(toDate).getTime() : Infinity;
    const inRange = (date: Date) => date.getTime() >= from && date.getTime() <= to;
    const qty = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(4));

    const rows: FifoCostLotTrackingRow[] = [];
    let currentItemId = '';

    for (const layer of layers) {
      // A document taking back its own layer is a correction of itself, not a
      // dispersal: an edited bill's old lot, a cancelled receipt's output.
      const own = (draw: DrawRow) =>
        draw.outDocType === layer.inDocType && draw.outDocId === layer.inDocId;
      const layerDraws = drawsByLayer.get(layer.id) ?? [];
      const selfTaken = layerDraws
        .filter(own)
        .reduce((sum, draw) => sum.plus(draw.qty), new Prisma.Decimal(0));
      const lotQty = layer.qty.minus(selfTaken);
      if (!lotQty.greaterThan(0)) continue;
      const dispersals = layerDraws.filter((draw) => !own(draw));

      const inDoc = describe(layer.inDocType, layer.inDocId);
      const unitCost = layer.qty.isZero()
        ? new Prisma.Decimal(0)
        : layer.value.dividedBy(layer.qty);
      const age = differenceInDays(new Date(), layer.inDate);
      const inCols = {
        inDate: format(layer.inDate, 'dd-MM-yyyy'),
        inTransaction: inDoc.transaction,
        inReceivedFrom: inDoc.partyName,
        inQty: qty(lotQty),
        inQtyUnit: layer.uomName ?? 'unit',
        inQtyRemaining: qty(layer.remainingQty),
        inAge: age > 0 ? `${age} Days` : '',
        inCost: unitCost.toFixed(2),
        inTotal: unitCost.times(lotQty).toFixed(2),
        inDocType: layer.inDocType ?? '',
        inDocId: layer.inDocId ?? '',
        inPartyId: inDoc.partyId,
        inPartyType: inDoc.partyType,
      };
      const noOut = {
        outDate: null,
        outTransaction: '',
        outDispersedTo: '',
        outQty: null,
        outQtyUnit: '',
        outDocType: '',
        outDocId: '',
        outPartyId: null,
        outPartyType: null,
      };
      const outCols = (draw: DrawRow) => {
        const outDoc = describe(draw.outDocType, draw.outDocId);
        return {
          outDate: format(draw.outDate, 'dd-MM-yyyy'),
          outTransaction: outDoc.transaction,
          outDispersedTo: outDoc.partyName,
          outQty: qty(draw.qty),
          outQtyUnit: layer.uomName ?? 'unit',
          outDocType: draw.outDocType,
          outDocId: draw.outDocId ?? '',
          outPartyId: outDoc.partyId,
          outPartyType: outDoc.partyType,
        };
      };

      const printed = isProductOut
        ? dispersals
            .filter((draw) => inRange(draw.outDate))
            .map((draw) => ({ ...inCols, ...outCols(draw) }))
        : inRange(layer.inDate)
          ? dispersals.length
            ? dispersals.map((draw) => ({ ...inCols, ...outCols(draw) }))
            : [{ ...inCols, ...noOut }]
          : [];

      for (const row of printed) {
        rows.push({ ...row, itemName: layer.itemId !== currentItemId ? layer.itemName : '' });
        currentItemId = layer.itemId;
      }
    }

    const total = rows.length;
    const page = _query.page || 1;
    const perPage = _query.perPage || 25;
    const totalPages = Math.ceil(total / perPage);
    const paginatedRows = rows.slice((page - 1) * perPage, page * perPage);

    return {
      results: paginatedRows,
      total,
      page,
      perPage,
      totalPages,
    };
  });
}

type PartyInfo = {
  number: string;
  partyName: string | null;
  partyId: string | null;
  partyType: 'vendor' | 'customer' | null;
};

/** Document numbers and parties, one query per document type that appears. */
async function describeParties(
  tx: TenantClient,
  refs: readonly { type: string; id: string }[],
): Promise<Map<string, PartyInfo>> {
  const idsOf = (type: string) => [
    ...new Set(refs.filter((ref) => ref.type === type).map((ref) => ref.id)),
  ];
  const info = new Map<string, PartyInfo>();

  const issueIds = idsOf('job_issue');
  if (issueIds.length) {
    const docs = await tx.jobIssue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, challanNumber: true, processorNameSnapshot: true, processorId: true },
    });
    docs.forEach((d) =>
      info.set(d.id, {
        number: d.challanNumber,
        partyName: d.processorNameSnapshot,
        partyId: d.processorId,
        partyType: 'customer',
      }),
    );
  }
  const receiptIds = idsOf('job_receipt');
  if (receiptIds.length) {
    const docs = await tx.jobReceipt.findMany({
      where: { id: { in: receiptIds } },
      select: { id: true, receiptNumber: true, processorNameSnapshot: true, processorId: true },
    });
    docs.forEach((d) =>
      info.set(d.id, {
        number: d.receiptNumber,
        partyName: d.processorNameSnapshot,
        partyId: d.processorId,
        partyType: 'customer',
      }),
    );
  }
  const billIds = idsOf('bill');
  if (billIds.length) {
    const docs = await tx.bill.findMany({
      where: { id: { in: billIds } },
      select: {
        id: true,
        billNumber: true,
        vendorId: true,
        vendor: { select: { contactName: true } },
      },
    });
    docs.forEach((d) =>
      info.set(d.id, {
        number: d.billNumber,
        partyName: d.vendor?.contactName || null,
        partyId: d.vendorId,
        partyType: 'vendor',
      }),
    );
  }
  const assemblyIds = idsOf('item_assembly');
  if (assemblyIds.length) {
    const docs = await tx.itemAssembly.findMany({
      where: { id: { in: assemblyIds } },
      select: { id: true, assemblyNumber: true },
    });
    docs.forEach((d) =>
      info.set(d.id, { number: d.assemblyNumber, partyName: null, partyId: null, partyType: null }),
    );
  }
  return info;
}
