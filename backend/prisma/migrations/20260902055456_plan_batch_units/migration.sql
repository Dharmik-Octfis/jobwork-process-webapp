-- plan_batch_units
--
-- WHICH PACKAGE the planner meant — a taka, roll or bale — on a job order step's
-- planned batch row. Still a NOTE and not a reservation: naming a roll holds
-- nothing, exactly as naming a batch holds nothing.
--
-- Purely additive. Every existing row means "the batch generally", which is what
-- the new nullable column already says, so there is no backfill.
--
-- ⚠️ EDITED BY HAND from the `db:draft` output, same as the two migrations before
-- it. This database carries drift unrelated to this feature — three SSO columns
-- and two jobwork overview indexes live in the database under migrations that are
-- applied but missing from disk, and `db:status` lists all four. The generated
-- draft proposed DROPping them; every statement about them has been removed.

-- AlterTable
ALTER TABLE "job_order_step_input_batches" ADD COLUMN "batch_unit_id" UUID;

-- AddForeignKey
ALTER TABLE "job_order_step_input_batches" ADD CONSTRAINT "job_order_step_input_batches_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropIndex / CreateIndex
--
-- 🔴 REWRITTEN BY HAND, AND THIS IS THE WHOLE POINT OF THE FILE.
--
-- `migrate diff` generated a plain
--   CREATE UNIQUE INDEX ... (job_order_step_input_id, batch_id, location_id, batch_unit_id)
-- which is the exact trap the implementation plan flags (§3.4): Postgres treats
-- `NULL <> NULL`, so with a nullable column in the key TWO UNTAGGED ROWS for one
-- (input, batch, location) both insert happily. The constraint would quietly stop
-- constraining precisely the case it exists for — the un-packaged plan row, which
-- is every row written before this feature and every row an org that never turns
-- the level on will write.
--
-- `NULLS NOT DISTINCT` (Postgres 15+; this runs on 18) says what is actually
-- meant: one untagged row per (input, batch, location), and one row per package
-- besides. The plan document suggested a COALESCE expression index; this is the
-- same guarantee stated directly, and unlike an expression index it keeps the
-- column list Prisma declares, so `db:check-drift` sees no difference.
--
-- REVIEWED [ADD UNIQUE]: safe on existing rows. `batch_unit_id` is NULL
-- everywhere, so the new key is (input, batch, location) plus a constant — which
-- is exactly the key just dropped, and it held. Soft-deleted rows cannot sit on it
-- either: plans are REPLACED on every save (hard delete, then re-insert), because
-- a plan is a statement of current intent with no history worth keeping.
DROP INDEX "job_order_step_input_batches_job_order_step_input_id_batch__key";

CREATE UNIQUE INDEX "job_order_step_input_batches_job_order_step_input_id_batch__key"
  ON "job_order_step_input_batches" ("job_order_step_input_id", "batch_id", "location_id", "batch_unit_id")
  NULLS NOT DISTINCT;
