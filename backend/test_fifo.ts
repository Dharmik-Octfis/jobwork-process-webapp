import { PrismaClient } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany();
  const orgId = orgs[0].id; // assuming first org

  const query = Prisma.sql`
    WITH doc_nets AS (
      SELECT
        l.item_id AS "itemId",
        l.batch_id AS "batchId",
        l.source_doc_type AS "sourceDocType",
        l.source_doc_id AS "sourceDocId",
        SUM(l.qty_in - l.qty_out) AS "netQty",
        SUM(l.value_in - l.value_out) AS "netValue",
        COALESCE((
          SELECT sl.posted_at
          FROM stock_ledger sl
          WHERE sl.source_doc_id = l.source_doc_id
          ORDER BY sl.created_at DESC
          LIMIT 1
        ), MIN(l.created_at)) AS real_date
      FROM stock_ledger l
      WHERE l.organization_id = ${orgId}::uuid
        AND l.stock_effect IN ('both', 'accounting', 'physical')
        AND (l.batch_id IS NOT NULL OR l.source_doc_type = 'item_opening_stock')
        AND l.source_doc_type = 'item_opening_stock'
      GROUP BY
        l.item_id,
        l.batch_id,
        l.source_doc_type,
        l.source_doc_id
    )
    SELECT * FROM doc_nets;
  `;

  const res = await prisma.$queryRaw(query);
  console.log('Opening Stock Rows:', res);
}

main().catch(console.error).finally(() => prisma.$disconnect());
