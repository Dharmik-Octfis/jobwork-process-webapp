import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  FifoCostLotTrackingQuery,
  FifoCostLotTrackingRow,
  PaginatedFifoCostLotTrackingResponse,
} from './fifoCostLotTracking.schemas.ts';
import { format, differenceInDays } from 'date-fns';

export async function getFifoCostLotTracking(
  organizationId: string,
  _query: FifoCostLotTrackingQuery,
): Promise<PaginatedFifoCostLotTrackingResponse> {
  return runAsTenant<PaginatedFifoCostLotTrackingResponse>(organizationId, async (tx) => {
    const { fromDate, toDate, itemName, locationName } = _query;

    let q = Prisma.sql`
      WITH doc_nets AS (
        SELECT
          l.batch_id AS "batchId",
          l.source_doc_type AS "sourceDocType",
          l.source_doc_id AS "sourceDocId",
          SUM(l.qty_in - l.qty_out) AS "netQty",
          SUM(l.value_in - l.value_out) AS "netValue",
          l.owner_party_id AS "ownerPartyId",
          COALESCE(c.display_name, v.display_name) AS "partyName",
          i.name AS "itemName",
          u.unit_name AS "uomName",
          l.location_id AS "locationId",
          loc.name AS "locationName",
          (
            SELECT sl.posted_at
            FROM stock_ledger sl
            WHERE sl.source_doc_id = l.source_doc_id
            ORDER BY sl.created_at DESC
            LIMIT 1
          ) AS real_date,
          MIN(l.created_at) AS min_created_at
        FROM stock_ledger l
        JOIN items i ON l.item_id = i.id
        LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
        LEFT JOIN locations loc ON l.location_id = loc.id
        LEFT JOIN customers c ON l.owner_party_id = c.id
        LEFT JOIN vendors v ON l.owner_party_id = v.id
        WHERE l.organization_id = ${organizationId}::uuid
          AND l.stock_effect IN ('both', 'accounting', 'physical')
          AND l.batch_id IS NOT NULL
          AND l.source_doc_type != 'item_opening_stock'
          AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
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
      )
      SELECT
        "batchId",
        real_date AS "date",
        "sourceDocType",
        "sourceDocId",
        "netQty",
        "netValue",
        "ownerPartyId",
        "partyName",
        "itemName",
        "uomName",
        "locationId",
        "locationName",
        min_created_at AS "createdAt"
      FROM doc_nets
      WHERE "netQty" != 0
    `;

    if (fromDate) {
      q = Prisma.sql`${q} AND real_date >= ${new Date(fromDate)}::timestamptz`;
    }
    if (toDate) {
      q = Prisma.sql`${q} AND real_date <= ${new Date(toDate)}::timestamptz`;
    }

    if (itemName) {
      q = Prisma.sql`${q} AND "itemName" ILIKE ${'%' + itemName + '%'}`;
    }

    if (locationName) {
      q = Prisma.sql`${q} AND "locationName" ILIKE ${'%' + locationName + '%'}`;
    }

    q = Prisma.sql`${q} ORDER BY real_date ASC, min_created_at ASC`;

    const rawEntries = await tx.$queryRaw<
      {
        batchId: string;
        date: Date;
        createdAt: Date;
        sourceDocType: string;
        sourceDocId: string;
        netQty: number | string;
        netValue: number | string;
        ownerPartyId: string | null;
        partyName: string | null;
        itemName: string;
        uomName: string | null;
        locationName: string | null;
      }[]
    >`${q}`;

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

    const docInfo = new Map<
      string,
      {
        number: string;
        partyName: string | null;
        partyId: string | null;
        partyType: 'vendor' | 'customer' | null;
      }
    >();

    if (docIdsByType.job_issue.size > 0) {
      const docs = await tx.jobIssue.findMany({
        where: { id: { in: Array.from(docIdsByType.job_issue) } },
        select: { id: true, challanNumber: true, processorNameSnapshot: true, processorId: true },
      });
      docs.forEach((d) =>
        docInfo.set(d.id, {
          number: d.challanNumber,
          partyName: d.processorNameSnapshot,
          partyId: d.processorId,
          partyType: 'customer',
        }),
      );
    }
    if (docIdsByType.job_receipt.size > 0) {
      const docs = await tx.jobReceipt.findMany({
        where: { id: { in: Array.from(docIdsByType.job_receipt) } },
        select: { id: true, receiptNumber: true, processorNameSnapshot: true, processorId: true },
      });
      docs.forEach((d) =>
        docInfo.set(d.id, {
          number: d.receiptNumber,
          partyName: d.processorNameSnapshot,
          partyId: d.processorId,
          partyType: 'customer',
        }),
      );
    }
    if (docIdsByType.bill.size > 0) {
      const docs = await tx.bill.findMany({
        where: { id: { in: Array.from(docIdsByType.bill) } },
        select: {
          id: true,
          billNumber: true,
          vendorId: true,
          vendor: { select: { contactName: true } },
        },
      });
      docs.forEach((d) =>
        docInfo.set(d.id, {
          number: d.billNumber,
          partyName: d.vendor?.contactName || null,
          partyId: d.vendorId,
          partyType: 'vendor',
        }),
      );
    }
    if (docIdsByType.purchase_order.size > 0) {
      const docs = await tx.purchaseOrder.findMany({
        where: { id: { in: Array.from(docIdsByType.purchase_order) } },
        select: {
          id: true,
          poNumber: true,
          vendorId: true,
          vendor: { select: { contactName: true } },
        },
      });
      docs.forEach((d) =>
        docInfo.set(d.id, {
          number: d.poNumber,
          partyName: d.vendor?.contactName || null,
          partyId: d.vendorId,
          partyType: 'vendor',
        }),
      );
    }
    // if (docIdsByType.inventory_adjustment.size > 0) {
    //   const docs = await tx.inventoryAdjustment.findMany({ where: { id: { in: Array.from(docIdsByType.inventory_adjustment) } }, select: { id: true, adjustmentNumber: true } });
    //   docs.forEach(d => docInfo.set(d.id, { number: d.adjustmentNumber, partyName: null }));
    // }
    // if (docIdsByType.invoice.size > 0) {
    //   const docs = await tx.invoice.findMany({ where: { id: { in: Array.from(docIdsByType.invoice) } }, select: { id: true, invoiceNumber: true } });
    //   docs.forEach(d => docInfo.set(d.id, { number: d.invoiceNumber, partyName: null }));
    // }

    type InEvent = {
      date: Date;
      createdAt: Date;
      transaction: string;
      partyName: string;
      qty: number;
      uom: string;
      cost: number;
      total: number;
      docType: string;
      docId: string;
      partyId: string | null;
      partyType: 'vendor' | 'customer' | null;
    };
    type OutEvent = {
      date: Date;
      createdAt: Date;
      transaction: string;
      partyName: string;
      qty: number;
      uom: string;
      docType: string;
      docId: string;
      partyId: string | null;
      partyType: 'vendor' | 'customer' | null;
    };
    const batches = new Map<
      string,
      { inEvents: InEvent[]; outEvents: OutEvent[]; qtyRemaining: number }
    >();

    for (const entry of rawEntries) {
      const netQty = Number(entry.netQty);
      const netValue = Number(entry.netValue);

      const qIn = netQty > 0 ? netQty : 0;
      const vIn = netValue > 0 ? netValue : 0;

      const qOut = netQty < 0 ? Math.abs(netQty) : 0;
      const _vOut = netValue < 0 ? Math.abs(netValue) : 0;

      // Group entirely by item name to allow merging of same-document entries across different batches
      const metaBatchId = entry.itemName || 'Unknown Item';

      if (!batches.has(metaBatchId)) {
        batches.set(metaBatchId, { inEvents: [], outEvents: [], qtyRemaining: 0 });
      }

      const batch = batches.get(metaBatchId)!;
      batch.qtyRemaining += qIn - qOut;

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
      const partyType = partyId ? info?.partyType || defaultPartyType : null;

      if (qIn > 0) {
        const existingIn = batch.inEvents.find((e) => e.docId === entry.sourceDocId);
        if (existingIn) {
          existingIn.qty += qIn;
          existingIn.total += vIn;
          existingIn.cost = Math.abs(existingIn.total / existingIn.qty);
        } else {
          batch.inEvents.push({
            date: entry.date,
            createdAt: entry.createdAt,
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
      }

      if (qOut > 0) {
        const existingOut = batch.outEvents.find((e) => e.docId === entry.sourceDocId);
        if (existingOut) {
          existingOut.qty += qOut;
        } else {
          batch.outEvents.push({
            date: entry.date,
            createdAt: entry.createdAt,
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
    }

    const rows: FifoCostLotTrackingRow[] = [];

    const sortedBatches = Array.from(batches.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [itemName, batch] of sortedBatches) {
      // Sort inEvents and outEvents chronologically
      batch.inEvents.sort((a, b) => {
        const timeDiff = a.date.getTime() - b.date.getTime();
        return timeDiff !== 0 ? timeDiff : a.createdAt.getTime() - b.createdAt.getTime();
      });
      batch.outEvents.sort((a, b) => {
        const timeDiff = a.date.getTime() - b.date.getTime();
        return timeDiff !== 0 ? timeDiff : a.createdAt.getTime() - b.createdAt.getTime();
      });

      let inIdx = 0;
      let outIdx = 0;
      let isFirstItemRow = true;

      while (inIdx < batch.inEvents.length || outIdx < batch.outEvents.length) {
        const inEv = batch.inEvents[inIdx];
        const outEv = batch.outEvents[outIdx];

        let printIn = false;
        let printOut = false;

        if (inEv && outEv) {
          
          // Or strictly compare date then createdAt
          const isBeforeOrEqual = 
            inEv.date.getTime() < outEv.date.getTime() ||
            (inEv.date.getTime() === outEv.date.getTime() && inEv.createdAt.getTime() <= outEv.createdAt.getTime());

          if (isBeforeOrEqual) {
            // Pair them!
            printIn = true;
            printOut = true;
          } else {
            // OUT happened before IN, print OUT alone
            printOut = true;
          }
        } else if (inEv) {
          printIn = true;
        } else if (outEv) {
          printOut = true;
        }

        const ageStr = printIn && inEv ? differenceInDays(new Date(), inEv.date) > 0 ? `${differenceInDays(new Date(), inEv.date)} Days` : '' : '';

        rows.push({
          itemName: isFirstItemRow ? itemName : '',
          inDate: printIn && inEv ? format(inEv.date, 'dd-MM-yyyy') : null,
          inTransaction: printIn && inEv ? inEv.transaction : '',
          inReceivedFrom: printIn && inEv ? inEv.partyName : '',
          inQty: printIn && inEv ? inEv.qty : null,
          inQtyUnit: printIn && inEv ? inEv.uom : '',
          inQtyRemaining: printIn && inIdx === batch.inEvents.length - 1 ? batch.qtyRemaining : 0,
          inAge: ageStr,
          inCost: printIn && inEv ? inEv.cost.toFixed(2) : '',
          inTotal: printIn && inEv ? inEv.total.toFixed(2) : '',
          inDocType: printIn && inEv ? inEv.docType : '',
          inDocId: printIn && inEv ? inEv.docId : '',
          inPartyId: printIn && inEv ? inEv.partyId : null,
          inPartyType: printIn && inEv ? inEv.partyType : null,
          
          outDate: printOut && outEv ? format(outEv.date, 'dd-MM-yyyy') : null,
          outTransaction: printOut && outEv ? outEv.transaction : '',
          outDispersedTo: printOut && outEv ? outEv.partyName : '',
          outQty: printOut && outEv ? outEv.qty : null,
          outQtyUnit: printOut && outEv ? outEv.uom : '',
          outDocType: printOut && outEv ? outEv.docType : '',
          outDocId: printOut && outEv ? outEv.docId : '',
          outPartyId: printOut && outEv ? outEv.partyId : null,
          outPartyType: printOut && outEv ? outEv.partyType : null,
        });

        isFirstItemRow = false;
        if (printIn) inIdx++;
        if (printOut) outIdx++;
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
