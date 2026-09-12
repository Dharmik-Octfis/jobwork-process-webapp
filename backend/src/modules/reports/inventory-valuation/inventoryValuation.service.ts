import { runAsTenant } from '../../../db/prisma.ts';
import type { InventoryValuationQuery, PaginatedInventoryValuationResponse, ItemLedgerQuery, ItemLedgerResponse } from './inventoryValuation.schemas.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';

export async function getInventoryValuationSummary(
  organizationId: string,
  _query: InventoryValuationQuery
): Promise<PaginatedInventoryValuationResponse> {
  return runAsTenant(organizationId, async (tx) => {
    // Determine the date filter. The UI passes dd-MM-yyyy or similar? We should probably just use current date if not provided
    // For now we will fetch all ledger entries up to the provided date. If not provided, fetch all.
    
    // Using a raw query to join items and stock_ledger efficiently and calculate sums
    type RawRow = {
      itemId: string;
      itemName: string;
      categoryName: string | null;
      uomName: string | null;
      stockOnHand: string | number | bigint;
      inventoryAssetValue: string | number | bigint;
    };

    const { asOfDate, stockAvailability = 'none', status = 'all', itemName, categoryName } = _query;

    let q = Prisma.sql`
      SELECT 
        i.id AS "itemId",
        i.name AS "itemName",
        i.category AS "categoryName",
        u.unit_name AS "uomName",
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS "stockOnHand",
        COALESCE(SUM(l.value_in - l.value_out), 0) AS "inventoryAssetValue"
      FROM items i
      LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
      LEFT JOIN stock_ledger l ON i.id = l.item_id 
        AND l.organization_id = ${organizationId}::uuid 
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        AND EXISTS (
          SELECT 1 FROM locations loc 
          WHERE loc.id = l.location_id 
          AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
        )
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

    q = Prisma.sql`${q} GROUP BY i.id, i.name, i.category, u.unit_name`;

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

    const mappedRows = rawRows.map(row => ({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
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

export async function getItemLedger(
  organizationId: string,
  itemId: string,
  _query: ItemLedgerQuery
): Promise<ItemLedgerResponse> {
  return runAsTenant(organizationId, async (tx) => {
    const { fromDate, toDate } = _query;

    const item = await tx.item.findFirst({
      where: { organizationId, id: itemId },
      include: { stockingUom: true }
    });

    if (!item) {
      throw new Error('Item not found');
    }

    // Opening Stock
    let openingQty = 0;
    let openingValue = 0;

    let openingQ = Prisma.sql`
      SELECT 
        COALESCE(SUM(l.qty_in - l.qty_out), 0) AS "qty",
        COALESCE(SUM(l.value_in - l.value_out), 0) AS "value"
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.item_id = ${itemId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        AND EXISTS (
          SELECT 1 FROM locations loc 
          WHERE loc.id = l.location_id 
          AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
        )
    `;

    if (fromDate) {
      openingQ = Prisma.sql`${openingQ} AND (l.posted_at < ${new Date(fromDate)}::timestamptz OR l.source_doc_type = 'item_opening_stock')`;
    } else {
      openingQ = Prisma.sql`${openingQ} AND l.source_doc_type = 'item_opening_stock'`;
    }
    
    const openingRes = await tx.$queryRaw<{ qty: number | string | bigint; value: number | string | bigint }[]>`${openingQ}`;
    const firstRow = openingRes[0];
    if (firstRow) {
      openingQty = Number(firstRow.qty ?? 0);
      openingValue = Number(firstRow.value ?? 0);
    }

    // Fetch entries
    let entriesQ = Prisma.sql`
      SELECT 
        l.posted_at AS "date",
        SUM(l.qty_in) AS "qtyIn",
        SUM(l.qty_out) AS "qtyOut",
        SUM(l.value_in) AS "valueIn",
        SUM(l.value_out) AS "valueOut",
        l.source_doc_type AS "sourceDocType",
        l.source_doc_id AS "sourceDocId",
        l.movement_type AS "movementType"
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.item_id = ${itemId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'accounting')
        AND l.source_doc_type != 'item_opening_stock'
        AND EXISTS (
          SELECT 1 FROM locations loc 
          WHERE loc.id = l.location_id 
          AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
        )
    `;

    if (fromDate) {
      entriesQ = Prisma.sql`${entriesQ} AND l.posted_at >= ${new Date(fromDate)}::timestamptz`;
    }
    if (toDate) {
      entriesQ = Prisma.sql`${entriesQ} AND l.posted_at <= ${new Date(toDate)}::timestamptz`;
    }

    entriesQ = Prisma.sql`${entriesQ} GROUP BY l.posted_at, l.source_doc_type, l.source_doc_id, l.movement_type ORDER BY l.posted_at ASC, MIN(l.created_at) ASC`;

    const rawEntries = await tx.$queryRaw<{
      date: Date;
      qtyIn: number | string;
      qtyOut: number | string;
      valueIn: number | string;
      valueOut: number | string;
      sourceDocType: string;
      sourceDocId: string;
      movementType: string;
    }[]>`${entriesQ}`;

    const docIdsByType = {
      job_issue: new Set<string>(),
      job_receipt: new Set<string>(),
      bill: new Set<string>(),
      purchase_order: new Set<string>(),
    };

    for (const entry of rawEntries) {
      const type = entry.sourceDocType as keyof typeof docIdsByType;
      if (entry.sourceDocId && docIdsByType[type]) {
        docIdsByType[type].add(entry.sourceDocId);
      }
    }

    const docNumbers = new Map<string, string>();

    if (docIdsByType.job_issue.size > 0) {
      const docs = await tx.jobIssue.findMany({ where: { id: { in: Array.from(docIdsByType.job_issue) } }, select: { id: true, challanNumber: true } });
      docs.forEach(d => docNumbers.set(d.id, d.challanNumber));
    }
    if (docIdsByType.job_receipt.size > 0) {
      const docs = await tx.jobReceipt.findMany({ where: { id: { in: Array.from(docIdsByType.job_receipt) } }, select: { id: true, receiptNumber: true } });
      docs.forEach(d => docNumbers.set(d.id, d.receiptNumber));
    }
    if (docIdsByType.bill.size > 0) {
      const docs = await tx.bill.findMany({ where: { id: { in: Array.from(docIdsByType.bill) } }, select: { id: true, billNumber: true } });
      docs.forEach(d => docNumbers.set(d.id, d.billNumber));
    }
    if (docIdsByType.purchase_order.size > 0) {
      const docs = await tx.purchaseOrder.findMany({ where: { id: { in: Array.from(docIdsByType.purchase_order) } }, select: { id: true, poNumber: true } });
      docs.forEach(d => docNumbers.set(d.id, d.poNumber));
    }

    const rows: ItemLedgerResponse['rows'] = [];

    rows.push({
      date: null,
      transactionDetails: '*** Opening Stock ***',
      quantity: 0,
      unitCost: null,
      totalCost: 0,
      stockOnHand: openingQty,
      inventoryAssetValue: openingValue,
      isOpeningStock: true
    });

    let currentQty = openingQty;
    let currentValue = openingValue;

    for (const entry of rawEntries) {
      const qIn = Number(entry.qtyIn);
      const qOut = Number(entry.qtyOut);
      const vIn = Number(entry.valueIn);
      const vOut = Number(entry.valueOut);
      
      const qtyChange = qIn - qOut;
      const valChange = vIn - vOut;

      currentQty += qtyChange;
      currentValue += valChange;

      let docLabel = entry.sourceDocType;
      if (docLabel === 'bill') docLabel = 'Bill';
      if (docLabel === 'invoice') docLabel = 'Invoice';
      if (docLabel === 'job_receipt') docLabel = 'Job Receipt';
      if (docLabel === 'job_issue') docLabel = 'Job Issue';
      if (docLabel === 'purchase_order') docLabel = 'Purchase Order';
      if (docLabel === 'item_opening_stock') docLabel = 'Opening Stock Entry';
      const transactionDetails = `${docLabel}`;
      
      let unitCost = null;
      if (qtyChange !== 0) {
        unitCost = Math.abs(valChange / qtyChange);
      }

      rows.push({
        date: entry.date.toISOString(),
        transactionDetails,
        quantity: qtyChange,
        unitCost,
        totalCost: valChange,
        stockOnHand: currentQty,
        inventoryAssetValue: currentValue,
        sourceDocType: entry.sourceDocType,
        sourceDocId: entry.sourceDocId,
        sourceDocNumber: entry.sourceDocId ? docNumbers.get(entry.sourceDocId) || null : null
      });
    }

    rows.push({
      date: null,
      transactionDetails: '*** Closing Stock ***',
      quantity: 0,
      unitCost: null,
      totalCost: 0,
      stockOnHand: currentQty,
      inventoryAssetValue: currentValue,
      isClosingStock: true
    });

    return {
      itemInfo: {
        itemName: item.name,
        sku: item.sku,
        uomName: item.stockingUom?.unitName || null
      },
      rows
    };
  });
}
