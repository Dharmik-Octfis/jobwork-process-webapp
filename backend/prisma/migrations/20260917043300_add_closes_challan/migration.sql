-- add_closes_challan
--
-- Landed-cost R10 (docs/JOBWORK_CHALLAN_CLOSURE_PLAN.md §5, §7): a receipt line records
-- that its receipt closed the line's challan. Additive, no backfill — `false` is right
-- for every existing row, since no receipt posted before this release closed anything
-- deliberately.
--
-- No RLS statement: `job_receipt_lines` already carries a policy and is already in
-- TENANT_TABLES; adding a column changes neither.
--
-- Re-runnable: migrations here are not transactional, so the add uses IF NOT EXISTS.
--
-- 🔴 Deliberately NOT here, though `migrate diff` proposes them:
--   · `items.default_tolerance_pct` — dropped by 20260916121656_drop_item_default_tolerance;
--   · `refresh_tokens.idp_session_id`, `refresh_tokens.idp_subject`,
--     `users.identity_user_id` — added out of band by the SSO work, not ours to drop.

ALTER TABLE "job_receipt_lines"
  ADD COLUMN IF NOT EXISTS "closes_challan" BOOLEAN NOT NULL DEFAULT false;
