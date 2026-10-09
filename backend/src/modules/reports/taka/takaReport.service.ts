import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { isExternalLocation } from '../../jobwork/jobwork.types.ts';
import type {
  PaginatedTakaReportResponse,
  TakaReportQuery,
  TakaReportRow,
} from './takaReport.schemas.ts';

type RawRow = {
  id: string;
  batchUnitId: string | null;
  batchId: string;
  locationId: string;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  lastInHere: Date | null;
  firstInAnywhere: Date | null;
  receivedQty: Prisma.Decimal | null;
  unitLabel: string | null;
  unitSourceDocType: string | null;
  unitSourceDocId: string | null;
  unitSourceDocNumber: string | null;
  batchSupplierRef: string | null;
  batchNumber: string;
  itemId: string;
  itemName: string;
  uomName: string | null;
  locationName: string;
  locationType: string;
  challanNumber: string | null;
};

export async function getTakaReport(
  organizationId: string,
  query: TakaReportQuery,
): Promise<PaginatedTakaReportResponse> {
  const {
    itemName,
    locationName,
    batchText,
    onlyAtJobWorkers,
    asOnDate,
    fromDate,
    toDate,
    minAgeDays,
    page,
    perPage,
  } = query;

  return runAsTenant(organizationId, async (tx) => {
    const filters = [
      itemName ? Prisma.sql`i.name ILIKE ${`%${itemName}%`}` : null,
      locationName ? Prisma.sql`loc.name ILIKE ${`%${locationName}%`}` : null,
      batchText
        ? Prisma.sql`(b.supplier_batch_ref ILIKE ${`%${batchText}%`} OR b.batch_number ILIKE ${`%${batchText}%`})`
        : null,
      onlyAtJobWorkers ? Prisma.sql`loc.type IN ('vendor_location', 'customer_location')` : null,
      minAgeDays !== undefined
        ? Prisma.sql`(EXTRACT(DAY FROM CURRENT_TIMESTAMP - bal.last_in_here) >= ${minAgeDays})`
        : null,
      fromDate ? Prisma.sql`ins.first_in_anywhere >= ${new Date(fromDate)}` : null,
      toDate ? Prisma.sql`ins.first_in_anywhere <= ${new Date(toDate)}` : null,
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
        WITH inward_stats AS (
          SELECT 
            batch_id, 
            batch_unit_id, 
            MIN(posted_at) AS first_in_anywhere, 
            SUM(qty_in) AS received_qty
          FROM stock_ledger
          WHERE organization_id = ${organizationId}::uuid AND qty_in > 0
          GROUP BY batch_id, batch_unit_id
        ),
        balances AS (
          SELECT
            l.batch_unit_id,
            l.batch_id,
            l.location_id,
            SUM(l.qty_in - l.qty_out) AS qty,
            SUM(l.value_in - l.value_out) AS value,
            MAX(l.posted_at) FILTER (WHERE l.qty_in > 0) AS last_in_here
          FROM stock_ledger l
          WHERE l.organization_id = ${organizationId}::uuid
            ${asOnCondition}
            AND (
              l.batch_unit_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM batch_units u WHERE u.batch_id = l.batch_id AND NOT u.is_deleted)
            )
          GROUP BY l.batch_unit_id, l.batch_id, l.location_id
          HAVING SUM(l.qty_in - l.qty_out) <> 0
        )
        SELECT
          bal.batch_unit_id,
          bal.batch_id,
          bal.location_id,
          bal.qty,
          bal.value,
          bal.last_in_here,
          ins.first_in_anywhere,
          ins.received_qty
        FROM balances bal
        LEFT JOIN inward_stats ins ON ins.batch_id = bal.batch_id AND (ins.batch_unit_id = bal.batch_unit_id OR (ins.batch_unit_id IS NULL AND bal.batch_unit_id IS NULL))
      ) bal
      JOIN batches b ON b.id = bal.batch_id
      JOIN items i ON i.id = b.item_id
      JOIN locations loc ON loc.id = bal.location_id
      LEFT JOIN batch_units bu ON bu.id = bal.batch_unit_id
      LEFT JOIN job_issue_lines il ON il.batch_id = b.id AND loc.type IN ('vendor_location', 'customer_location')
      LEFT JOIN job_issues ji ON ji.id = il.job_issue_id AND ji.destination_location_id = loc.id AND ji.status != 'draft' AND ji.status != 'cancelled' AND ji.status != 'closed'
      ${where}
    `;

    // NOTE: The above LEFT JOIN for open challans (ji) is a bit loose because multiple challans could match
    // if goods are sent multiple times. We just grab MAX(ji.challan_number) in the SELECT if needed.

    const totals = await tx.$queryRaw<{ count: bigint; value: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(bal.value), 0) AS value ${from}`;
    const total = Number(totals[0]?.count ?? 0);

    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT
        COALESCE(bal.batch_unit_id::text, bal.batch_id::text || ':untagged') || ':' || bal.location_id::text AS id,
        bal.batch_unit_id AS "batchUnitId",
        bal.batch_id AS "batchId",
        bal.location_id AS "locationId",
        bal.qty,
        bal.value,
        bal.last_in_here AS "lastInHere",
        bal.first_in_anywhere AS "firstInAnywhere",
        bal.received_qty AS "receivedQty",
        bu.label AS "unitLabel",
        bu.source_doc_type AS "unitSourceDocType",
        bu.source_doc_id AS "unitSourceDocId",
        CASE 
          WHEN bu.source_doc_type = 'job_issue' THEN (SELECT challan_number FROM job_issues WHERE id = bu.source_doc_id)
          WHEN bu.source_doc_type = 'job_receipt' THEN (SELECT receipt_number FROM job_receipts WHERE id = bu.source_doc_id)
          WHEN bu.source_doc_type = 'job_order_material_in' THEN (SELECT job_order_number FROM job_orders WHERE id = bu.source_doc_id)
          ELSE NULL
        END AS "unitSourceDocNumber",
        b.supplier_batch_ref AS "batchSupplierRef",
        b.batch_number AS "batchNumber",
        i.id AS "itemId",
        i.name AS "itemName",
        (SELECT COALESCE(NULLIF(u.symbol, ''), u.unit_name) FROM units_of_measurement u WHERE u.id = i.stocking_uom_id) AS "uomName",
        loc.name AS "locationName",
        loc.type AS "locationType",
        MAX(ji.challan_number) AS "challanNumber"
      ${from}
      GROUP BY bal.batch_unit_id, bal.batch_id, bal.location_id, bal.qty, bal.value, bal.last_in_here, bal.first_in_anywhere, bal.received_qty, bu.label, bu.source_doc_type, bu.source_doc_id, b.supplier_batch_ref, b.batch_number, i.id, i.name, loc.name, loc.type, bu.created_at, b.created_at
      ORDER BY COALESCE(bu.created_at, b.created_at) DESC, b.batch_number ASC
      ${perPage ? Prisma.sql`LIMIT ${perPage} OFFSET ${((page || 1) - 1) * perPage}` : Prisma.empty}
    `;

    const results: TakaReportRow[] = rows.map((row) => {
      const daysAtLocation = row.lastInHere
        ? Math.floor((Date.now() - row.lastInHere.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: row.id,
        itemId: row.itemId,
        label: row.unitLabel || '(untagged)',
        itemName: row.itemName + (row.uomName ? ` (${row.uomName})` : ''),
        batch: row.batchSupplierRef || row.batchNumber,
        locationName: row.locationName,
        qty: Number(row.qty),
        receivedOn: row.firstInAnywhere,
        daysAtLocation,
        sourceDocType: row.unitSourceDocType,
        sourceDocNumber: row.unitSourceDocNumber,
        sourceDocId: row.unitSourceDocId,
        receivedQty: row.receivedQty ? Number(row.receivedQty) : null,
        challanNumber: isExternalLocation(row.locationType) ? row.challanNumber : null,
        value: Number(row.value),
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
