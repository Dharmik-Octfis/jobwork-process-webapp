-- job_receipt_output_batch_units
--
-- `job_receipt_output_batches` becomes one row per (batch, package) plus a null
-- row for the untagged remainder — the grain `bill_item_batches` already has. A
-- draft receipt posts no ledger rows and a `batch_unit` stores no quantity, so
-- without this a draft could not keep how much each taka received.
--
-- Hand-written: `db:draft` also wanted to drop the approval_* tables and add
-- sales_orders.delivery_type, which are other branches' drift on the shared dev
-- database and have nothing to do with this change.
--
-- No backfill: rows written before this column read as a batch with no packages
-- named on the document, which is what they always said. The table keeps its
-- existing RLS policy — a new column needs none.
--
-- IF NOT EXISTS / guarded constraint, because migrations here are not
-- transactional and a re-run must be a no-op.

-- AlterTable
ALTER TABLE "job_receipt_output_batches" ADD COLUMN IF NOT EXISTS "batch_unit_id" UUID;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_receipt_output_batches_batch_unit_id_fkey'
  ) THEN
    ALTER TABLE "job_receipt_output_batches"
      ADD CONSTRAINT "job_receipt_output_batches_batch_unit_id_fkey"
      FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
