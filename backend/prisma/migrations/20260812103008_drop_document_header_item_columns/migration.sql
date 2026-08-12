-- drop_document_header_item_columns
--
-- The last of the single-item header columns on multi-item documents. A challan
-- carries fabric AND thread AND buttons; a receipt returns shirts AND rejects.
-- `job_issues.item_id` and `job_receipts.output_item_id` could each name only
-- one of them, and every screen that showed one hid the rest.
--
-- @destructive-ok: Both pairs were projections of a child list that already
-- holds the real data — `job_issue_lines.item_id` (one row per lot) and
-- `job_receipt_outputs.item_id` (one row per returned item). Every reader was
-- moved onto those lists first: the Issues and Receipts list columns, both
-- detail pages, and the printed challan. No value is being destroyed — the
-- database holds staging data only, and each dropped column is duplicated on a
-- child row that survives.
--
-- `job_issue_lines.item_id` becomes NOT NULL in the same migration. It was
-- nullable only for the Sprint 5 backfill window; the service has always written
-- it, so this is the constraint catching up with the code.
--
-- 🔴 HAND-EDITED, same as 20260812094140. `migrate diff` again emitted the
-- composite-items drift — DROP TABLE on item_assembly_activities,
-- item_assembly_comments, item_location_stocks and item_opening_stock_rows, plus
-- an item_assemblies default and locations.is_primary. That feature is live in
-- the database and absent from prisma/schema, so every draft regenerates it.
-- Removed by hand. Read the whole file before promoting.
--
-- 🔴 THE CONSTRAINT DROPS ARE `IF EXISTS`, AND THAT IS NOT DECORATION.
-- `migrate deploy` does NOT wrap a migration file in a transaction here: the
-- first attempt at this migration dropped all five constraints, then failed on
-- the NOT NULL below, and the five drops STAYED DROPPED. Re-running then failed
-- on statement one. Every statement in this file is therefore written to survive
-- a partial apply — assume any prefix of it may already have run.

-- DropForeignKey
ALTER TABLE "job_issue_lines" DROP CONSTRAINT IF EXISTS "job_issue_lines_item_id_fkey";

-- DropForeignKey
ALTER TABLE "job_issues" DROP CONSTRAINT IF EXISTS "job_issues_item_id_fkey";

-- DropForeignKey
ALTER TABLE "job_issues" DROP CONSTRAINT IF EXISTS "job_issues_uom_id_fkey";

-- DropForeignKey
ALTER TABLE "job_receipts" DROP CONSTRAINT IF EXISTS "job_receipts_output_item_id_fkey";

-- DropForeignKey
ALTER TABLE "job_receipts" DROP CONSTRAINT IF EXISTS "job_receipts_output_uom_id_fkey";

-- 🔴 BACKFILL FIRST, AND IT MUST RUN BEFORE THE DROP BELOW.
--
-- `job_issue_lines.item_id` is null on every row written before Sprint 5 moved
-- the item onto the line — those rows are described by `job_issues.item_id`,
-- which this same migration removes two statements later. Read it while it is
-- still there or the information is gone.
--
-- A single-item challan is the only shape that can have null lines, so copying
-- the header down is exact rather than a guess: every line on it carried that
-- one item by definition. The first attempt at this migration omitted the
-- backfill and failed on the NOT NULL (23502), which is the check working.
UPDATE "job_issue_lines" l
SET "item_id" = i."item_id",
    "uom_id"  = COALESCE(l."uom_id", i."uom_id")
FROM "job_issues" i
WHERE l."job_issue_id" = i."id"
  AND l."item_id" IS NULL;

-- AlterTable
ALTER TABLE "job_issue_lines" ALTER COLUMN "item_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "job_issues" DROP COLUMN "item_id",
DROP COLUMN "uom_id";

-- AlterTable
ALTER TABLE "job_receipts" DROP COLUMN "output_item_id",
DROP COLUMN "output_uom_id";

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
