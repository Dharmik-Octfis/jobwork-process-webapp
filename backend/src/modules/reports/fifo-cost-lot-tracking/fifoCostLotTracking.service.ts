import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type { FifoCostLotTrackingQuery, FifoCostLotTrackingRow, PaginatedFifoCostLotTrackingResponse } from './fifoCostLotTracking.schemas.ts';
import { format, differenceInDays } from 'date-fns';

export async function getFifoCostLotTracking(
  organizationId: string,
  _query: FifoCostLotTrackingQuery
): Promise<PaginatedFifoCostLotTrackingResponse> {
  return runAsTenant<PaginatedFifoCostLotTrackingResponse>(organizationId, async (tx) => {
    const { fromDate, toDate, itemName, locationName } = _query;

    let q = Prisma.sql`
      SELECT 
        l.batch_id AS "batchId",
        COALESCE(
          MAX(l.posted_at) FILTER (WHERE l.movement_type != 'reversal'),
          MAX(l.posted_at)
        ) AS "date",
        l.source_doc_type AS "sourceDocType",
        l.source_doc_id AS "sourceDocId",
        SUM(l.qty_in - l.qty_out) AS "netQty",
        SUM(l.value_in - l.value_out) AS "netValue",
        l.owner_party_id AS "ownerPartyId",
        COALESCE(c.display_name, v.display_name) AS "partyName",
        i.name AS "itemName",
        u.unit_name AS "uomName",
        l.location_id AS "locationId",
        loc.name AS "locationName"
      FROM stock_ledger l
      JOIN items i ON l.item_id = i.id
      LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
      LEFT JOIN locations loc ON l.location_id = loc.id
      LEFT JOIN customers c ON l.owner_party_id = c.id
      LEFT JOIN vendors v ON l.owner_party_id = v.id
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.stock_effect IN ('both', 'accounting')
        AND l.batch_id IS NOT NULL
        AND l.source_doc_type != 'item_opening_stock'
        AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
    `;

    if (fromDate) {
      q = Prisma.sql`${q} AND l.posted_at >= ${new Date(fromDate)}::timestamptz`;
    }
    if (toDate) {
      q = Prisma.sql`${q} AND l.posted_at <= ${new Date(toDate)}::timestamptz`;
    }

    if (itemName) {
      q = Prisma.sql`${q} AND i.name ILIKE ${'%' + itemName + '%'}`;
    }

    if (locationName) {
      q = Prisma.sql`${q} AND loc.name ILIKE ${'%' + locationName + '%'}`;
    }

    q = Prisma.sql`${q} 
      GROUP BY 
        l.batch_id, 
        l.source_doc_type, 
        l.source_doc_id, 
        l.owner_party_id, 
        c.display_name, 
        v.display_name, 
        i.name, 
        u.unit_name, 
        l.location_id, 
        loc.name 
      HAVING SUM(l.qty_in - l.qty_out) != 0
      ORDER BY 
        COALESCE(
          MAX(l.posted_at) FILTER (WHERE l.movement_type != 'reversal'),
          MAX(l.posted_at)
        ) ASC,
        MIN(l.created_at) ASC`;

    const rawEntries = await tx.$queryRaw<{
      batchId: string;
      date: Date;
      sourceDocType: string;
      sourceDocId: string;
      netQty: number | string;
      netValue: number | string;
      ownerPartyId: string | null;
      partyName: string | null;
      itemName: string;
      uomName: string | null;
      locationName: string | null;
    }[]>`${q}`;

    // Resolve document numbers
    const docIdsByType = {
      job_issue: new Set<string>(),
      job_receipt: new Set<string>(),
      bill: new Set<string>(),
      purchase_order: new Set<string>(),
      invoice: new Set<string>(),
      item_opening_stock: new Set<string>(),
      inventory_adjustment: new Set<string>(),
    };

    for (const entry of rawEntries) {
      const docType = entry.sourceDocType as keyof typeof docIdsByType;
      if (entry.sourceDocId && docIdsByType[docType]) {
        docIdsByType[docType].add(entry.sourceDocId);
      }
    }

    const docInfo = new Map<string, { number: string; partyName: string | null; partyId: string | null; partyType: 'vendor' | 'customer' | null }>();

    if (docIdsByType.job_issue.size > 0) {
      const docs = await tx.jobIssue.findMany({ where: { id: { in: Array.from(docIdsByType.job_issue) } }, select: { id: true, challanNumber: true, processorNameSnapshot: true, processorId: true } });
      docs.forEach(d => docInfo.set(d.id, { number: d.challanNumber, partyName: d.processorNameSnapshot, partyId: d.processorId, partyType: 'customer' }));
    }
    if (docIdsByType.job_receipt.size > 0) {
      const docs = await tx.jobReceipt.findMany({ where: { id: { in: Array.from(docIdsByType.job_receipt) } }, select: { id: true, receiptNumber: true, processorNameSnapshot: true, processorId: true } });
      docs.forEach(d => docInfo.set(d.id, { number: d.receiptNumber, partyName: d.processorNameSnapshot, partyId: d.processorId, partyType: 'customer' }));
    }
    if (docIdsByType.bill.size > 0) {
      const docs = await tx.bill.findMany({ where: { id: { in: Array.from(docIdsByType.bill) } }, select: { id: true, billNumber: true, vendorId: true, vendor: { select: { contactName: true } } } });
      docs.forEach(d => docInfo.set(d.id, { number: d.billNumber, partyName: d.vendor?.contactName || null, partyId: d.vendorId, partyType: 'vendor' }));
    }
    if (docIdsByType.purchase_order.size > 0) {
      const docs = await tx.purchaseOrder.findMany({ where: { id: { in: Array.from(docIdsByType.purchase_order) } }, select: { id: true, poNumber: true, vendorId: true, vendor: { select: { contactName: true } } } });
      docs.forEach(d => docInfo.set(d.id, { number: d.poNumber, partyName: d.vendor?.contactName || null, partyId: d.vendorId, partyType: 'vendor' }));
    }
    // if (docIdsByType.inventory_adjustment.size > 0) {
    //   const docs = await tx.inventoryAdjustment.findMany({ where: { id: { in: Array.from(docIdsByType.inventory_adjustment) } }, select: { id: true, adjustmentNumber: true } });
    //   docs.forEach(d => docInfo.set(d.id, { number: d.adjustmentNumber, partyName: null }));
    // }
    // if (docIdsByType.invoice.size > 0) {
    //   const docs = await tx.invoice.findMany({ where: { id: { in: Array.from(docIdsByType.invoice) } }, select: { id: true, invoiceNumber: true } });
    //   docs.forEach(d => docInfo.set(d.id, { number: d.invoiceNumber, partyName: null }));
    // }

    type InEvent = { date: Date; transaction: string; partyName: string; qty: number; uom: string; cost: number; total: number; docType: string; docId: string; partyId: string | null; partyType: 'vendor' | 'customer' | null; };
    type OutEvent = { date: Date; transaction: string; partyName: string; qty: number; uom: string; docType: string; docId: string; partyId: string | null; partyType: 'vendor' | 'customer' | null; };
    const batches = new Map<string, { inEvents: InEvent[], outEvents: OutEvent[], qtyRemaining: number }>();

    for (const entry of rawEntries) {
      const netQty = Number(entry.netQty);
      const netValue = Number(entry.netValue);
      
      const qIn = netQty > 0 ? netQty : 0;
      const qOut = netQty < 0 ? Math.abs(netQty) : 0;
      const vIn = netQty > 0 ? netValue : 0;
      const _vOut = netQty < 0 ? Math.abs(netValue) : 0;

      if (!batches.has(entry.batchId)) {
        batches.set(entry.batchId, { inEvents: [], outEvents: [], qtyRemaining: 0 });
      }
      
      const batch = batches.get(entry.batchId)!;
      batch.qtyRemaining += (qIn - qOut);

      let docLabel = entry.sourceDocType;
      if (docLabel === 'bill') docLabel = 'Bill';
      if (docLabel === 'invoice') docLabel = 'Invoice';
      if (docLabel === 'job_receipt') docLabel = 'Job Receipt';
      if (docLabel === 'job_issue') docLabel = 'Job Issue';
      if (docLabel === 'purchase_order') docLabel = 'Purchase Order';
      if (docLabel === 'item_opening_stock') docLabel = 'Opening Stock';
      if (docLabel === 'inventory_adjustment') docLabel = 'Inventory Adjustment By Quantity';
      if (docLabel === 'assembly') docLabel = 'Assemblies';

      const info = entry.sourceDocId ? docInfo.get(entry.sourceDocId) : null;
      const transactionStr = info ? `${docLabel} # ${info.number}` : docLabel;
      const finalPartyName = info?.partyName || entry.partyName || '';
      
      const isVendor = entry.sourceDocType === 'bill' || entry.sourceDocType === 'purchase_order';
      const defaultPartyType = isVendor ? 'vendor' : 'customer';
      
      const partyId = entry.ownerPartyId || info?.partyId || null;
      const partyType = partyId ? (info?.partyType || defaultPartyType) : null;

      if (qIn > 0) {
        batch.inEvents.push({
          date: entry.date,
          transaction: transactionStr,
          partyName: finalPartyName,
          qty: qIn,
          uom: entry.uomName || 'unit',
          cost: Math.abs(vIn / qIn),
          total: vIn,
          docType: entry.sourceDocType,
          docId: entry.sourceDocId || '',
          partyId,
          partyType,
        });
      }

      if (qOut > 0) {
        batch.outEvents.push({
          date: entry.date,
          transaction: transactionStr,
          partyName: finalPartyName,
          qty: qOut,
          uom: entry.uomName || 'unit',
          docType: entry.sourceDocType,
          docId: entry.sourceDocId || '',
          partyId,
          partyType,
        });
      }
    }

    const rows: FifoCostLotTrackingRow[] = [];
    
    const sortedBatches = Array.from(batches.values()).sort((a, b) => {
      const aDate = a.inEvents[0]?.date || a.outEvents[0]?.date || new Date(0);
      const bDate = b.inEvents[0]?.date || b.outEvents[0]?.date || new Date(0);
      return aDate.getTime() - bDate.getTime();
    });

    for (const batch of sortedBatches) {
      const maxLen = Math.max(batch.inEvents.length, batch.outEvents.length);
      for (let i = 0; i < maxLen; i++) {
        const inEv = batch.inEvents[i];
        const outEv = batch.outEvents[i];
        
        // Age calculation
        let ageStr = '';
        if (inEv) {
          const days = differenceInDays(new Date(), inEv.date);
          ageStr = days > 0 ? `${days} Days` : '';
        }

        rows.push({
          inDate: inEv ? format(inEv.date, 'dd-MM-yyyy') : null,
          inTransaction: inEv ? inEv.transaction : '',
          inReceivedFrom: inEv ? inEv.partyName : '',
          inQty: inEv ? inEv.qty : 0,
          inQtyUnit: inEv ? inEv.uom : '',
          inQtyRemaining: i === batch.inEvents.length - 1 ? batch.qtyRemaining : 0, // show remaining only on last IN event
          inAge: ageStr,
          inCost: inEv ? inEv.cost.toFixed(2) : '',
          inTotal: inEv ? inEv.total.toFixed(2) : '',
          inDocType: inEv ? inEv.docType : '',
          inDocId: inEv ? inEv.docId : '',
          inPartyId: inEv ? inEv.partyId : null,
          inPartyType: inEv ? inEv.partyType : null,
          
          outDate: outEv ? format(outEv.date, 'dd-MM-yyyy') : null,
          outTransaction: outEv ? outEv.transaction : '',
          outDispersedTo: outEv ? outEv.partyName : '',
          outQty: outEv ? outEv.qty : null,
          outQtyUnit: outEv ? outEv.uom : '',
          outDocType: outEv ? outEv.docType : '',
          outDocId: outEv ? outEv.docId : '',
          outPartyId: outEv ? outEv.partyId : null,
          outPartyType: outEv ? outEv.partyType : null,
        });
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
