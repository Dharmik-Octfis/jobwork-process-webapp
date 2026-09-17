-- landed_cost
--
-- Migration 1 of docs/JOBWORK_LANDED_COST_PLAN.md (§5, §7). ADDITIVE ONLY.
--
-- 🔴 PROD, STAGING AND DEV SHARE THIS DATABASE, and prod keeps running the old
-- code after this applies. Every column below is nullable or has a constant
-- default, so the old code neither reads nor notices them. The step columns this
-- replaces (`rate`, `rate_basis`, `tolerance_pct`) are dropped by Migration 2, in a
-- later release, once the new code is live everywhere.
--
-- HAND-EDITED FROM THE `db:draft` OUTPUT:
--   * Removed three DROP COLUMNs — `refresh_tokens.idp_session_id`,
--     `refresh_tokens.idp_subject`, `users.identity_user_id`. That is pre-existing
--     SSO drift (in the database, not in the schema files), unrelated to this
--     change, and dropping it would destroy data. It stays for whoever owns SSO.
--   * Every statement is re-runnable: migrations here are NOT transactional, so a
--     failure part-way leaves earlier statements applied. FKs are declared inline
--     in `CREATE TABLE IF NOT EXISTS` because `ADD CONSTRAINT` has no IF NOT EXISTS.
--   * The RLS policy is written by hand. `migrate diff` is blind to RLS, so neither
--     `db:draft` nor `db:check-drift` would ever produce or miss it;
--     `TENANT_TABLES` in src/db/rls.test.ts is the only guard, and lists the table.
--   * The two backfills (a) and (b) from the plan §7.
--
-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.

-- 1. Columns ------------------------------------------------------------------

-- Tolerance moves onto the item (D10), copied onto a step's input row when picked.
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "default_tolerance_pct" DECIMAL(6,3);

-- The rate moves from the step onto each produced row (D1).
ALTER TABLE "route_step_outputs" ADD COLUMN IF NOT EXISTS "rate" DECIMAL(18,4);
ALTER TABLE "job_order_step_outputs" ADD COLUMN IF NOT EXISTS "rate" DECIMAL(18,4);

-- What a posted receipt charged and consumed, frozen at post (§5.1).
ALTER TABLE "job_receipt_outputs"
  ADD COLUMN IF NOT EXISTS "material_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "process_charge" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rate" DECIMAL(18,4);

ALTER TABLE "job_receipts"
  ADD COLUMN IF NOT EXISTS "consumed_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "process_charge_total" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- 2. The recipe snapshot of a composite output (§5.2) --------------------------

CREATE TABLE IF NOT EXISTS "job_order_step_output_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_order_step_output_id" UUID NOT NULL,
    "component_item_id" UUID NOT NULL,
    "qty_per_unit" DECIMAL(18,6) NOT NULL,
    "uom_id" UUID,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_order_step_output_components_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_order_step_output_components_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_order_step_output_components_job_order_step_output_id_fkey"
      FOREIGN KEY ("job_order_step_output_id") REFERENCES "job_order_step_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_order_step_output_components_component_item_id_fkey"
      FOREIGN KEY ("component_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "job_order_step_output_components_uom_id_fkey"
      FOREIGN KEY ("uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "job_order_step_output_components_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "job_order_step_output_components_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "job_order_step_output_components_organization_id_job_order__idx"
  ON "job_order_step_output_components"("organization_id", "job_order_step_output_id");

-- 3. RLS — direct form: the table carries its own organization_id ---------------
-- Guarded on pg_policies, never DROP + CREATE: a failure between those two would
-- leave the table RLS-enabled with no policy.
ALTER TABLE "job_order_step_output_components" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'job_order_step_output_components'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "job_order_step_output_components"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

-- 4. Backfill (a) — the step rate moves to its primary output --------------------
-- Only where its meaning survives: charged per received unit, or input and output
-- in the same unit. Rows left NULL are re-entered by hand. Idempotent
-- (`rate IS NULL`), so Migration 2 re-runs it to catch rows the old code writes
-- between the two releases.
UPDATE "job_order_step_outputs" o SET rate = s.rate
FROM "job_order_steps" s
WHERE o.job_order_step_id = s.id AND o.is_primary AND NOT o.is_deleted
  AND o.rate IS NULL AND s.rate IS NOT NULL
  AND (s.rate_basis = 'per_received_unit'
       OR o.uom_id IS NOT DISTINCT FROM (SELECT i.uom_id FROM "job_order_step_inputs" i
                                         WHERE i.job_order_step_id = s.id AND NOT i.is_deleted
                                         ORDER BY i.seq LIMIT 1));

UPDATE "route_step_outputs" o SET rate = s.rate
FROM "route_steps" s
WHERE o.route_step_id = s.id AND o.is_primary AND NOT o.is_deleted
  AND o.rate IS NULL AND s.rate IS NOT NULL
  AND (s.rate_basis = 'per_received_unit'
       OR o.uom_id IS NOT DISTINCT FROM (SELECT i.uom_id FROM "route_step_inputs" i
                                         WHERE i.route_step_id = s.id AND NOT i.is_deleted
                                         ORDER BY i.seq LIMIT 1));

-- 5. Backfill (b) — a row that inherited the step's tolerance keeps it -----------
-- Before Migration 2 drops the step column. Idempotent (`tolerance_pct IS NULL`).
UPDATE "job_order_step_inputs" i SET tolerance_pct = s.tolerance_pct
FROM "job_order_steps" s
WHERE i.job_order_step_id = s.id AND i.tolerance_pct IS NULL AND s.tolerance_pct IS NOT NULL;
