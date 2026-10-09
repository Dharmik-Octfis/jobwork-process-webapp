import { runAsTenant } from '../../../db/prisma.ts';
import type {
  InventoryValuationQuery,
  PaginatedInventoryValuationResponse,
  ItemLedgerQuery,
  ItemLedgerResponse,
} from './inventoryValuation.schemas.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { ApiError } from '../../../lib/apiError.ts';

/**
 * 🔴 VALUATION READS THE LEDGER'S OWN VALUE (docs/FIFO_COSTING_PLAN.md §5.2).
 *
 * Every outward row is costed FIFO when it is posted (`stock-ledger/costLayers.ts`),
 * so `SUM(value_in − value_out)` IS the FIFO valuation — one SUM, as of `posted_at`
 * for quantity and value alike. This file used to throw that value away and replay
 * FIFO in JavaScript on every load, per location on the Item Ledger and per item on
 * the Summary, so the two screens disagreed with each other and with the ledger.
 *
 * 🔴 A JOB RECEIPT COUNTS WHEN IT POSTS, at material + agreed charge (2026-09-23).
 * Job-work goods were ours all along, so — as in Tally and SAP — the job worker's
 * bill settles the charge and never gates or re-prices stock. Gating receipts on a
 * bill hid their stock while the next challan drawing on it still counted, which
 * drove these screens negative. Stock at a processor, in transit or at a customer
 * site is left out of both screens, as before.
 */
const OWN_PLACE = Prisma.sql`
  EXISTS (
    SELECT 1 FROM locations loc
    WHERE loc.id = l.location_id
    AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
  )`;

export async function getInventoryValuationSummary(
  organizationId: string,
  _query: InventoryValuationQuery,
): Promise<PaginatedInventoryValuationResponse> {
  return runAsTenant(organizationId, async (tx) => {
    type RawRow = {
      itemId: string;
      itemName: string;
      categoryName: string | null;
      uomName: string | null;
      sku: string | null;
      hsnCode: string | null;
      customFields: Record<string, unknown>;
      stockOnHand: string | number | bigint;
      inventoryAssetValue: string | number | bigint;
    };

    const {
      asOfDate,
      stockAvailability = 'none',
      status = 'all',
      itemName,
      categoryName,
      locationId,
      sku,
      hsnCode,
      itemCustomFields,
    } = _query;

    let q = Prisma.sql`
      SELECT
        i.id AS "itemId",
        i.name AS "itemName",
        i.category AS "categoryName",
        i.sku AS "sku",
        i.hsn_code AS "hsnCode",
        i.custom_fields AS "customFields",
        COALESCE(NULLIF(u.symbol, ''), u.unit_name) AS "uomName",
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS "stockOnHand",
        COALESCE(SUM(l.value_in - l.value_out), 0) AS "inventoryAssetValue"
      FROM items i
      LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
      LEFT JOIN stock_ledger l ON i.id = l.item_id
        AND l.organization_id = ${organizationId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        ${locationId ? Prisma.sql`AND l.location_id = ${locationId}::uuid` : Prisma.empty}
        AND ${OWN_PLACE}
    `;

    if (asOfDate) {
      q = Prisma.sql`${q} AND l.posted_at <= ${new Date(asOfDate)}::timestamptz`;
    }

    q = Prisma.sql`${q} WHERE i.organization_id = ${organizationId}::uuid AND i.is_deleted = false`;

    if (status === 'active') {
      q = Prisma.sql`${q} AND i.is_active = true`;
    } else if (status === 'inactive') {
      q = Prisma.sql`${q} AND i.is_active = false`;
    }

    if (itemName) {
      q = Prisma.sql`${q} AND i.name ILIKE ${'%' + itemName + '%'}`;
    }

    if (categoryName) {
      q = Prisma.sql`${q} AND i.category ILIKE ${'%' + categoryName + '%'}`;
    }

    if (sku) {
      q = Prisma.sql`${q} AND i.sku ILIKE ${'%' + sku + '%'}`;
    }

    if (hsnCode) {
      q = Prisma.sql`${q} AND i.hsn_code ILIKE ${'%' + hsnCode + '%'}`;
    }

    if (itemCustomFields) {
      for (const [key, val] of Object.entries(itemCustomFields)) {
        if (val !== undefined && val !== null && val !== '') {
          q = Prisma.sql`${q} AND i.custom_fields->>${key} ILIKE ${'%' + String(val) + '%'}`;
        }
      }
    }

    q = Prisma.sql`${q} GROUP BY i.id, i.name, i.category, i.sku, i.hsn_code, i.custom_fields, u.symbol, u.unit_name`;

    if (stockAvailability === 'gt') {
      q = Prisma.sql`${q} HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) > 0`;
    } else if (stockAvailability === 'lte') {
      q = Prisma.sql`${q} HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) <= 0`;
    } else if (stockAvailability === 'lt') {
      q = Prisma.sql`${q} HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) < 0`;
    } else if (stockAvailability === 'eq') {
      q = Prisma.sql`${q} HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) = 0`;
    } else if (stockAvailability === 'neq') {
      q = Prisma.sql`${q} HAVING COALESCE(SUM(l.qty_in - l.qty_out), 0) != 0`;
    }

    q = Prisma.sql`${q} ORDER BY i.name ASC`;

    const rawRows = await tx.$queryRaw<RawRow[]>`${q}`;

    const mappedRows = rawRows.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      sku: row.sku,
      hsnCode: row.hsnCode,
      customFields: row.customFields || {},
      uomName: row.uomName,
      stockOnHand: Number(row.stockOnHand),
      inventoryAssetValue: Number(row.inventoryAssetValue),
    }));

    const totalQty = mappedRows.reduce((sum, row) => sum + row.stockOnHand, 0);
    const totalValue = mappedRows.reduce((sum, row) => sum + row.inventoryAssetValue, 0);

    const total = mappedRows.length;
    const page = _query.page || 1;
    const perPage = _query.perPage;
    const paginatedRows = perPage
      ? mappedRows.slice((page - 1) * perPage, page * perPage)
      : mappedRows;
    const totalPages = perPage ? Math.ceil(total / perPage) : 1;

    return {
      results: paginatedRows,
      total,
      page: perPage ? page : 1,
      perPage: perPage ?? total,
      totalPages,
      grandTotalQty: totalQty,
      grandTotalValue: totalValue,
    };
  });
}

const DOC_LABELS: Record<string, string> = {
  bill: 'Bill',
  invoice: 'Invoice',
  job_receipt: 'Job Receipt',
  job_issue: 'Job Issue',
  job_order_step: 'Job Order Write-off',
  item_assembly: 'Assembly',
  inventory_adjustment: 'Stock Adjustment',
  purchase_order: 'Purchase Order',
};

// Documents whose cancel posts its reversals on the cancel date, so a group made
// only of reversals is the cancellation. Bills are absent: an edit's reversal
// carries the bill's own date and lands in the posting's group instead.
const CANCELLED_BY_REVERSAL = new Set([
  'job_issue',
  'job_receipt',
  'item_assembly',
  'inventory_adjustment',
]);

/**
 * One row per document per place per posting moment, at the value the ledger
 * posted — so the running value here always ends at the Summary's figure for the
 * same item and date. A bill edit's reversal carries the bill's own date, so it
 * lands in the same group as the posting it replaces and the bill shows once.
 */
export async function getItemLedger(
  organizationId: string,
  itemId: string,
  _query: ItemLedgerQuery,
): Promise<ItemLedgerResponse> {
  return runAsTenant(organizationId, async (tx) => {
    const { fromDate, toDate, locationId } = _query;

    const item = await tx.item.findFirst({
      where: { organizationId, id: itemId },
      include: { stockingUom: true },
    });

    if (!item) throw ApiError.notFound('Item not found');

    const entries = await tx.$queryRaw<
      {
        date: Date;
        qty: Prisma.Decimal;
        value: Prisma.Decimal;
        sourceDocType: string;
        sourceDocId: string | null;
        locationId: string;
        createdAt: Date;
        isReversal: boolean;
        valueOnly: boolean;
      }[]
    >`
      SELECT
        l.posted_at AS "date",
        SUM(l.qty_in - l.qty_out) AS "qty",
        SUM(l.value_in - l.value_out) AS "value",
        l.source_doc_type AS "sourceDocType",
        l.source_doc_id AS "sourceDocId",
        l.location_id AS "locationId",
        MIN(l.created_at) AS "createdAt",
        BOOL_AND(l.movement_type = 'reversal') AS "isReversal",
        BOOL_AND(l.qty_in = 0 AND l.qty_out = 0) AS "valueOnly"
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.item_id = ${itemId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        AND ${OWN_PLACE}
        ${toDate ? Prisma.sql`AND l.posted_at <= ${new Date(toDate)}::timestamptz` : Prisma.empty}
        ${locationId ? Prisma.sql`AND l.location_id = ${locationId}::uuid` : Prisma.empty}
      GROUP BY l.source_doc_type, l.source_doc_id, l.location_id, l.posted_at
      HAVING SUM(l.qty_in - l.qty_out) <> 0 OR SUM(l.value_in - l.value_out) <> 0
      ORDER BY l.posted_at ASC, MIN(l.created_at) ASC`;

    const outDocIds = [
      ...new Set(
        entries.filter((e) => Number(e.qty) < 0 && e.sourceDocId).map((e) => e.sourceDocId!),
      ),
    ];

    const draws =
      outDocIds.length > 0
        ? await tx.$queryRaw<
            {
              outDocId: string;
              qty: Prisma.Decimal;
              value: Prisma.Decimal;
              inDocType: string | null;
              inDocId: string | null;
            }[]
          >`
      SELECT
        o.source_doc_id AS "outDocId",
        SUM(d.qty) AS "qty",
        SUM(d.value) AS "value",
        i.source_doc_type AS "inDocType",
        i.source_doc_id AS "inDocId"
      FROM stock_layer_draws d
      JOIN stock_ledger o ON o.id = d.out_ledger_entry_id
      JOIN stock_cost_layers l ON l.id = d.layer_id
      LEFT JOIN stock_ledger i ON i.id = l.in_ledger_entry_id
      WHERE o.organization_id = ${organizationId}::uuid
        AND o.item_id = ${itemId}::uuid
        AND o.source_doc_id = ANY(${outDocIds}::uuid[])
        AND d.reversed_at IS NULL
      GROUP BY o.source_doc_id, i.source_doc_type, i.source_doc_id
      ORDER BY o.source_doc_id, MIN(l.in_date) ASC, MIN(l.in_seq) ASC
    `
        : [];

    const idsOf = (type: string) => [
      ...new Set(
        entries.filter((e) => e.sourceDocType === type && e.sourceDocId).map((e) => e.sourceDocId!),
      ),
    ];
    const docNumbers = new Map<string, string>();
    const issueIds = idsOf('job_issue');
    if (issueIds.length > 0) {
      const docs = await tx.jobIssue.findMany({
        where: { organizationId, id: { in: issueIds } },
        select: { id: true, challanNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.challanNumber));
    }
    const receiptIds = idsOf('job_receipt');
    if (receiptIds.length > 0) {
      const docs = await tx.jobReceipt.findMany({
        where: { organizationId, id: { in: receiptIds } },
        select: { id: true, receiptNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.receiptNumber));
    }
    const billIds = idsOf('bill');
    if (billIds.length > 0) {
      const docs = await tx.bill.findMany({
        where: { organizationId, id: { in: billIds } },
        select: { id: true, billNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.billNumber));
    }
    const assemblyIds = idsOf('item_assembly');
    if (assemblyIds.length > 0) {
      const docs = await tx.itemAssembly.findMany({
        where: { organizationId, id: { in: assemblyIds } },
        select: { id: true, assemblyNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.assemblyNumber));
    }
    // Read off the draws as well: stock an adjustment ADDED is what a later row draws on.
    const adjustmentIds = [
      ...new Set([
        ...idsOf('inventory_adjustment'),
        ...draws
          .filter((d) => d.inDocType === 'inventory_adjustment' && d.inDocId)
          .map((d) => d.inDocId!),
      ]),
    ];
    if (adjustmentIds.length > 0) {
      const docs = await tx.stockAdjustment.findMany({
        where: { organizationId, id: { in: adjustmentIds } },
        select: { id: true, adjustmentNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.adjustmentNumber));
    }
    const poIds = [
      ...new Set(
        draws.filter((d) => d.inDocType === 'purchase_order' && d.inDocId).map((d) => d.inDocId!),
      ),
    ];
    if (poIds.length > 0) {
      const docs = await tx.purchaseOrder.findMany({
        where: { organizationId, id: { in: poIds } },
        select: { id: true, poNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.poNumber));
    }
    const invoiceIds = idsOf('invoice');
    if (invoiceIds.length > 0) {
      const docs = await tx.invoice.findMany({
        where: { organizationId, id: { in: invoiceIds } },
        select: { id: true, invoiceNumber: true },
      });
      docs.forEach((d) => docNumbers.set(d.id, d.invoiceNumber));
    }

    /**
     * A value adjustment prints like Zoho's: per purchase entry it changed, the
     * stock out at the old rate and back in at the new one (value plan §8). Read
     * from what it did to each layer — its ledger rows carry value only.
     */
    const valueDocIds = [
      ...new Set(
        entries
          .filter((e) => e.valueOnly && e.sourceDocType === 'inventory_adjustment' && e.sourceDocId)
          .map((e) => e.sourceDocId!),
      ),
    ];
    const revaluations = valueDocIds.length
      ? await tx.$queryRaw<
          {
            docId: string;
            locationId: string;
            qty: Prisma.Decimal;
            valueBefore: Prisma.Decimal;
            valueAfter: Prisma.Decimal;
          }[]
        >`
          SELECT e.source_doc_id AS "docId", e.location_id AS "locationId",
                 SUM(r.qty) AS qty,
                 SUM(r.value_before) AS "valueBefore",
                 SUM(r.value_after) AS "valueAfter"
          FROM stock_layer_revaluations r
          JOIN stock_ledger e ON e.id = r.ledger_entry_id
          JOIN stock_cost_layers c ON c.id = r.layer_id
          LEFT JOIN stock_ledger ie ON ie.id = c.in_ledger_entry_id
          WHERE e.organization_id = ${organizationId}::uuid
            AND e.item_id = ${itemId}::uuid
            AND e.source_doc_type = 'inventory_adjustment'
            AND e.source_doc_id = ANY(${valueDocIds}::uuid[])
          GROUP BY e.source_doc_id, e.location_id, ie.source_doc_type, ie.source_doc_id,
                   c.in_date, CASE WHEN ie.id IS NULL THEN c.id END
          ORDER BY MIN(c.in_date) DESC`
      : [];
    const pairsOf = new Map<string, typeof revaluations>();
    for (const row of revaluations) {
      const key = `${row.docId}|${row.locationId}`;
      pairsOf.set(key, [...(pairsOf.get(key) ?? []), row]);
    }

    const drawsByOutDocId = new Map<string, { label: string; qty: number; value: number }[]>();
    for (const draw of draws) {
      const type = draw.inDocType;
      const id = draw.inDocId;
      const labelType =
        type === 'item_opening_stock'
          ? 'Opening Stock'
          : type
            ? (DOC_LABELS[type] ?? type)
            : 'Opening Stock';
      let label = labelType;
      if (id && docNumbers.has(id)) {
        label = `${labelType} # ${docNumbers.get(id)}`;
      }
      const arr = drawsByOutDocId.get(draw.outDocId) || [];
      arr.push({ label, qty: Number(draw.qty), value: Number(draw.value) });
      drawsByOutDocId.set(draw.outDocId, arr);
    }

    const rows: ItemLedgerResponse['rows'] = [];
    let currentQty = 0;
    let currentValue = 0;
    let previousSourceDocId: string | null = null;
    let hasAddedOpeningRow = false;
    const fromDateTime = fromDate ? new Date(fromDate).getTime() : 0;

    const openingRow = () => ({
      date: null,
      transactionDetails: '*** Opening Stock ***',
      quantity: 0,
      unitCost: null,
      totalCost: 0,
      stockOnHand: currentQty,
      inventoryAssetValue: currentValue,
      isOpeningStock: true,
    });

    for (const entry of entries) {
      const isBeforeFromDate = fromDate && entry.date.getTime() < fromDateTime;
      // Opening stock is folded into the opening row rather than listed.
      const isOpeningStockEntry = entry.sourceDocType === 'item_opening_stock';

      if (!isBeforeFromDate && !isOpeningStockEntry && !hasAddedOpeningRow) {
        rows.push(openingRow());
        hasAddedOpeningRow = true;
      }

      const qty = Number(entry.qty);
      const value = Number(entry.value);

      if (isBeforeFromDate || isOpeningStockEntry) {
        currentQty += qty;
        currentValue += value;
        continue;
      }

      const isSameAsPrevious =
        Boolean(entry.sourceDocId) && entry.sourceDocId === previousSourceDocId;
      previousSourceDocId = entry.sourceDocId;

      const entryDraws =
        qty < 0 && entry.sourceDocId ? drawsByOutDocId.get(entry.sourceDocId) : null;
      const pairs =
        entry.valueOnly && entry.sourceDocId
          ? pairsOf.get(`${entry.sourceDocId}|${entry.locationId}`)
          : undefined;

      if (pairs && pairs.length > 0) {
        // A cancellation is its own event even straight after the posting.
        const head = !isSameAsPrevious || entry.isReversal;
        for (const [index, pair] of pairs.entries()) {
          const q = Number(pair.qty);
          // A cancellation is the mirror: out at the new rate, back in at the old.
          const [outValue, inValue] = entry.isReversal
            ? [Number(pair.valueAfter), Number(pair.valueBefore)]
            : [Number(pair.valueBefore), Number(pair.valueAfter)];
          const first = head && index === 0;
          currentValue += inValue - outValue;
          rows.push({
            isCancellation: first && entry.isReversal,
            date: first ? entry.date.toISOString() : null,
            transactionDetails: first ? 'Inventory Adjustment By Value' : '',
            quantity: -q,
            unitCost: Math.abs(outValue / q),
            totalCost: -outValue,
            stockOnHand: null,
            inventoryAssetValue: null,
            sourceDocType: first ? entry.sourceDocType : null,
            sourceDocId: first ? entry.sourceDocId : null,
            sourceDocNumber: first ? docNumbers.get(entry.sourceDocId!) || null : null,
          });
          rows.push({
            date: null,
            transactionDetails: '',
            quantity: q,
            unitCost: Math.abs(inValue / q),
            totalCost: inValue,
            stockOnHand: currentQty,
            inventoryAssetValue: currentValue,
            sourceDocType: null,
            sourceDocId: null,
            sourceDocNumber: null,
          });
        }
      } else if (entryDraws && entryDraws.length > 0) {
        let first = true;
        for (const draw of entryDraws) {
          const drawQty = -draw.qty; // draw qty is positive, we want outflow to be negative
          const drawValue = -draw.value;
          currentQty += drawQty;
          currentValue += drawValue;

          rows.push({
            isCancellation:
              !isSameAsPrevious &&
              first &&
              entry.isReversal &&
              CANCELLED_BY_REVERSAL.has(entry.sourceDocType),
            date: !isSameAsPrevious && first ? entry.date.toISOString() : null,
            transactionDetails:
              !isSameAsPrevious && first
                ? (DOC_LABELS[entry.sourceDocType] ?? entry.sourceDocType)
                : '',
            quantity: drawQty,
            unitCost: drawQty !== 0 ? Math.abs(drawValue / drawQty) : null,
            totalCost: drawValue,
            stockOnHand: currentQty,
            inventoryAssetValue: currentValue,
            sourceDocType: !isSameAsPrevious && first ? entry.sourceDocType : null,
            sourceDocId: !isSameAsPrevious && first ? entry.sourceDocId : null,
            sourceDocNumber:
              !isSameAsPrevious && first
                ? entry.sourceDocId
                  ? docNumbers.get(entry.sourceDocId) || null
                  : null
                : null,
          });
          first = false;
        }
      } else {
        currentQty += qty;
        currentValue += value;

        rows.push({
          isCancellation:
            !isSameAsPrevious && entry.isReversal && CANCELLED_BY_REVERSAL.has(entry.sourceDocType),
          date: isSameAsPrevious ? null : entry.date.toISOString(),
          transactionDetails: isSameAsPrevious
            ? ''
            : (DOC_LABELS[entry.sourceDocType] ?? entry.sourceDocType),
          quantity: qty,
          unitCost: qty !== 0 ? Math.abs(value / qty) : null,
          totalCost: value,
          stockOnHand: currentQty,
          inventoryAssetValue: currentValue,
          sourceDocType: isSameAsPrevious ? null : entry.sourceDocType,
          sourceDocId: isSameAsPrevious ? null : entry.sourceDocId,
          sourceDocNumber: isSameAsPrevious
            ? null
            : entry.sourceDocId
              ? docNumbers.get(entry.sourceDocId) || null
              : null,
        });
      }
    }

    if (!hasAddedOpeningRow) rows.push(openingRow());

    rows.push({
      date: null,
      transactionDetails: '*** Closing Stock ***',
      quantity: 0,
      unitCost: null,
      totalCost: 0,
      stockOnHand: currentQty,
      inventoryAssetValue: currentValue,
      isClosingStock: true,
    });

    return {
      itemInfo: {
        itemName: item.name,
        sku: item.sku,
        uomName: item.stockingUom?.symbol || item.stockingUom?.unitName || null,
      },
      rows,
    };
  });
}
