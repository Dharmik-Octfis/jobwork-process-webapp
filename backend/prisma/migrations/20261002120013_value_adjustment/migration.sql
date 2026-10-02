-- value_adjustment
--
-- Inventory adjustment by VALUE (docs/STOCK_ADJUSTMENT_VALUE_PLAN.md): an
-- adjustment gains a type, a value line records the change asked for and the
-- value it found, and `stock_layer_revaluations` records what each adjustment
-- did to each FIFO layer.
--
-- Hand-written from the generated draft, which also carried this database's
-- unrelated drift — none of that belongs here.
--
-- Migrations here are NOT transactional, so every step is safe to re-run.

-- 1. The adjustment's type. Every existing adjustment is a quantity one.
ALTER TABLE "stock_adjustments"
  ADD COLUMN IF NOT EXISTS "adjustment_type" VARCHAR(10) NOT NULL DEFAULT 'quantity';

-- 2. A value line's figures.
ALTER TABLE "stock_adjustment_lines"
  ADD COLUMN IF NOT EXISTS "value_adjusted" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "value_before" DECIMAL(18,4);

-- 3. What one value adjustment did to one layer.
CREATE TABLE IF NOT EXISTS "stock_layer_revaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "ledger_entry_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value_before" DECIMAL(18,4) NOT NULL,
    "value_after" DECIMAL(18,4) NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_layer_revaluations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_layer_revaluations_layer_id_idx" ON "stock_layer_revaluations"("layer_id");
CREATE INDEX IF NOT EXISTS "stock_layer_revaluations_ledger_entry_id_idx" ON "stock_layer_revaluations"("ledger_entry_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_revaluations_organization_id_fkey') THEN
    ALTER TABLE "stock_layer_revaluations" ADD CONSTRAINT "stock_layer_revaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_revaluations_layer_id_fkey') THEN
    ALTER TABLE "stock_layer_revaluations" ADD CONSTRAINT "stock_layer_revaluations_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "stock_cost_layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_revaluations_ledger_entry_id_fkey') THEN
    ALTER TABLE "stock_layer_revaluations" ADD CONSTRAINT "stock_layer_revaluations_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "stock_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. RLS, before anything else can read it. Direct form: it carries its own
--    organization_id. `migrate diff` never generates this and never misses it.
ALTER TABLE "stock_layer_revaluations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_layer_revaluations'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_layer_revaluations"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
