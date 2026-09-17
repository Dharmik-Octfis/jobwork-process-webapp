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
    const { fromDate, toDate, itemName, locationName, reportBasis } = _query;
    const isProductOut = reportBasis === 'product_out';

    let validItemsQ = Prisma.sql`
      SELECT "itemId"
      FROM doc_nets
      WHERE 1=1
    `;

    if (isProductOut) {
      validItemsQ = Prisma.sql`${validItemsQ} AND "netQty" < 0`;
    } else {
      validItemsQ = Prisma.sql`${validItemsQ} AND "netQty" > 0`;
    }

    if (fromDate) {
      validItemsQ = Prisma.sql`${validItemsQ} AND real_date >= ${new Date(fromDate)}::timestamptz`;
    }
    if (toDate) {
      validItemsQ = Prisma.sql`${validItemsQ} AND real_date <= ${new Date(toDate)}::timestamptz`;
    }

    let q = Prisma.sql`
      WITH doc_nets AS (
        SELECT
          l.item_id AS "itemId",
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
          CASE
            WHEN l.source_doc_type = 'item_opening_stock' THEN COALESCE((
              SELECT migration_date FROM organizations WHERE id = ${organizationId}::uuid
            ), '1970-01-01'::timestamptz)
            ELSE COALESCE((
              SELECT sl.posted_at
              FROM stock_ledger sl
              WHERE sl.source_doc_id = l.source_doc_id
              ORDER BY sl.created_at DESC
              LIMIT 1
            ), MIN(l.created_at))
          END AS real_date,
          MIN(l.created_at) AS min_created_at
        FROM stock_ledger l
        JOIN items i ON l.item_id = i.id
        LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
        LEFT JOIN locations loc ON l.location_id = loc.id
        LEFT JOIN customers c ON l.owner_party_id = c.id
        LEFT JOIN vendors v ON l.owner_party_id = v.id
        WHERE l.organization_id = ${organizationId}::uuid
          AND l.stock_effect IN ('both', 'accounting', 'physical')
          AND (l.batch_id IS NOT NULL OR l.source_doc_type = 'item_opening_stock')
          AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
        GROUP BY
          l.item_id,
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
        "itemId",
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
        AND "itemId" IN (${validItemsQ})
    `;

    if (itemName) {
      q = Prisma.sql`${q} AND "itemName" ILIKE ${'%' + itemName + '%'}`;
    }

    if (locationName) {
      q = Prisma.sql`${q} AND "locationName" ILIKE ${'%' + locationName + '%'}`;
    }

    if (toDate) {
      q = Prisma.sql`${q} AND real_date <= ${new Date(toDate)}::timestamptz`;
    }

    q = Prisma.sql`${q} ORDER BY real_date ASC, min_created_at ASC`;

    const rawEntries = await tx.$queryRaw<
      {
        itemId: string;
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

    type LedgerEvent = {
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

    type ItemLedger = {
      itemName: string;
      itemId: string;
      inEvents: LedgerEvent[];
      outEvents: LedgerEvent[];
    };

    const items = new Map<string, ItemLedger>();

    for (const entry of rawEntries) {
      const netQty = Number(entry.netQty);
      const netValue = Number(entry.netValue);

      const qIn = netQty > 0 ? netQty : 0;
      const vIn = netValue > 0 ? netValue : 0;

      const qOut = netQty < 0 ? Math.abs(netQty) : 0;

      const itemId = entry.itemId;

      if (!items.has(itemId)) {
        items.set(itemId, {
          itemName: entry.itemName || 'Unknown Item',
          itemId: entry.itemId,
          inEvents: [],
          outEvents: [],
        });
      }

      const item = items.get(itemId)!;

      let docLabel = entry.sourceDocType;
      if (docLabel === 'bill') docLabel = 'Bill';
      if (docLabel === 'invoice') docLabel = 'Invoice';
      if (docLabel === 'job_receipt') docLabel = 'Job Receipt';
      if (docLabel === 'job_issue') docLabel = 'Job Issue';
      if (docLabel === 'purchase_order') docLabel = 'Purchase Order';
      if (docLabel === 'item_opening_stock') docLabel = 'Opening Balance';
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
        const existingIn = item.inEvents.find(
          (e) =>
            e.docId === entry.sourceDocId &&
            e.docType === entry.sourceDocType &&
            Math.abs(e.cost - vIn / qIn) < 0.001,
        );
        if (existingIn) {
          existingIn.qty += qIn;
          existingIn.total += vIn;
          existingIn.cost = Math.abs(existingIn.total / existingIn.qty);
        } else {
          item.inEvents.push({
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
        const existingOut = item.outEvents.find(
          (e) => e.docId === entry.sourceDocId && e.docType === entry.sourceDocType,
        );
        if (existingOut) {
          existingOut.qty += qOut;
        } else {
          item.outEvents.push({
            date: entry.date,
            createdAt: entry.createdAt,
            transaction: transactionStr,
            partyName: finalPartyName,
            qty: qOut,
            uom: entry.uomName || 'unit',
            cost: 0,
            total: 0,
            docType: entry.sourceDocType,
            docId: entry.sourceDocId || '',
            partyId,
            partyType,
          });
        }
      }
    }

    const rows: FifoCostLotTrackingRow[] = [];
    const sortedItems = Array.from(items.values()).sort((a, b) =>
      a.itemName.localeCompare(b.itemName),
    );

    let currentItemName = '';

    for (const item of sortedItems) {
      item.inEvents.sort((a, b) => {
        const timeDiff = a.date.getTime() - b.date.getTime();
        return timeDiff !== 0 ? timeDiff : a.createdAt.getTime() - b.createdAt.getTime();
      });
      item.outEvents.sort((a, b) => {
        const timeDiff = a.date.getTime() - b.date.getTime();
        return timeDiff !== 0 ? timeDiff : a.createdAt.getTime() - b.createdAt.getTime();
      });

      let isFirstItemRow = false;

      if (item.itemName !== currentItemName) {
        isFirstItemRow = true;
        currentItemName = item.itemName;
      }

      // Pre-calculate remaining quantities for each IN lot
      let totalOutForItem = item.outEvents.reduce((sum, e) => sum + e.qty, 0);
      const originalInQty = new Map<LedgerEvent, number>();
      const inQtyRemainingMap = new Map<LedgerEvent, number>();
      for (const inEv of item.inEvents) {
        originalInQty.set(inEv, inEv.qty);
        const consumed = Math.min(inEv.qty, totalOutForItem);
        inQtyRemainingMap.set(inEv, inEv.qty - consumed);
        totalOutForItem -= consumed;
      }

      const filterFromDate = fromDate ? new Date(fromDate).getTime() : 0;
      const filterToDate = toDate ? new Date(toDate).getTime() : Infinity;

      let inIndex = 0;
      let outIndex = 0;
      const inEvPrinted = new Set<LedgerEvent>();

      while (inIndex < item.inEvents.length || outIndex < item.outEvents.length) {
        const inEv = item.inEvents[inIndex];
        const outEv = item.outEvents[outIndex];

        let outQtyToPrint = 0;
        let matchQty = 0;

        if (inEv && outEv) {
          matchQty = Math.min(inEv.qty, outEv.qty);
          outQtyToPrint = matchQty;
        } else if (outEv) {
          outQtyToPrint = outEv.qty;
        }

        let shouldPrintPair = false;

        if (isProductOut) {
          if (outEv) {
            const outTime = outEv.date.getTime();
            if (outTime >= filterFromDate && outTime <= filterToDate) {
              shouldPrintPair = true;
            }
          }
        } else {
          if (inEv) {
            const inTime = inEv.date.getTime();
            if (inTime >= filterFromDate && inTime <= filterToDate) {
              if (outEv && matchQty > 0) {
                shouldPrintPair = true;
                inEvPrinted.add(inEv);
              } else {
                if (!inEvPrinted.has(inEv)) {
                  shouldPrintPair = true;
                  inEvPrinted.add(inEv);
                }
              }
            }
          }
        }

        if (shouldPrintPair) {
          const ageStr =
            inEv && differenceInDays(new Date(), inEv.date) > 0
              ? `${differenceInDays(new Date(), inEv.date)} Days`
              : '';
          const origQty = inEv ? originalInQty.get(inEv) || inEv.qty : 0;
          const remaining = inEv ? inQtyRemainingMap.get(inEv) || 0 : 0;

          // If we print an untouched lot in Product In mode, outEv might be defined but not matching (or outEv is null).
          // Actually, if matchQty == 0, we should treat outEv as null for printing purposes.
          const printOutEv = outEv && (isProductOut || matchQty > 0) ? outEv : null;

          rows.push({
            itemName: isFirstItemRow ? item.itemName : '',

            inDate: inEv ? format(inEv.date, 'dd-MM-yyyy') : null,
            inTransaction: inEv ? inEv.transaction : '',
            inReceivedFrom: inEv ? inEv.partyName : '',
            inQty: inEv ? Number(origQty.toFixed(4)) : null,
            inQtyUnit: inEv ? inEv.uom : '',
            inQtyRemaining: inEv ? Number(remaining.toFixed(4)) : 0,
            inAge: ageStr,
            inCost: inEv ? inEv.cost.toFixed(2) : '',
            inTotal: inEv ? (origQty * inEv.cost).toFixed(2) : '',
            inDocType: inEv ? inEv.docType : '',
            inDocId: inEv ? inEv.docId : '',
            inPartyId: inEv ? inEv.partyId : null,
            inPartyType: inEv ? inEv.partyType : null,

            outDate: printOutEv ? format(printOutEv.date, 'dd-MM-yyyy') : null,
            outTransaction: printOutEv ? printOutEv.transaction : '',
            outDispersedTo: printOutEv ? printOutEv.partyName : '',
            outQty: printOutEv ? Number(outQtyToPrint.toFixed(4)) : null,
            outQtyUnit: printOutEv ? printOutEv.uom : '',
            outDocType: printOutEv ? printOutEv.docType : '',
            outDocId: printOutEv ? printOutEv.docId : '',
            outPartyId: printOutEv ? printOutEv.partyId : null,
            outPartyType: printOutEv ? printOutEv.partyType : null,
          });
          isFirstItemRow = false;
        }

        if (inEv && outEv) {
          inEv.qty -= matchQty;
          outEv.qty -= matchQty;
          if (inEv.qty <= 0.0001) inIndex++;
          if (outEv.qty <= 0.0001) outIndex++;
        } else if (inEv) {
          inIndex++;
        } else if (outEv) {
          outIndex++;
        }
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
