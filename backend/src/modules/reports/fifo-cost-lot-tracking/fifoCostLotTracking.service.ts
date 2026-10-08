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
 * one document's `stock_cost_layers` at one cost (see `Lot` below), and what it
 * dispersed is exactly the draws the postings made on them — at the lot's real cost.
 *
 * Only own stock at our own places has layers, so customer-owned and physical-only
 * movements no longer appear (valuation never counted them either). A document's
 * corrections of itself — an edited bill taking its old layer back, a cancelled
 * receipt withdrawing its output — are netted out rather than listed as dispersals.
 *
 * 🔴 A VALUE ADJUSTMENT RE-LOTS THE STOCK IT CHANGED, as Zoho prints it: the lots it
 * touched disperse their remaining quantity to it, and it is a new lot of that
 * quantity at the new cost. Draws made after it are that new lot's dispersals. The
 * layers themselves are only revalued in place (`revalueLayers`) — this is the view.
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
  createdAt: Date;
  /** The stock a value adjustment re-lotted, not a draw. */
  byValue?: boolean;
}

interface RevaluationRow {
  layerId: string;
  qty: Prisma.Decimal;
  valueAfter: Prisma.Decimal;
  docId: string;
  date: Date;
  createdAt: Date;
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
const VALUE_ADJUSTMENT_LABEL = 'Inventory Adjustment By Value';

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
        COALESCE(NULLIF(u.symbol, ''), u.unit_name) AS "uomName",
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
            o.posted_at AS "outDate",
            d.created_at AS "createdAt"
          FROM stock_layer_draws d
          JOIN stock_ledger o ON o.id = d.out_ledger_entry_id
          WHERE d.organization_id = ${organizationId}::uuid
            AND d.reversed_at IS NULL
            AND d.layer_id = ANY(${layers.map((layer) => layer.id)}::uuid[])
          ORDER BY o.posted_at ASC, d.created_at ASC`
      : [];

    // Value adjustments still standing on these layers, in the order they were made.
    const revaluations = layers.length
      ? await tx.$queryRaw<RevaluationRow[]>`
          SELECT r.layer_id AS "layerId", r.qty, r.value_after AS "valueAfter",
                 e.source_doc_id AS "docId", e.posted_at AS "date", r.created_at AS "createdAt"
          FROM stock_layer_revaluations r
          JOIN stock_ledger e ON e.id = r.ledger_entry_id
          WHERE r.organization_id = ${organizationId}::uuid
            AND r.reversed_at IS NULL
            AND r.layer_id = ANY(${layers.map((layer) => layer.id)}::uuid[])
          ORDER BY r.created_at ASC`
      : [];
    const revaluationsByLayer = new Map<string, RevaluationRow[]>();
    for (const row of revaluations) {
      revaluationsByLayer.set(row.layerId, [...(revaluationsByLayer.get(row.layerId) ?? []), row]);
    }

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
      ...revaluations.map((row) => ({ type: 'inventory_adjustment', id: row.docId })),
    ]);

    const describe = (type: string | null, id: string | null, byValue = false) => {
      const label = byValue
        ? VALUE_ADJUSTMENT_LABEL
        : type
          ? (DOC_LABELS[type] ?? type)
          : 'FIFO Cut-over Balance';
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
    const ZERO = new Prisma.Decimal(0);

    /**
     * 🔴 A LOT IS ONE DOCUMENT'S STOCK AT ONE COST, not one layer (2026-09-23). A
     * receipt or bill putting 100 into two batches writes two layers of 50; listing
     * them separately showed "50" beside a Summary saying 100 (JR-00085). Layers of
     * the same item, document, date and unit cost are one lot; a different cost stays
     * its own lot. Cut-over balances carry no document and stay one per layer. A
     * value adjustment is one lot per item, at the blended cost of what it re-lotted.
     */
    interface Lot {
      key: string;
      itemId: string;
      itemName: string;
      uomName: string | null;
      inDate: Date;
      inDocType: string | null;
      inDocId: string | null;
      byValue: boolean;
      qty: Prisma.Decimal;
      value: Prisma.Decimal;
      remaining: Prisma.Decimal;
      dispersals: DrawRow[];
    }
    const lots = new Map<string, Lot>();
    const lotFor = (
      key: string,
      layer: LayerRow,
      opened: Pick<Lot, 'inDate' | 'inDocType' | 'inDocId' | 'byValue'>,
    ): Lot => {
      const lot = lots.get(key) ?? {
        key,
        itemId: layer.itemId,
        itemName: layer.itemName,
        uomName: layer.uomName,
        ...opened,
        qty: ZERO,
        value: ZERO,
        remaining: ZERO,
        dispersals: [],
      };
      lots.set(key, lot);
      return lot;
    };
    const disperse = (lot: Lot, draw: DrawRow) => {
      // One challan drawing on both layers of a lot is one dispersal of that lot.
      const same = draw.outDocId
        ? lot.dispersals.find(
            (row) =>
              row.outDocType === draw.outDocType &&
              row.outDocId === draw.outDocId &&
              Boolean(row.byValue) === Boolean(draw.byValue),
          )
        : undefined;
      if (same) same.qty = same.qty.plus(draw.qty);
      else lot.dispersals.push({ ...draw });
    };

    for (const layer of layers) {
      // A document taking back its own layer is a correction of itself, not a
      // dispersal: an edited bill's old lot, a cancelled receipt's output.
      const own = (draw: DrawRow) =>
        draw.outDocType === layer.inDocType && draw.outDocId === layer.inDocId;
      const layerDraws = drawsByLayer.get(layer.id) ?? [];
      const selfTaken = layerDraws.filter(own).reduce((sum, draw) => sum.plus(draw.qty), ZERO);
      const lotQty = layer.qty.minus(selfTaken);
      if (!lotQty.greaterThan(0)) continue;

      const unitCost = layer.qty.isZero() ? ZERO : layer.value.dividedBy(layer.qty);
      const key = layer.inDocId
        ? [
            layer.itemId,
            layer.inDocType,
            layer.inDocId,
            layer.inDate.toISOString(),
            unitCost.toFixed(4),
          ].join('|')
        : layer.id;
      const original = lotFor(key, layer, {
        inDate: layer.inDate,
        inDocType: layer.inDocType,
        inDocId: layer.inDocId,
        byValue: false,
      });
      original.qty = original.qty.plus(lotQty);
      original.value = original.value.plus(unitCost.times(lotQty));

      // Each value adjustment takes what is left of the layer out of the lot before
      // it and opens a lot of its own at the new cost.
      const revs = revaluationsByLayer.get(layer.id) ?? [];
      const chain = [original];
      for (const rev of revs) {
        const relot = lotFor(`value|${layer.itemId}|${rev.docId}`, layer, {
          inDate: rev.date,
          inDocType: 'inventory_adjustment',
          inDocId: rev.docId,
          byValue: true,
        });
        disperse(chain[chain.length - 1]!, {
          layerId: layer.id,
          qty: rev.qty,
          outDocType: 'inventory_adjustment',
          outDocId: rev.docId,
          outDate: rev.date,
          createdAt: rev.createdAt,
          byValue: true,
        });
        relot.qty = relot.qty.plus(rev.qty);
        relot.value = relot.value.plus(rev.valueAfter);
        chain.push(relot);
      }
      chain[chain.length - 1]!.remaining = chain[chain.length - 1]!.remaining.plus(
        layer.remainingQty,
      );

      for (const draw of layerDraws.filter((row) => !own(row))) {
        // A draw belongs to the lot in force when it was made — the clock, not the
        // posting date, since either can be backdated.
        const after = revs.filter((rev) => rev.createdAt <= draw.createdAt).length;
        disperse(chain[after]!, draw);
      }
    }

    // Lots a value adjustment opened sit by date among their item's other lots.
    const itemOrder = new Map<string, number>();
    for (const layer of layers) {
      if (!itemOrder.has(layer.itemId)) itemOrder.set(layer.itemId, itemOrder.size);
    }
    const ordered = [...lots.values()].sort(
      (a, b) =>
        itemOrder.get(a.itemId)! - itemOrder.get(b.itemId)! ||
        a.inDate.getTime() - b.inDate.getTime(),
    );

    const rows: FifoCostLotTrackingRow[] = [];
    let currentItemId = '';

    for (const lot of ordered) {
      const unitCost = lot.qty.isZero() ? ZERO : lot.value.dividedBy(lot.qty);
      const inDoc = describe(lot.inDocType, lot.inDocId, lot.byValue);
      const age = differenceInDays(new Date(), lot.inDate);
      const inCols = {
        lotKey: lot.key,
        inDate: format(lot.inDate, 'dd-MM-yyyy'),
        inTransaction: inDoc.transaction,
        inReceivedFrom: inDoc.partyName,
        inQty: qty(lot.qty),
        inQtyUnit: lot.uomName ?? 'unit',
        inQtyRemaining: qty(lot.remaining),
        inAge: age > 0 ? `${age} Days` : '',
        inCost: unitCost.toFixed(2),
        inTotal: lot.value.toFixed(2),
        inDocType: lot.inDocType ?? '',
        inDocId: lot.inDocId ?? '',
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
        const outDoc = describe(draw.outDocType, draw.outDocId, draw.byValue);
        return {
          outDate: format(draw.outDate, 'dd-MM-yyyy'),
          outTransaction: outDoc.transaction,
          outDispersedTo: outDoc.partyName,
          outQty: qty(draw.qty),
          outQtyUnit: lot.uomName ?? 'unit',
          outDocType: draw.outDocType,
          outDocId: draw.outDocId ?? '',
          outPartyId: outDoc.partyId,
          outPartyType: outDoc.partyType,
        };
      };

      const timeline = lot.dispersals
        .sort(
          (a, b) =>
            a.outDate.getTime() - b.outDate.getTime() ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((draw) => ({ date: draw.outDate, cols: outCols(draw) }));

      const inPeriod = timeline
        .filter((row) => inRange(row.date))
        .map((row) => ({ ...inCols, ...row.cols }));
      // A lot carried into the period still lists what drew on it inside the period —
      // otherwise an adjustment or issue this month against older stock vanished.
      const printed = isProductOut
        ? inPeriod
        : inRange(lot.inDate)
          ? timeline.length
            ? timeline.map((row) => ({ ...inCols, ...row.cols }))
            : [{ ...inCols, ...noOut }]
          : lot.inDate.getTime() < from
            ? inPeriod
            : [];

      for (const row of printed) {
        rows.push({ ...row, itemName: lot.itemId !== currentItemId ? lot.itemName : '' });
        currentItemId = lot.itemId;
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
  const adjustmentIds = idsOf('inventory_adjustment');
  if (adjustmentIds.length) {
    const docs = await tx.stockAdjustment.findMany({
      where: { id: { in: adjustmentIds } },
      select: { id: true, adjustmentNumber: true },
    });
    docs.forEach((d) =>
      info.set(d.id, {
        number: d.adjustmentNumber,
        partyName: null,
        partyId: null,
        partyType: null,
      }),
    );
  }
  const invoiceIds = idsOf('invoice');
  if (invoiceIds.length) {
    const docs = await tx.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        customer: { select: { contactName: true } },
      },
    });
    docs.forEach((d) =>
      info.set(d.id, {
        number: d.invoiceNumber,
        partyName: d.customer?.contactName || null,
        partyId: d.customerId,
        partyType: 'customer',
      }),
    );
  }
  return info;
}
