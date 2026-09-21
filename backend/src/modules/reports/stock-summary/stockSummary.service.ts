import { runAsTenant } from '../../../db/prisma.ts';
import type { StockSummaryQuery, PaginatedStockSummaryResponse } from './stockSummary.schemas.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';

const OWN_PLACE = Prisma.sql`
  EXISTS (
    SELECT 1 FROM locations loc
    WHERE loc.id = l.location_id
    AND (loc.type IS NULL OR loc.type NOT IN ('processor', 'in_transit', 'customer_site'))
  )`;

export async function getStockSummaryReport(
  organizationId: string,
  query: StockSummaryQuery,
): Promise<PaginatedStockSummaryResponse> {
  return runAsTenant(organizationId, async (tx) => {
    type RawRow = {
      itemId: string;
      itemName: string;
      categoryName: string | null;
      uomName: string | null;
      sku: string | null;
      hsnCode: string | null;
      customFields: Record<string, unknown>;
      openingStock: string | number | bigint;
      quantityIn: string | number | bigint;
      quantityOut: string | number | bigint;
      closingStock: string | number | bigint;
    };

    const {
      fromDate,
      toDate,
      mode = 'bills',
      status = 'all',
      itemName,
      categoryName,
      locationId,
      sku,
      hsnCode,
      itemCustomFields,
    } = query;

    let countedSourceFilter = Prisma.sql`true`;
    if (mode === 'bills') {
      countedSourceFilter = Prisma.sql`l.source_doc_type = 'bill'`;
    } else if (mode === 'jobwork') {
      countedSourceFilter = Prisma.sql`l.source_doc_type IN ('job_issue', 'job_receipt')`;
    }

    const fromDateFilter = fromDate
      ? Prisma.sql`l.posted_at >= ${new Date(fromDate)}::timestamptz`
      : Prisma.sql`true`;

    const toDateFilter = toDate
      ? Prisma.sql`l.posted_at <= ${new Date(toDate)}::timestamptz`
      : Prisma.sql`true`;

    const beforeFromDateFilter = fromDate
      ? Prisma.sql`l.posted_at < ${new Date(fromDate)}::timestamptz`
      : Prisma.sql`false`;

    // In/Out net each document per location first: an edited bill keeps its
    // superseded postings and their reversals, so summing raw qty_in/qty_out
    // counted every save (in 300 / out 200 for one 100-unit bill).
    const docMoves = Prisma.sql`
      SELECT
        l.item_id,
        SUM(CASE WHEN ${beforeFromDateFilter} OR (l.source_doc_type = 'item_opening_stock' AND ${toDateFilter}) THEN l.qty_in - l.qty_out ELSE 0 END) AS opening,
        SUM(CASE WHEN ${fromDateFilter} AND ${toDateFilter} AND l.source_doc_type != 'item_opening_stock' THEN l.qty_in - l.qty_out ELSE 0 END) AS period_net,
        SUM(CASE WHEN ${toDateFilter} THEN l.qty_in - l.qty_out ELSE 0 END) AS closing
      FROM stock_ledger l
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.ownership = 'own'
        AND l.stock_effect IN ('both', 'physical')
        AND ${countedSourceFilter}
        ${locationId ? Prisma.sql`AND l.location_id = ${locationId}::uuid` : Prisma.empty}
        AND ${OWN_PLACE}
      GROUP BY l.item_id, l.source_doc_type, COALESCE(l.source_doc_id, l.id), l.location_id
    `;

    let q = Prisma.sql`
      SELECT
        i.id AS "itemId",
        i.name AS "itemName",
        i.category AS "categoryName",
        i.sku AS "sku",
        i.hsn_code AS "hsnCode",
        i.custom_fields AS "customFields",
        u.unit_name AS "uomName",
        COALESCE(SUM(d.opening), 0) AS "openingStock",
        COALESCE(SUM(GREATEST(d.period_net, 0)), 0) AS "quantityIn",
        COALESCE(SUM(GREATEST(-d.period_net, 0)), 0) AS "quantityOut",
        COALESCE(SUM(d.closing), 0) AS "closingStock"
      FROM items i
      LEFT JOIN units_of_measurement u ON i.stocking_uom_id = u.id
      LEFT JOIN (${docMoves}) d ON d.item_id = i.id
    `;

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

    // Removed HAVING clause to show all matching items even with 0 stock/movement
    q = Prisma.sql`${q} ORDER BY i.name ASC`;

    const rawRows = await tx.$queryRaw<RawRow[]>`${q}`;

    const mappedRows = rawRows.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      sku: row.sku,
      hsnCode: row.hsnCode,
      customFields: row.customFields || {},
      uomName: row.uomName,
      openingStock: Number(row.openingStock),
      quantityIn: Number(row.quantityIn),
      quantityOut: Number(row.quantityOut),
      closingStock: Number(row.closingStock),
    }));

    const grandTotalOpening = mappedRows.reduce((sum, row) => sum + row.openingStock, 0);
    const grandTotalIn = mappedRows.reduce((sum, row) => sum + row.quantityIn, 0);
    const grandTotalOut = mappedRows.reduce((sum, row) => sum + row.quantityOut, 0);
    const grandTotalClosing = mappedRows.reduce((sum, row) => sum + row.closingStock, 0);

    const total = mappedRows.length;
    const page = query.page || 1;
    const perPage = query.perPage || 25;
    const totalPages = Math.ceil(total / perPage);
    const paginatedRows = mappedRows.slice((page - 1) * perPage, page * perPage);

    return {
      results: paginatedRows,
      total,
      page,
      perPage,
      totalPages,
      grandTotalOpening,
      grandTotalIn,
      grandTotalOut,
      grandTotalClosing,
    };
  });
}
