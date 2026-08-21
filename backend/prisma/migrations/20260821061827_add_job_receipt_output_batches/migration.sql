-- add_job_receipt_output_batches
--
-- An output row may now land in SEVERAL batches, and may add to a batch an
-- earlier receipt created instead of creating one. Until today it created
-- exactly one accepted batch and one rework batch, which forced two lies on
-- anyone whose delivery did not match that shape: a dyer returning three dye
-- lots in one consignment had to file three receipts or merge three lots under
-- one label, and the second half of a split delivery could only ever become a
-- second batch carrying a duplicate reference.
--
-- 🔴 EDITED BY HAND. `migrate diff` also emitted, from PRE-EXISTING dev-database
-- drift that has nothing to do with this change:
--
--   · DROP TABLE "lots" / "lot_packages" — leftovers from the 2026-08-12
--     lot→batch rename that were never dropped in this database. Destroying
--     them is a decision on its own, with its own migration and its own
--     `@destructive-ok` line. It is not a side effect of adding a table.
--   · DROP INDEX on permission_templates / roles unique keys — the full-vs-
--     partial unique index drift. Dropping those changes soft-delete behaviour.
--
-- Both were removed. A migration should contain the change it is named after and
-- nothing else, or the next person cannot tell which statement was the point.
--
-- Idempotent throughout: a migration is not transactional here, so a statement
-- that fails leaves the ones before it applied and the file has to be re-runnable.

-- CreateTable
CREATE TABLE IF NOT EXISTS "job_receipt_output_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_receipt_id" UUID NOT NULL,
    "job_receipt_output_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    -- accepted | rework. The two never share a batch.
    "kind" VARCHAR(20) NOT NULL,
    "batch_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    -- Did this receipt create the batch, or top up one that already existed?
    -- Cancellation needs the difference.
    "is_new_batch" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_receipt_output_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_receipt_output_batches_organization_id_job_receipt_id_idx" ON "job_receipt_output_batches"("organization_id", "job_receipt_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_receipt_output_batches_organization_id_batch_id_idx" ON "job_receipt_output_batches"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_receipt_output_batches_organization_id_job_receipt_outp_idx" ON "job_receipt_output_batches"("organization_id", "job_receipt_output_id");

-- AddForeignKey
-- ON DELETE RESTRICT on batch_id, matching job_order_step_input_batches: a batch
-- that a posted document put quantity into must not be deletable out from under
-- the document that explains it.
DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_job_receipt_id_fkey" FOREIGN KEY ("job_receipt_id") REFERENCES "job_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_job_receipt_output_id_fkey" FOREIGN KEY ("job_receipt_output_id") REFERENCES "job_receipt_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "job_receipt_output_batches" ADD CONSTRAINT "job_receipt_output_batches_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill
--
-- 🔴 Before any constraint, and before the application can read this table.
-- Every existing receipt has to describe itself the same way a new one will, or
-- the detail screen and the cancellation guard see history as a receipt that
-- created no batches at all.
--
-- The source is complete: 20260806112805_multi_item_steps gave EVERY pre-Sprint-5
-- receipt an output row carrying the header's batch ids, so there is no receipt
-- whose batches live only on `job_receipts`.
--
-- `is_new_batch = true` on every backfilled row is a fact, not an assumption:
-- topping up an existing batch was impossible until this migration.
INSERT INTO "job_receipt_output_batches"
  (organization_id, job_receipt_id, job_receipt_output_id, seq, kind, batch_id,
   qty, is_new_batch, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT o.organization_id, o.job_receipt_id, o.id, 1, 'accepted', o.output_batch_id,
       o.accepted_qty, true, o.is_deleted, o.created_by, o.updated_by, o.created_at, o.updated_at
FROM   "job_receipt_outputs" o
WHERE  o.output_batch_id IS NOT NULL
  AND  o.accepted_qty > 0
  AND  NOT EXISTS (
         SELECT 1 FROM "job_receipt_output_batches" b
         WHERE b.job_receipt_output_id = o.id AND b.kind = 'accepted'
       );

INSERT INTO "job_receipt_output_batches"
  (organization_id, job_receipt_id, job_receipt_output_id, seq, kind, batch_id,
   qty, is_new_batch, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT o.organization_id, o.job_receipt_id, o.id, 1, 'rework', o.rework_batch_id,
       o.rework_qty, true, o.is_deleted, o.created_by, o.updated_by, o.created_at, o.updated_at
FROM   "job_receipt_outputs" o
WHERE  o.rework_batch_id IS NOT NULL
  AND  o.rework_qty > 0
  AND  NOT EXISTS (
         SELECT 1 FROM "job_receipt_output_batches" b
         WHERE b.job_receipt_output_id = o.id AND b.kind = 'rework'
       );

-- RowLevelSecurity
--
-- 🔴 A tenant table with no policy is unprotected and nothing will tell you
-- (CLAUDE.md). This table carries its own `organization_id`, so it takes the
-- direct form rather than joining through its parent — a child whose policy
-- depends on a join is one forgotten join away from leaking.
--
-- Registered in TENANT_TABLES (src/db/rls.test.ts) in the same commit.
ALTER TABLE "job_receipt_output_batches" ENABLE ROW LEVEL SECURITY;

-- Created rather than dropped-and-recreated: the table is new in this same file,
-- so no policy can pre-exist except on a re-run after a partial failure — and a
-- DROP POLICY here would be a destructive statement in a migration that has no
-- business owning one. The guard catches the re-run case without it.
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "job_receipt_output_batches"
    USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
