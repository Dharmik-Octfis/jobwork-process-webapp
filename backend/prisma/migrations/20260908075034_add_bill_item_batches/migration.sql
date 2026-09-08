-- add_bill_item_batches
--
-- 🔴 HAND-EDITED. `migrate diff` opened this draft with five statements that had
-- nothing to do with it — three DROP COLUMNs on `refresh_tokens`/`users` and two
-- DROP INDEXes on the jobwork headers. They are NOT drift this migration should
-- close: they exist because four applied migrations are missing from
-- prisma/migrations (`add_tax_id_value`, `add_sso_identity_columns`,
-- `fix_idp_session_id_is_not_a_uuid`, `add_jobwork_overview_indexes`), so the
-- diff sees live SSO columns the schema files have never heard of and offers to
-- delete them. Applying that would destroy every SSO identity link in the
-- database. Removed by hand; the underlying gap is unrelated and still open.
--
-- What is left is only `bill_item_batches`: the table, its policy, and a
-- backfill for every bill that posted before it existed.

-- CreateTable
CREATE TABLE "bill_item_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "bill_item_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "batch_unit_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_item_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_item_batches_organization_id_bill_item_id_idx" ON "bill_item_batches"("organization_id", "bill_item_id");

-- CreateIndex
CREATE INDEX "bill_item_batches_organization_id_batch_id_idx" ON "bill_item_batches"("organization_id", "batch_id");

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_item_batches" ADD CONSTRAINT "bill_item_batches_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RowLevelSecurity
--
-- 🔴 A tenant table with no policy is unprotected and nothing will tell you
-- (CLAUDE.md). `bill_item_batches` carries its OWN `organization_id` —
-- denormalised from the parent bill for exactly this reason — so it takes the
-- direct form, the same two statements as `batch_units` and `job_issue_lines`,
-- not the join-through-parent form `bill_items` uses.
--
-- Registered in TENANT_TABLES (src/db/rls.test.ts) in the same commit.
--
-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.
ALTER TABLE "bill_item_batches" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "bill_item_batches"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Backfill
--
-- 🔴 EVERY BILL THAT POSTED BEFORE THIS TABLE EXISTED, reconstructed from the
-- ledger one last time. Without this every existing bill opens with no batches
-- the moment the readback stops deriving them, which is the regression this
-- change exists to prevent — not to cause.
--
-- It is the same grouping `getBillById` did at runtime, with three differences
-- that matter:
--
--   · NETTED, not summed. `qty_in - qty_out` so a bill already reversed by
--     `reverseBillPostings` contributes nothing, and `HAVING > 0` drops it
--     entirely rather than writing a zero row.
--   · JOINED TO A LIVE LINE. Movements filed under a `bill_items` row that a
--     past edit soft-deleted are orphans — no screen has been able to show them
--     since that edit, and re-attaching them now would resurrect quantities the
--     user already removed.
--   · Runs as the migration role, which bypasses RLS, so `organization_id` is
--     copied from the ledger row rather than read from a tenant setting.
--
-- Runs ONCE. From here the rows are written by the service on every save.
INSERT INTO "bill_item_batches"
  ("organization_id", "bill_item_id", "batch_id", "batch_unit_id", "qty")
SELECT
  sl."organization_id",
  sl."source_doc_line_id",
  sl."batch_id",
  sl."batch_unit_id",
  (SUM(sl."qty_in") - SUM(sl."qty_out"))::DECIMAL(18,4)
FROM "stock_ledger" sl
JOIN "bill_items" bi ON bi."id" = sl."source_doc_line_id"
WHERE sl."source_doc_type" = 'bill'
  AND sl."source_doc_line_id" IS NOT NULL
  AND bi."is_deleted" = false
GROUP BY sl."organization_id", sl."source_doc_line_id", sl."batch_id", sl."batch_unit_id"
HAVING (SUM(sl."qty_in") - SUM(sl."qty_out")) > 0;
