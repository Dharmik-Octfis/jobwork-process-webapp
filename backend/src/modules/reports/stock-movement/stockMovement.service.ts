import { runAsTenant } from '../../../db/prisma.ts';
import type { StockMovementQuery, PaginatedStockMovementResponse } from './stockMovement.schemas.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';

const COUNTED_SOURCE = Prisma.sql`
  (
    l.source_doc_type != 'job_receipt'
    OR EXISTS (
      SELECT 1 FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
      WHERE bi.job_receipt_id = l.source_doc_id
        AND bi.item_id = l.item_id
        AND bi.is_deleted = false
        AND b.is_deleted = false
        AND LOWER(b.status) = 'open'
    )
  )`;

const OWN_PLACE = Prisma.sql`
  EXISTS (
    SELECT 1 FROM locations loc
    WHERE loc.id = l.location_id
    AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
  )`;

export async function getStockMovementReport(
  organizationId: string,
  query: StockMovementQuery,
): Promise<PaginatedStockMovementResponse> {
  return runAsTenant(organizationId, async (tx) => {
    type RawRow = {
      id: string;
      transactionDate: Date;
      transactionNumber: string;
      itemName: string;
      transactionType: string;
      movementType: 'Inward' | 'Outward';
      source: string;
      destination: string;
      quantity: string | number | bigint;
    };

    const {
      itemId,
      fromDate,
      toDate,
      mode = 'bills_and_invoices',
      movementType = 'all',
      page = 1,
      perPage = 25,
    } = query;

    let countedSourceFilter = Prisma.sql`true`;
    if (mode === 'bills') {
      countedSourceFilter = Prisma.sql`l.source_doc_type = 'bill'`;
    } else if (mode === 'jobwork') {
      countedSourceFilter = Prisma.sql`l.source_doc_type IN ('job_issue', 'job_receipt')`;
    } else if (mode === 'bills_and_invoices') {
      countedSourceFilter = COUNTED_SOURCE;
    }

    const fromDateFilter = fromDate
      ? Prisma.sql`l.posted_at >= ${new Date(fromDate)}::timestamptz`
      : Prisma.sql`true`;
      
    const toDateFilter = toDate
      ? Prisma.sql`l.posted_at <= ${new Date(toDate)}::timestamptz`
      : Prisma.sql`true`;

    let movementFilter = Prisma.sql`true`;
    if (movementType === 'inward') {
      movementFilter = Prisma.sql`l.qty_in > 0 AND l.source_doc_type != 'item_opening_stock'`;
    } else if (movementType === 'outward') {
      movementFilter = Prisma.sql`l.qty_out > 0 AND l.source_doc_type != 'item_opening_stock'`;
    }

    let q = Prisma.sql`
      SELECT
        l.id,
        l.posted_at AS "transactionDate",
        COALESCE(
          CASE 
            WHEN l.source_doc_type = 'bill' THEN (SELECT bill_number FROM bills WHERE id = l.source_doc_id)
            WHEN l.source_doc_type = 'job_receipt' THEN (SELECT receipt_number FROM job_receipts WHERE id = l.source_doc_id)
            WHEN l.source_doc_type = 'job_issue' THEN (SELECT challan_number FROM job_issues WHERE id = l.source_doc_id)
            WHEN l.source_doc_type = 'purchase_order' THEN (SELECT po_number FROM purchase_orders WHERE id = l.source_doc_id)
            ELSE l.source_doc_id::text
          END,
          '-'
        ) AS "transactionNumber",
        i.name AS "itemName",
        REPLACE(l.source_doc_type, '_', ' ') AS "transactionType",
        CASE WHEN l.qty_in > 0 THEN 'Inward' ELSE 'Outward' END AS "movementType",
        REPLACE(l.source_doc_type, '_', ' ') AS "source",
        COALESCE((SELECT loc.name FROM locations loc WHERE loc.id = l.location_id), '-') AS "destination",
        CASE WHEN l.qty_in > 0 THEN l.qty_in ELSE l.qty_out END AS "quantity"
      FROM stock_ledger l
      JOIN items i ON l.item_id = i.id
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'physical')
        AND ${countedSourceFilter}
        AND ${OWN_PLACE}
        AND ${fromDateFilter}
        AND ${toDateFilter}
        AND ${movementFilter}
    `;

    if (itemId) {
      q = Prisma.sql`${q} AND l.item_id = ${itemId}::uuid`;
    }

    const countQuery = Prisma.sql`SELECT COUNT(*) as count FROM (${q}) as sub`;
    const countResult = await tx.$queryRaw<{ count: string | number | bigint }[]>`${countQuery}`;
    const total = Number(countResult[0]?.count || 0);

    q = Prisma.sql`${q} ORDER BY l.posted_at DESC, l.id DESC`;
    q = Prisma.sql`${q} LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

    const rawRows = await tx.$queryRaw<RawRow[]>`${q}`;

    const mappedRows = rawRows.map((row) => ({
      id: row.id,
      transactionDate: row.transactionDate,
      transactionNumber: row.transactionNumber,
      itemName: row.itemName,
      transactionType: row.transactionType,
      movementType: row.movementType,
      source: row.source,
      destination: row.destination,
      quantity: Number(row.quantity),
    }));

    const totalPages = Math.ceil(total / perPage);
    const grandTotalQuantity = mappedRows.reduce((sum, row) => sum + row.quantity, 0);

    return {
      results: mappedRows,
      total,
      page,
      perPage,
      totalPages,
      grandTotalQuantity,
    };
  });
}
