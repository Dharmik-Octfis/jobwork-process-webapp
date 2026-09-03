-- add_job_issue_line_batch_unit
--
-- WHICH PACKAGE of a batch a challan line sent — a taka, roll, bale.
--
-- 🔴 THREE PACKAGES OF ONE BATCH ARE THREE LINES, exactly as three batches are
-- three lines today. A package is ATOMIC at issue: picking it sends all of it, so
-- a line needs no second quantity to reconcile against, and `resolveLines` needs
-- no second running-total map beside the per-(batch, location) one it keeps.
--
-- Purely additive. Every existing line means "no package", which is precisely
-- what the new nullable column already says, so there is no backfill.
--
-- ⚠️ EDITED BY HAND from the `db:draft` output, same as
-- 20260901120700_add_batch_units. This database carries drift that has nothing to
-- do with this feature — three SSO columns and two jobwork overview indexes live
-- in the database under migrations that are applied but missing from disk, and
-- `db:status` lists all four. The generated draft proposed DROPping them. They
-- are somebody else's rows and somebody else's decision, so every statement about
-- them has been removed and only this feature's DDL is below.

-- AlterTable
ALTER TABLE "job_issue_lines" ADD COLUMN "batch_unit_id" UUID;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
