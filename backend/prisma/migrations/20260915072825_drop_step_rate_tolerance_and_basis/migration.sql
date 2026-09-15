-- drop_step_rate_tolerance_and_basis — landed-cost Migration 2
-- (docs/JOBWORK_LANDED_COST_PLAN.md §5.1, §7).
--
-- @destructive-ok: rate moved to output rows and tolerance to input rows in 20260914124636_landed_cost; both backfills re-run below first
--
-- Drops the eight step-level cost columns the landed-cost code stopped reading in
-- phase 7b. 🔴 Apply only once every deployed app using this database runs code
-- whose Prisma schema no longer lists them — an older client selects these columns
-- by default and every query on the three tables fails.
--
-- Re-runnable: migrations here are not transactional, so every statement is guarded
-- — the backfills run only while their source columns still exist, and the drops
-- use IF EXISTS.
--
-- 🔴 Deliberately NOT here: `refresh_tokens.idp_session_id`, `refresh_tokens.idp_subject`
-- and `users.identity_user_id`. `migrate diff` proposes dropping them because the
-- SSO work added them out of band; they are not this migration's to remove.

-- 1. Backfill (a) again — catches rates the old code wrote after Migration 1 --------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'job_order_steps'
               AND column_name = 'rate_basis') THEN
    UPDATE "job_order_step_outputs" o SET rate = s.rate
    FROM "job_order_steps" s
    WHERE o.job_order_step_id = s.id AND o.is_primary AND NOT o.is_deleted
      AND o.rate IS NULL AND s.rate IS NOT NULL
      AND (s.rate_basis = 'per_received_unit'
           OR o.uom_id IS NOT DISTINCT FROM (SELECT i.uom_id FROM "job_order_step_inputs" i
                                             WHERE i.job_order_step_id = s.id AND NOT i.is_deleted
                                             ORDER BY i.seq LIMIT 1));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'route_steps'
               AND column_name = 'rate_basis') THEN
    UPDATE "route_step_outputs" o SET rate = s.rate
    FROM "route_steps" s
    WHERE o.route_step_id = s.id AND o.is_primary AND NOT o.is_deleted
      AND o.rate IS NULL AND s.rate IS NOT NULL
      AND (s.rate_basis = 'per_received_unit'
           OR o.uom_id IS NOT DISTINCT FROM (SELECT i.uom_id FROM "route_step_inputs" i
                                             WHERE i.route_step_id = s.id AND NOT i.is_deleted
                                             ORDER BY i.seq LIMIT 1));
  END IF;

  -- 2. Backfill (b) again — a row that inherited the step's tolerance keeps it -------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'job_order_steps'
               AND column_name = 'tolerance_pct') THEN
    UPDATE "job_order_step_inputs" i SET tolerance_pct = s.tolerance_pct
    FROM "job_order_steps" s
    WHERE i.job_order_step_id = s.id AND i.tolerance_pct IS NULL AND s.tolerance_pct IS NOT NULL;
  END IF;
END $$;

-- 3. The drops ----------------------------------------------------------------------
ALTER TABLE "job_order_steps"
  DROP COLUMN IF EXISTS "rate",
  DROP COLUMN IF EXISTS "rate_basis",
  DROP COLUMN IF EXISTS "tolerance_pct";

ALTER TABLE "route_steps"
  DROP COLUMN IF EXISTS "rate",
  DROP COLUMN IF EXISTS "rate_basis",
  DROP COLUMN IF EXISTS "tolerance_pct";

ALTER TABLE "processes"
  DROP COLUMN IF EXISTS "rate_basis",
  DROP COLUMN IF EXISTS "default_tolerance_pct";
