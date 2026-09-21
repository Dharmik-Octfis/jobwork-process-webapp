-- add_batch_units
--
-- One optional level BELOW the batch: a taka, roll, bale, coil, plate or bundle.
-- Switched on per organization in `organizations.settings` (JSONB — no DDL), and
-- named per organization exactly as "Batch" already is.
--
-- Purely additive. Every historical `stock_ledger` row means "no unit", which is
-- precisely what the new nullable column already says, so there is no backfill.
--
-- ⚠️ EDITED BY HAND from the `db:draft` output. `migrate diff` reports the whole
-- gap between the schema files and the database, and this database carries drift
-- that has nothing to do with this feature: three SSO columns and two jobwork
-- overview indexes live in the database under migrations that are applied but
-- missing from disk (`db:status` lists all four). The generated draft proposed
-- DROPping them. They are somebody else's rows and somebody else's decision, so
-- every statement about them has been removed and only this feature's DDL is
-- below.

-- CreateTable
--
-- 🔴 NO `qty` COLUMN. A unit's quantity is `SUM(qty_in - qty_out)` off
-- `stock_ledger` filtered by `batch_unit_id`, exactly as a batch's is. A stored
-- copy would need updating by every path that moves stock and would be silently
-- wrong the first time one forgot — while the batch total stayed correct, which
-- is the hardest failure here to notice.
--
-- No `location_id` and no `state` either: location lives on the movement (which
-- is what lets a unit sit at the dyer's), and "is any of it left" is a balance.
CREATE TABLE "batch_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "uom_id" UUID,
    "parent_batch_unit_id" UUID,
    "source_doc_type" VARCHAR(40),
    "source_doc_id" UUID,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batch_units_organization_id_batch_id_idx" ON "batch_units"("organization_id", "batch_id");

-- CreateIndex
-- REVIEWED [ADD UNIQUE]: the table is created empty by this same migration, so
-- there are no existing rows to collide on. `seq` restarts at 1 in every batch,
-- which is sound here and nowhere else — a unit has exactly one parent batch,
-- can never merge across batches, and cannot exist without one.
--
-- The soft-delete caveat is real and is handled in `stockLedger.service.ts`:
-- `seq` is allocated as `MAX(seq) + 1` over ALL rows of the batch, deleted ones
-- included, so a soft-deleted unit never has its number handed out again.
CREATE UNIQUE INDEX "batch_units_batch_id_seq_key" ON "batch_units"("batch_id", "seq");

-- AlterTable
ALTER TABLE "stock_ledger" ADD COLUMN "batch_unit_id" UUID;

-- CreateIndex
-- Unit balances: "what is in B-1", "where is T-1", the unit picker, and the
-- invariant `postMovement` checks on every outward row.
CREATE INDEX "stock_ledger_organization_id_batch_id_batch_unit_id_locatio_idx" ON "stock_ledger"("organization_id", "batch_id", "batch_unit_id", "location_id");

-- CreateIndex
-- 🔴 MISSING UNTIL NOW AND NEEDED REGARDLESS OF THIS FEATURE. `cancelJobIssue`
-- filters posted rows by `source_doc_line_id` with nothing behind it. Invisible
-- at today's volume; a unit level multiplies ledger rows ~50x, and that is a
-- sequential scan per cancelled line inside one transaction holding one pooled
-- connection. Its sibling on (source_doc_type, source_doc_id) already exists.
--
-- Kept FULL, never partial: Prisma cannot express a `WHERE` on an index, so a
-- hand-written partial one would read as permanent drift to `db:check-drift`.
CREATE INDEX "stock_ledger_organization_id_source_doc_line_id_idx" ON "stock_ledger"("organization_id", "source_doc_line_id");

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_parent_batch_unit_id_fkey" FOREIGN KEY ("parent_batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_units" ADD CONSTRAINT "batch_units_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RowLevelSecurity
--
-- 🔴 A tenant table with no policy is unprotected and nothing will tell you
-- (CLAUDE.md). `batch_units` carries its OWN `organization_id` — denormalised
-- from its parent batch for exactly this reason — so it takes the direct form,
-- the same two statements as `job_order_step_input_batches`, not the
-- join-through-parent form the `*_activities` tables need.
--
-- Registered in TENANT_TABLES (src/db/rls.test.ts) in the same commit.
ALTER TABLE "batch_units" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "batch_units"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
