import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  BatchReportQuery,
  BatchReportRow,
  PaginatedBatchReportResponse,
} from './batchReport.schemas.ts';

type RawRow = {
  id: string;
  batchId: string;
  batchLabel: string | null;
  itemId: string;
  itemName: string;
  uomName: string | null;
  locationId: string;
  locationName: string;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  receivedOn: Date | null;
  sourceDocType: string | null;
  sourceDocNumber: string | null;
  sourceDocId: string | null;
  state: string;
  batchNumber: string;
  parentBatches: string | null;
  takaCount: bigint;
  untaggedQty: Prisma.Decimal | null;
  hasUnits: boolean;
};

export async function getBatchReport(
  organizationId: string,
  query: BatchReportQuery,
): Promise<PaginatedBatchReportResponse> {
  const { itemName, locationName, batchText, state, asOnDate, fromDate, toDate, minAgeDays, page, perPage } = query;

  return runAsTenant(organizationId, async (tx) => {
    const filters = [
      itemName ? Prisma.sql`i.name ILIKE ${`%${itemName}%`}` : null,
      locationName ? Prisma.sql`loc.name ILIKE ${`%${locationName}%`}` : null,
      batchText
        ? Prisma.sql`(b.supplier_batch_ref ILIKE ${`%${batchText}%`} OR b.batch_number ILIKE ${`%${batchText}%`})`
        : null,
      state ? Prisma.sql`b.state = ${state}` : null,
      minAgeDays !== undefined
        ? Prisma.sql`(EXTRACT(DAY FROM CURRENT_TIMESTAMP - bal.received_on) >= ${minAgeDays})`
        : null,
      fromDate ? Prisma.sql`bal.received_on >= ${new Date(fromDate)}` : null,
      toDate ? Prisma.sql`bal.received_on <= ${new Date(toDate)}` : null,
      Prisma.sql`b.state != 'draft'`,
      Prisma.sql`b.is_deleted = false`,
      Prisma.sql`i.is_deleted = false`,
      Prisma.sql`loc.is_deleted = false`,
    ].filter((f): f is Prisma.Sql => f !== null);

    const asOnCondition = asOnDate
      ? Prisma.sql`AND l.posted_at <= ${new Date(asOnDate)}`
      : Prisma.empty;

    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;

    const from = Prisma.sql`
      FROM (
        WITH unit_balances AS (
          SELECT
            l.batch_id,
            l.location_id,
            l.batch_unit_id,
            SUM(l.qty_in - l.qty_out) AS qty,
            SUM(l.value_in - l.value_out) AS value,
            MIN(l.posted_at) FILTER (WHERE l.qty_in > 0) AS min_posted_in
          FROM stock_ledger l
          WHERE l.organization_id = ${organizationId}::uuid
            ${asOnCondition}
          GROUP BY l.batch_id, l.location_id, l.batch_unit_id
          HAVING SUM(l.qty_in - l.qty_out) <> 0
        )
        SELECT
          ub.batch_id,
          ub.location_id,
          SUM(ub.qty) AS qty,
          SUM(ub.value) AS value,
          MIN(ub.min_posted_in) AS received_on,
          COUNT(ub.batch_unit_id) AS taka_count,
          SUM(ub.qty) FILTER (WHERE ub.batch_unit_id IS NULL) AS untagged_qty
        FROM unit_balances ub
        GROUP BY ub.batch_id, ub.location_id
      ) bal
      JOIN batches b ON b.id = bal.batch_id
      JOIN items i ON i.id = b.item_id
      JOIN locations loc ON loc.id = bal.location_id
      ${where}`;

    const totals = await tx.$queryRaw<{ count: bigint; value: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(bal.value), 0) AS value ${from}`;
    const total = Number(totals[0]?.count ?? 0);

    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT
        bal.batch_id::text || ':' || bal.location_id::text AS id,
        bal.batch_id AS "batchId",
        b.supplier_batch_ref AS "batchLabel",
        i.id AS "itemId",
        i.name AS "itemName",
        (SELECT COALESCE(NULLIF(u.symbol, ''), u.unit_name) FROM units_of_measurement u WHERE u.id = i.stocking_uom_id) AS "uomName",
        loc.id AS "locationId",
        loc.name AS "locationName",
        bal.qty,
        bal.value,
        bal.received_on AS "receivedOn",
        b.source_doc_type AS "sourceDocType",
        CASE 
          WHEN b.source_doc_type = 'job_issue' THEN (SELECT challan_number FROM job_issues WHERE id = b.source_doc_id)
          WHEN b.source_doc_type = 'job_receipt' THEN (SELECT receipt_number FROM job_receipts WHERE id = b.source_doc_id)
          WHEN b.source_doc_type = 'job_order_material_in' THEN (SELECT job_order_number FROM job_orders WHERE id = b.source_doc_id)
          ELSE NULL
        END AS "sourceDocNumber",
        b.source_doc_id AS "sourceDocId",
        b.state,
        b.batch_number AS "batchNumber",
        (
          SELECT string_agg(pb.supplier_batch_ref, ', ')
          FROM batches pb
          WHERE pb.id = ANY(b.parent_batch_ids)
        ) AS "parentBatches",
        bal.taka_count AS "takaCount",
        bal.untagged_qty AS "untaggedQty",
        EXISTS(SELECT 1 FROM batch_units bu WHERE bu.batch_id = b.id AND bu.is_deleted = false) AS "hasUnits"
      ${from}
      ORDER BY b.created_at DESC, b.batch_number ASC
      ${perPage ? Prisma.sql`LIMIT ${perPage} OFFSET ${((page || 1) - 1) * perPage}` : Prisma.empty}`;

    const results: BatchReportRow[] = rows.map((row) => {
      const qty = Number(row.qty);
      const value = Number(row.value);
      const avgRate = qty !== 0 ? value / qty : 0;
      const ageDays = row.receivedOn
        ? Math.floor((Date.now() - row.receivedOn.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: row.id,
        itemId: row.itemId,
        batch: row.batchLabel || row.batchNumber,
        itemName: row.itemName + (row.uomName ? ` (${row.uomName})` : ''),
        locationName: row.locationName,
        qty,
        takaCount: row.hasUnits ? Number(row.takaCount) : null,
        untaggedQty: row.hasUnits ? Number(row.untaggedQty) : null,
        receivedOn: row.receivedOn,
        ageDays,
        sourceDocType: row.sourceDocType,
        sourceDocNumber: row.sourceDocNumber,
        sourceDocId: row.sourceDocId,
        state: row.state,
        batchNumber: row.batchNumber,
        value,
        avgRate,
        parentBatches: row.parentBatches,
      };
    });

    const totalPages = perPage ? Math.ceil(total / perPage) : 1;

    return {
      results,
      total,
      page: perPage ? (page || 1) : 1,
      perPage: perPage ?? total,
      totalPages,
      grandTotalValue: Number(totals[0]?.value ?? 0),
    };
  });
}
