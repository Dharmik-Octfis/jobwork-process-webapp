-- add_jobwork_overview_indexes
--
-- Three indexes the Job Order Overview reads through. Nothing else: the
-- generated draft also carried three DROP COLUMNs against `refresh_tokens`
-- (idp_session_id, idp_subject) and `users` (identity_user_id). Those are NOT
-- drift to close — they are the SSO identity columns, added by
-- 20260824064102_add_sso_identity_columns, which is applied to this database but
-- missing from prisma/migrations. `migrate diff` sees columns the schema files
-- do not declare and proposes dropping them; applying that would destroy the SSO
-- linkage. They have been removed by hand. See `npm run db:status` — that gap is
-- real and still open, and it is not this migration's job to close.
--
-- Plain CREATE INDEX, not CONCURRENTLY: these tables are small today (job_issues
-- 58 rows, job_receipts 24, stock_ledger 992), so the lock is momentary. On a
-- table already large, CONCURRENTLY would be required instead — and it cannot
-- run inside a transaction block.

-- CreateIndex
-- The Overview loads an order's whole document feed by `job_order_id`, but the
-- only indexes here were on `job_order_step_id` and `challan_number`. Without
-- this, `organization_id` is the sole usable prefix and the read scans the org's
-- every challan.
CREATE INDEX "job_issues_organization_id_job_order_id_idx" ON "job_issues"("organization_id", "job_order_id");

-- CreateIndex
-- Same read, same gap.
CREATE INDEX "job_receipts_organization_id_job_order_id_idx" ON "job_receipts"("organization_id", "job_order_id");

-- CreateIndex
-- "Which ledger rows did this document write?" — the consumed-per-receipt sum,
-- and every reversal and drill-down after it. The two existing indexes start
-- with `item_id` and `location_id`, neither of which those queries constrain, so
-- they fall back to scanning the org's whole ledger — the fastest-growing table
-- in the schema.
CREATE INDEX "stock_ledger_organization_id_source_doc_type_source_doc_id_idx" ON "stock_ledger"("organization_id", "source_doc_type", "source_doc_id");
