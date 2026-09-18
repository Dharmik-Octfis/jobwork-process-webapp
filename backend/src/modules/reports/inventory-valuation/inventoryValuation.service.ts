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
 * D5: goods received from job work are our stock at our location, so they count.
 * Stock at a processor, in transit or at a customer site is left out of both screens,
 * as before.
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
        u.unit_name AS "uomName",
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

    q = Prisma.sql`${q} GROUP BY i.id, i.name, i.category, i.sku, i.hsn_code, i.custom_fields, u.unit_name`;

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
    const perPage = _query.perPage || 25;
    const totalPages = Math.ceil(total / perPage);
    const paginatedRows = mappedRows.slice((page - 1) * perPage, page * perPage);

    return {
      results: paginatedRows,
      total,
      page,
      perPage,
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
  purchase_order: 'Purchase Order',
};

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
    const { fromDate, toDate } = _query;

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
      }[]
    >`
      SELECT
        l.posted_at AS "date",
        SUM(l.qty_in - l.qty_out) AS "qty",
        SUM(l.value_in - l.value_out) AS "value",
        l.source_doc_type AS "sourceDocType",
        l.source_doc_id AS "sourceDocId"
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.item_id = ${itemId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        AND ${OWN_PLACE}
        ${toDate ? Prisma.sql`AND l.posted_at <= ${new Date(toDate)}::timestamptz` : Prisma.empty}
      GROUP BY l.source_doc_type, l.source_doc_id, l.location_id, l.posted_at
      HAVING SUM(l.qty_in - l.qty_out) <> 0 OR SUM(l.value_in - l.value_out) <> 0
      ORDER BY l.posted_at ASC, MIN(l.created_at) ASC`;

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
      currentQty += qty;
      currentValue += value;

      if (isBeforeFromDate || isOpeningStockEntry) continue;

      const isSameAsPrevious =
        Boolean(entry.sourceDocId) && entry.sourceDocId === previousSourceDocId;
      previousSourceDocId = entry.sourceDocId;
      rows.push({
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
        uomName: item.stockingUom?.unitName || null,
      },
      rows,
    };
  });
}
