-- add_output_share_pct
--
-- Landed-cost R1b (docs/JOBWORK_LANDED_COST_PLAN.md): on a step with ONE input and two or
-- more outputs made from it, each output states the share of the input's material it takes.
-- Additive and nullable, no backfill — NULL is right for every existing row: steps planned
-- before shares existed keep splitting by expected quantity, and every other step shape
-- never uses the column.
--
-- No RLS statement: `job_order_step_outputs` already carries a policy and is already in
-- TENANT_TABLES; adding a column changes neither.
--
-- Re-runnable: migrations here are not transactional, so the add uses IF NOT EXISTS.
--
-- 🔴 Deliberately NOT here, though `migrate diff` proposes them: every table, column and
-- constraint added to the shared dev database by migrations on other branches
-- (20260729080000 … 20260918062238). Not ours to drop.

ALTER TABLE "job_order_step_outputs"
  ADD COLUMN IF NOT EXISTS "share_pct" DECIMAL(9, 4);
