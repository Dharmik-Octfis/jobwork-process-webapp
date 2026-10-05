import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { SOURCE_DOC_TYPES } from '../../jobwork/jobwork.types.ts';
import type {
  JobOrderLossQuery,
  JobOrderLossRow,
  PaginatedJobOrderLossResponse,
} from './jobOrderLoss.schemas.ts';

/**
 * 🔴 EVERY WRITE-OFF IS ALREADY A LEDGER ROW — this report only reads them.
 *
 * Completing a step or closing an order short scraps what is still at the processor
 * (`jobOrders.writeOff.ts`, landed-cost R8): one `scrap` row per open challan line,
 * `source_doc_type = 'job_order_step'`, at that line's FIFO cost. Nothing else posts
 * against that doc type, so the rows ARE the loss. Netted per challan line so a
 * reversal, should one ever post, cancels its write-off instead of listing twice.
 */

type RawRow = {
  id: string;
  writtenOffAt: Date;
  jobOrderId: string;
  jobOrderNumber: string;
  stepSeq: number;
  processName: string;
  closedAs: string;
  jobIssueId: string | null;
  challanNumber: string | null;
  processorName: string | null;
  itemId: string;
  itemName: string;
  uomName: string | null;
  batchNumber: string | null;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  remarks: string | null;
};

const WRITE_OFF_SUFFIX = ' — still at the processor, written off as job order loss.';
const REASON_PREFIXES = ['Step completed: ', 'Closed short: '];

/** The typed reason out of the remark `writeOffStep` stored, or null when none was typed. */
function reasonFrom(remarks: string | null): string | null {
  if (!remarks?.endsWith(WRITE_OFF_SUFFIX)) return remarks;
  const head = remarks.slice(0, -WRITE_OFF_SUFFIX.length);
  const prefix = REASON_PREFIXES.find((p) => head.startsWith(p));
  return prefix ? head.slice(prefix.length) || null : null;
}

export async function getJobOrderLossReport(
  organizationId: string,
  query: JobOrderLossQuery,
): Promise<PaginatedJobOrderLossResponse> {
  const { fromDate, toDate, itemName, processorName, jobOrderNumber, page, perPage } = query;

  return runAsTenant(organizationId, async (tx) => {
    const filters = [
      fromDate ? Prisma.sql`w.written_off_at >= ${new Date(fromDate)}` : null,
      toDate ? Prisma.sql`w.written_off_at <= ${new Date(toDate)}` : null,
      itemName ? Prisma.sql`i.name ILIKE ${`%${itemName}%`}` : null,
      processorName
        ? Prisma.sql`COALESCE(ji.processor_name_snapshot, s.processor_name_snapshot) ILIKE ${`%${processorName}%`}`
        : null,
      jobOrderNumber ? Prisma.sql`jo.job_order_number ILIKE ${`%${jobOrderNumber}%`}` : null,
    ].filter((f): f is Prisma.Sql => f !== null);
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;

    const from = Prisma.sql`
      FROM (
        SELECT
          l.source_doc_id AS step_id,
          l.source_doc_line_id AS line_id,
          l.item_id,
          l.batch_id,
          MAX(l.posted_at) AS written_off_at,
          SUM(l.qty_out - l.qty_in) AS qty,
          SUM(l.value_out - l.value_in) AS value,
          MAX(l.remarks) FILTER (WHERE l.qty_out > 0) AS remarks
        FROM stock_ledger l
        WHERE l.organization_id = ${organizationId}::uuid
          AND l.source_doc_type = ${SOURCE_DOC_TYPES.jobOrderStep}
        GROUP BY l.source_doc_id, l.source_doc_line_id, l.item_id, l.batch_id
        HAVING SUM(l.qty_out - l.qty_in) <> 0
      ) w
      JOIN job_order_steps s ON s.id = w.step_id
      JOIN job_orders jo ON jo.id = s.job_order_id
      JOIN items i ON i.id = w.item_id
      LEFT JOIN job_issue_lines il ON il.id = w.line_id
      LEFT JOIN job_issues ji ON ji.id = il.job_issue_id
      LEFT JOIN processes p ON p.id = s.process_id
      ${where}`;

    const totals = await tx.$queryRaw<{ count: bigint; value: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(w.value), 0) AS value ${from}`;
    const total = Number(totals[0]?.count ?? 0);

    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT
        COALESCE(w.line_id, w.step_id)::text || ':' || w.batch_id::text AS id,
        w.written_off_at AS "writtenOffAt",
        jo.id AS "jobOrderId",
        jo.job_order_number AS "jobOrderNumber",
        s.seq AS "stepSeq",
        COALESCE(NULLIF(p.code, ''), s.process_name_snapshot) AS "processName",
        s.status AS "closedAs",
        ji.id AS "jobIssueId",
        ji.challan_number AS "challanNumber",
        COALESCE(ji.processor_name_snapshot, s.processor_name_snapshot) AS "processorName",
        i.id AS "itemId",
        i.name AS "itemName",
        (SELECT u.unit_name FROM units_of_measurement u WHERE u.id = i.stocking_uom_id) AS "uomName",
        (SELECT b.batch_number FROM batches b WHERE b.id = w.batch_id) AS "batchNumber",
        w.qty,
        w.value,
        w.remarks
      ${from}
      ORDER BY w.written_off_at DESC, jo.job_order_number DESC, s.seq ASC, ji.challan_number ASC
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

    const results: JobOrderLossRow[] = rows.map(({ remarks, qty, value, ...row }) => ({
      ...row,
      qty: Number(qty),
      value: Number(value),
      reason: reasonFrom(remarks),
    }));

    return {
      results,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      grandTotalValue: Number(totals[0]?.value ?? 0),
    };
  });
}
