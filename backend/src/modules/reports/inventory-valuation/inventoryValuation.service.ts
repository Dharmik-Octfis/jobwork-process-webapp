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

    const { asOfDate, stockAvailability = 'none', status = 'all', itemName, categoryName, locationId, sku, hsnCode, itemCustomFields } = _query;

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
        AND l.source_doc_type != 'job_receipt'
        ${locationId ? Prisma.sql`AND l.location_id = ${locationId}::uuid` : Prisma.empty}
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

    // Add sku, hsnCode, customFields to RawRow typing
    type ExtendedRawRow = RawRow & {
      sku: string | null;
      hsnCode: string | null;
      customFields: Record<string, unknown>;
    };

    const rawRows = await tx.$queryRaw<ExtendedRawRow[]>`${q}`;

    const mappedRows = rawRows.map(row => ({
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

    const itemIds = mappedRows.map(r => r.itemId);
    if (itemIds.length > 0) {
      let entriesQ = Prisma.sql`
        WITH doc_nets AS (
          SELECT 
            l.item_id AS "itemId",
            l.source_doc_type AS "sourceDocType",
            l.source_doc_id AS "sourceDocId",
            SUM(l.qty_in - l.qty_out) AS net_qty,
            SUM(l.value_in - l.value_out) AS net_value,
            (
              SELECT sl.posted_at 
              FROM stock_ledger sl 
              WHERE sl.source_doc_id = l.source_doc_id AND sl.item_id = l.item_id
              ORDER BY sl.created_at DESC 
              LIMIT 1
            ) AS real_date,
            MIN(l.created_at) AS min_created_at
          FROM stock_ledger l
          WHERE l.organization_id = ${organizationId}::uuid
            AND l.item_id IN (${Prisma.join(itemIds)})
            AND l.ownership = 'own'
            AND l.stock_effect IN ('both', 'accounting')
            AND l.source_doc_type != 'job_receipt'
            ${locationId ? Prisma.sql`AND l.location_id = ${locationId}::uuid` : Prisma.empty}
            AND EXISTS (
              SELECT 1 FROM locations loc 
              WHERE loc.id = l.location_id 
              AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
            )
          GROUP BY l.source_doc_type, l.source_doc_id, l.item_id, l.batch_id
        )
        SELECT 
          "itemId",
          real_date AS "date",
          GREATEST(net_qty, 0) AS "qtyIn",
          GREATEST(-net_qty, 0) AS "qtyOut",
          GREATEST(net_value, 0) AS "valueIn"
        FROM doc_nets
        WHERE (net_qty != 0 OR net_value != 0)
      `;
      if (asOfDate) {
        entriesQ = Prisma.sql`${entriesQ} AND real_date <= ${new Date(asOfDate)}::timestamptz`;
      }
      entriesQ = Prisma.sql`${entriesQ} ORDER BY real_date ASC, min_created_at ASC`;

      const ledgerEntries = await tx.$queryRaw<{
        itemId: string;
        date: Date;
        qtyIn: number | string;
        qtyOut: number | string;
        valueIn: number | string;
      }[]>`${entriesQ}`;

      const groupedByItem = new Map<string, typeof ledgerEntries>();
      for (const entry of ledgerEntries) {
        let arr = groupedByItem.get(entry.itemId);
        if (!arr) {
          arr = [];
          groupedByItem.set(entry.itemId, arr);
        }
        arr.push(entry);
      }

      for (const row of mappedRows) {
        const entries = groupedByItem.get(row.itemId);
        if (!entries || entries.length === 0) {
          row.inventoryAssetValue = 0;
          continue;
        }

        const fifoQueue: { qty: number; unitCost: number }[] = [];
        let currentValue = 0;

        for (const entry of entries) {
          const qIn = Number(entry.qtyIn);
          const qOut = Number(entry.qtyOut);
          const vIn = Number(entry.valueIn);
          
          if (qIn > 0) {
            fifoQueue.push({ qty: qIn, unitCost: qIn > 0 ? vIn / qIn : 0 });
            currentValue += vIn;
          } else if (qOut > 0) {
            let outQtyRemaining = qOut;
            let totalOutCost = 0;
            
            while (outQtyRemaining > 0 && fifoQueue.length > 0) {
              const oldest = fifoQueue[0]!;
              if (oldest.qty <= outQtyRemaining) {
                totalOutCost += oldest.qty * oldest.unitCost;
                outQtyRemaining -= oldest.qty;
                fifoQueue.shift();
              } else {
                totalOutCost += outQtyRemaining * oldest.unitCost;
                oldest.qty -= outQtyRemaining;
                outQtyRemaining = 0;
              }
            }
            currentValue -= totalOutCost;
          }
        }
        row.inventoryAssetValue = currentValue;
      }
    }

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

    let allEntriesQ = Prisma.sql`
      WITH doc_nets AS (
        SELECT 
          l.source_doc_type AS "sourceDocType",
          l.source_doc_id AS "sourceDocId",
          l.batch_id AS "batchId",
          l.location_id AS "locationId",
          SUM(l.qty_in - l.qty_out) AS net_qty,
          SUM(l.value_in - l.value_out) AS net_value,
          (
            SELECT sl.posted_at 
            FROM stock_ledger sl 
            WHERE sl.source_doc_id = l.source_doc_id AND sl.item_id = l.item_id
            ORDER BY sl.created_at DESC 
            LIMIT 1
          ) AS real_date,
          MIN(l.created_at) AS min_created_at
        FROM stock_ledger l
        WHERE l.organization_id = ${organizationId}::uuid
          AND l.item_id = ${itemId}::uuid
          AND l.ownership = 'own'
          AND l.stock_effect IN ('both', 'accounting')
          AND l.source_doc_type != 'job_receipt'
          AND EXISTS (
            SELECT 1 FROM locations loc 
            WHERE loc.id = l.location_id 
            AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
          )
        GROUP BY l.source_doc_type, l.source_doc_id, l.item_id, l.batch_id, l.location_id
      )
      SELECT 
        real_date AS "date",
        GREATEST(net_qty, 0) AS "qtyIn",
        GREATEST(-net_qty, 0) AS "qtyOut",
        GREATEST(net_value, 0) AS "valueIn",
        GREATEST(-net_value, 0) AS "valueOut",
        "sourceDocType",
        "sourceDocId",
        "locationId"
      FROM doc_nets
      WHERE (net_qty != 0 OR net_value != 0)
    `;

    if (toDate) {
      allEntriesQ = Prisma.sql`${allEntriesQ} AND real_date <= ${new Date(toDate)}::timestamptz`;
    }

    allEntriesQ = Prisma.sql`${allEntriesQ} ORDER BY real_date ASC, min_created_at ASC`;

    const rawEntries = await tx.$queryRaw<{
      date: Date;
      qtyIn: number | string;
      qtyOut: number | string;
      valueIn: number | string;
      valueOut: number | string;
      sourceDocType: string;
      sourceDocId: string;
      locationId: string;
    }[]>`${allEntriesQ}`;

    // Merge consecutive entries from the same document that have the same unit cost
    const mergedEntries: typeof rawEntries = [];
    for (const entry of rawEntries) {
      if (mergedEntries.length > 0) {
        const last = mergedEntries[mergedEntries.length - 1];
        if (last && last.sourceDocId && last.sourceDocId === entry.sourceDocId && last.locationId === entry.locationId) {
          const lastQty = Number(last.qtyIn) - Number(last.qtyOut);
          const lastVal = Number(last.valueIn) - Number(last.valueOut);
          const lastUc = lastQty !== 0 ? Math.abs(lastVal / lastQty) : null;

          const currQty = Number(entry.qtyIn) - Number(entry.qtyOut);
          const currVal = Number(entry.valueIn) - Number(entry.valueOut);
          const currUc = currQty !== 0 ? Math.abs(currVal / currQty) : null;

          // Merge if unit costs match and they are both IN or both OUT
          if (lastUc !== null && currUc !== null && Math.abs(lastUc - currUc) < 0.0001 && Math.sign(lastQty) === Math.sign(currQty)) {
            last.qtyIn = Number(last.qtyIn) + Number(entry.qtyIn);
            last.qtyOut = Number(last.qtyOut) + Number(entry.qtyOut);
            last.valueIn = Number(last.valueIn) + Number(entry.valueIn);
            last.valueOut = Number(last.valueOut) + Number(entry.valueOut);
            continue;
          }
        }
      }
      mergedEntries.push({ ...entry });
    }

    const docIdsByType = {
      job_issue: new Set<string>(),
      job_receipt: new Set<string>(),
      bill: new Set<string>(),
      purchase_order: new Set<string>(),
    };

    for (const entry of mergedEntries) {
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
    const fifoQueues = new Map<string, { qty: number; unitCost: number }[]>();
    
    let currentQty = 0;
    let currentValue = 0;
    let previousSourceDocId: string | null = null;
    let hasAddedOpeningRow = false;
    
    const fromDateTime = fromDate ? new Date(fromDate).getTime() : 0;

    for (const entry of mergedEntries) {
      const isBeforeFromDate = fromDate && entry.date.getTime() < fromDateTime;
      const isOpeningStockEntry = entry.sourceDocType === 'item_opening_stock';

      if (!isBeforeFromDate && !isOpeningStockEntry && !hasAddedOpeningRow) {
        rows.push({
          date: null,
          transactionDetails: '*** Opening Stock ***',
          quantity: 0,
          unitCost: null,
          totalCost: 0,
          stockOnHand: currentQty,
          inventoryAssetValue: currentValue,
          isOpeningStock: true
        });
        hasAddedOpeningRow = true;
      }

      const qIn = Number(entry.qtyIn);
      const qOut = Number(entry.qtyOut);
      const vIn = Number(entry.valueIn);
      
      const qtyChange = qIn - qOut;
      let docLabel = entry.sourceDocType;
      if (docLabel === 'bill') docLabel = 'Bill';
      if (docLabel === 'invoice') docLabel = 'Invoice';
      if (docLabel === 'job_receipt') docLabel = 'Job Receipt';
      if (docLabel === 'job_issue') docLabel = 'Job Issue';
      if (docLabel === 'purchase_order') docLabel = 'Purchase Order';
      const transactionDetails = `${docLabel}`;

      if (qtyChange >= 0) {
        const valChange = qtyChange > 0 ? vIn : 0;
        const queue = fifoQueues.get(entry.locationId) || [];
        if (qtyChange > 0) {
          queue.push({ qty: qtyChange, unitCost: valChange / qtyChange });
          fifoQueues.set(entry.locationId, queue);
        }
        currentQty += qtyChange;
        currentValue += valChange;

        if (!isBeforeFromDate && !isOpeningStockEntry) {
          const isSameAsPrevious = entry.sourceDocId && entry.sourceDocId === previousSourceDocId;
          previousSourceDocId = entry.sourceDocId || null;

          rows.push({
            date: isSameAsPrevious ? null : entry.date.toISOString(),
            transactionDetails: isSameAsPrevious ? '' : transactionDetails,
            quantity: qtyChange,
            unitCost: qtyChange !== 0 ? Math.abs(valChange / qtyChange) : null,
            totalCost: valChange,
            stockOnHand: currentQty,
            inventoryAssetValue: currentValue,
            sourceDocType: isSameAsPrevious ? null : entry.sourceDocType,
            sourceDocId: isSameAsPrevious ? null : entry.sourceDocId,
            sourceDocNumber: isSameAsPrevious ? null : (entry.sourceDocId ? docNumbers.get(entry.sourceDocId) || null : null)
          });
        }
      } else {
        let outQtyRemaining = -qtyChange;
        const consumptions: { qty: number; unitCost: number; val: number }[] = [];
        const queue = fifoQueues.get(entry.locationId) || [];
        
        while (outQtyRemaining > 0 && queue.length > 0) {
          const oldest = queue[0]!;
          if (oldest.qty <= outQtyRemaining) {
            const cost = oldest.qty * oldest.unitCost;
            consumptions.push({ qty: -oldest.qty, unitCost: oldest.unitCost, val: -cost });
            outQtyRemaining -= oldest.qty;
            queue.shift();
          } else {
            const cost = outQtyRemaining * oldest.unitCost;
            consumptions.push({ qty: -outQtyRemaining, unitCost: oldest.unitCost, val: -cost });
            oldest.qty -= outQtyRemaining;
            outQtyRemaining = 0;
          }
        }
        fifoQueues.set(entry.locationId, queue);

        if (outQtyRemaining > 0) {
           consumptions.push({ qty: -outQtyRemaining, unitCost: 0, val: 0 });
        }

        for (const c of consumptions) {
          currentQty += c.qty;
          currentValue += c.val;

          if (!isBeforeFromDate && !isOpeningStockEntry) {
            const isSameAsPrevious = entry.sourceDocId && entry.sourceDocId === previousSourceDocId;
            previousSourceDocId = entry.sourceDocId || null;

            rows.push({
              date: isSameAsPrevious ? null : entry.date.toISOString(),
              transactionDetails: isSameAsPrevious ? '' : transactionDetails,
              quantity: c.qty,
              unitCost: c.unitCost !== 0 ? Math.abs(c.unitCost) : null,
              totalCost: c.val,
              stockOnHand: currentQty,
              inventoryAssetValue: currentValue,
              sourceDocType: isSameAsPrevious ? null : entry.sourceDocType,
              sourceDocId: isSameAsPrevious ? null : entry.sourceDocId,
              sourceDocNumber: isSameAsPrevious ? null : (entry.sourceDocId ? docNumbers.get(entry.sourceDocId) || null : null)
            });
          }
        }
      }
    }

    if (!hasAddedOpeningRow) {
       rows.push({
          date: null,
          transactionDetails: '*** Opening Stock ***',
          quantity: 0,
          unitCost: null,
          totalCost: 0,
          stockOnHand: currentQty,
          inventoryAssetValue: currentValue,
          isOpeningStock: true
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
