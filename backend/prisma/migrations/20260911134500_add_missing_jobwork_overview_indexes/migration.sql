-- add_missing_jobwork_overview_indexes
--
-- 🔴 HAND-WRITTEN, AND IT CANNOT BE DRAFTED. `db:draft` diffs the schema files
-- against the LIVE DATABASE, which already holds all three of these, so a draft
-- renders them as nothing at all. The gap this closes is between
-- `prisma/migrations` and the schema files — a direction
-- `migrate diff --from-config-datasource` does not look in. The only way to see
-- it is `db:status`, which counts files against `_prisma_migrations`.
--
-- WHAT WENT WRONG. `20260901072709_add_jobwork_overview_indexes` was applied to
-- the shared database on 2026-09-01 (still recorded in `_prisma_migrations`,
-- checksum f6b6ade6…) and its file was never committed — not on any branch, not
-- in `prisma/drafts`, nowhere in git history. `db:status` has reported it as
-- "applied but missing from disk" ever since, alongside three others. So a
-- database rebuilt from `prisma/migrations` came up WITHOUT the three indexes
-- below, and nothing would have said so: the app would simply have been slower,
-- on the one endpoint already under investigation for being slow.
--
-- WHY THESE THREE. Each serves `getJobOrderOverview`, which is what made them
-- worth an index in the first place:
--   * stock_ledger — `getAllStepTotals` (jobOrders.status.ts) groups consume
--     rows by (source_doc_type, source_doc_id). Confirmed 2026-09-11 to be
--     using this index: Bitmap Index Scan, 0.247ms.
--   * job_issues   — `buildActivity` (jobOrders.service.ts) reads every challan
--   * job_receipts   and receipt on the ORDER, not on one step, so the
--                    (organization_id, job_order_step_id) index already declared
--                    on both tables does not serve it.
--
-- 🔴 TWO OF THEM WERE MISSING FROM THE SCHEMA FILES TOO, so `migrate diff` spent
-- ten days wanting to DROP them. `@@index([organizationId, jobOrderId])` is
-- declared on `JobIssue` and `JobReceipt` in the same commit as this file.
-- Without that half this migration creates an index that the next drift check
-- immediately proposes removing again.
--
-- IF NOT EXISTS, because every environment this will reach already has all three
-- (dev, staging and production share one database), and because a migration here
-- is NOT transactional — a failure on the second statement would leave the first
-- applied and the migration recorded as failed, with no way forward or back.
-- Nothing is dropped or rewritten, so no `@destructive-ok` line is required.
--
-- The original 20260901072709 row stays in `_prisma_migrations` with no file, and
-- `db:status` will keep listing it. Rewriting its checksum to match a
-- reconstructed file would mean an UPDATE on the shared database's migration
-- bookkeeping purely to make history read tidier than it was. A forward
-- migration costs nothing and misrepresents nothing.

CREATE INDEX IF NOT EXISTS "stock_ledger_organization_id_source_doc_type_source_doc_id_idx"
  ON "stock_ledger" ("organization_id", "source_doc_type", "source_doc_id");

CREATE INDEX IF NOT EXISTS "job_issues_organization_id_job_order_id_idx"
  ON "job_issues" ("organization_id", "job_order_id");

CREATE INDEX IF NOT EXISTS "job_receipts_organization_id_job_order_id_idx"
  ON "job_receipts" ("organization_id", "job_order_id");
