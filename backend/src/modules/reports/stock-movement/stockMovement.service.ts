import { runAsTenant } from '../../../db/prisma.ts';
import type {
  StockMovementQuery,
  PaginatedStockMovementResponse,
} from './stockMovement.schemas.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';

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
      itemId: string;
      itemName: string;
      createdAt: Date;
      transactionType: string;
      movementType: 'Inward' | 'Outward';
      source: string;
      destination: string;
      quantity: string | number | bigint;
    };

    const { itemId, locationId, fromDate, toDate, movementType = 'all', page = 1, perPage = 25 } = query;

    const fromDateFilter = fromDate
      ? Prisma.sql`l.posted_at::date >= ${new Date(fromDate)}::timestamptz::date`
      : Prisma.sql`true`;

    const toDateFilter = toDate
      ? Prisma.sql`l.posted_at::date <= ${new Date(toDate)}::timestamptz::date`
      : Prisma.sql`true`;

    // Applied to the netted row: an edited bill's reversal is an out-row, so a
    // row-level `qty_in > 0` kept every superseded posting and dropped what undid it.
    let movementFilter = Prisma.sql`true`;
    if (movementType === 'inward') {
      movementFilter = Prisma.sql`d.net > 0 AND d.source_doc_type != 'item_opening_stock'`;
    } else if (movementType === 'outward') {
      movementFilter = Prisma.sql`d.net < 0 AND d.source_doc_type != 'item_opening_stock'`;
    }

    const itemFilter = itemId ? Prisma.sql`l.item_id = ${itemId}::uuid` : Prisma.sql`true`;
    const locationFilter = locationId ? Prisma.sql`l.location_id = ${locationId}::uuid` : Prisma.sql`true`;

    // One row per document, item and location, netted: an edit posts a reversal
    // and a re-post rather than rewriting its rows, so the raw ledger lists a bill
    // once per save. A null source doc keys on the row itself so unrelated rows never merge.
    const docMoves = Prisma.sql`
      SELECT
        MAX(l.id::text) AS id,
        MAX(l.posted_at) AS posted_at,
        MAX(l.created_at) AS created_at,
        l.source_doc_type,
        MAX(l.source_doc_id::text)::uuid AS source_doc_id,
        l.item_id,
        l.location_id,
        SUM(l.qty_in - l.qty_out) AS net
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'physical')
        AND ${OWN_PLACE}
        AND ${fromDateFilter}
        AND ${toDateFilter}
        AND ${itemFilter}
        AND ${locationFilter}
      GROUP BY l.source_doc_type, COALESCE(l.source_doc_id, l.id), l.item_id, l.location_id
    `;

    const netted = Prisma.sql`
      SELECT d.* FROM (${docMoves}) d
      WHERE d.net <> 0
        AND ${movementFilter}
    `;

    const totals = await tx.$queryRaw<
      { count: string | number | bigint; quantity: string | number | null }[]
    >`SELECT COUNT(*) AS count, COALESCE(SUM(ABS(n.net)), 0) AS quantity FROM (${netted}) n`;
    const total = Number(totals[0]?.count || 0);
    const grandTotalQuantity = Number(totals[0]?.quantity || 0);

    const transactionTypeAndSource = Prisma.sql`REPLACE(n.source_doc_type, '_', ' ')`;

    const rawRows = await tx.$queryRaw<RawRow[]>`
      SELECT
        n.id,
        n.posted_at AS "transactionDate",
        COALESCE(
          CASE
            WHEN n.source_doc_type = 'bill' THEN (SELECT bill_number FROM bills WHERE id = n.source_doc_id)
            WHEN n.source_doc_type = 'job_receipt' THEN (SELECT receipt_number FROM job_receipts WHERE id = n.source_doc_id)
            WHEN n.source_doc_type = 'job_issue' THEN (SELECT challan_number FROM job_issues WHERE id = n.source_doc_id)
            WHEN n.source_doc_type = 'purchase_order' THEN (SELECT po_number FROM purchase_orders WHERE id = n.source_doc_id)
            ELSE n.source_doc_id::text
          END,
          '-'
        ) AS "transactionNumber",
        n.item_id AS "itemId",
        i.name AS "itemName",
        n.created_at AS "createdAt",
        ${transactionTypeAndSource} AS "transactionType",
        CASE WHEN n.net > 0 THEN 'Inward' ELSE 'Outward' END AS "movementType",
        ${transactionTypeAndSource} AS "source",
        COALESCE((SELECT loc.name FROM locations loc WHERE loc.id = n.location_id), '-') AS "destination",
        ABS(n.net) AS "quantity"
      FROM (${netted}) n
      JOIN items i ON n.item_id = i.id
      ORDER BY n.posted_at DESC, n.created_at DESC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `;

    const mappedRows = rawRows.map((row) => ({
      id: row.id,
      transactionDate: row.transactionDate,
      transactionNumber: row.transactionNumber,
      itemId: row.itemId,
      itemName: row.itemName,
      createdAt: row.createdAt,
      transactionType: row.transactionType,
      movementType: row.movementType,
      source: row.source,
      destination: row.destination,
      quantity: Number(row.quantity),
    }));

    const totalPages = Math.ceil(total / perPage);

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
