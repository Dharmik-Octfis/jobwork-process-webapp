-- fifo_cost_layers
--
-- FIFO costing (docs/FIFO_COSTING_PLAN.md, phase 1): the two tables the engine in
-- `stock-ledger/costLayers.ts` keeps. A layer is one inward row's quantity and
-- cost at one (item, location); a draw is what one outward row took from one
-- layer. Both carry `organization_id` → the DIRECT policy form, and both are in
-- TENANT_TABLES (src/db/rls.test.ts).
--
-- 🔴 The RLS statements are hand-written: `migrate diff` never generates them and
-- `db:check-drift` never reports them missing (CLAUDE.md).
--
-- The FIFO index is FULL, not `WHERE remaining_qty > 0` as the plan sketched —
-- Prisma cannot express a partial index, so one would read as permanent drift.
--
-- No data here. Layers for stock already on the books are built by the cut-over
-- script (scripts/fifo-cutover.ts, D4), which is run by hand per database.
--
-- Re-runnable: migrations here are not transactional, so every statement is
-- guarded, and policies use the `pg_policies` guard, never drop-and-recreate.
--
-- 🔴 Deliberately NOT here, though `migrate diff` against the shared database
-- proposes them: the out-of-band tables and constraints other branches added.

CREATE TABLE IF NOT EXISTS "stock_cost_layers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "in_ledger_entry_id" UUID,
    "origin_layer_id" UUID,
    "source_doc_line_id" UUID,
    "batch_id" UUID NOT NULL,
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "in_date" TIMESTAMPTZ(6) NOT NULL,
    "in_seq" BIGSERIAL NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "remaining_qty" DECIMAL(18,4) NOT NULL,
    "remaining_value" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_cost_layers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_layer_draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "out_ledger_entry_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_layer_draws_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_cost_layers_organization_id_item_id_location_id_in_da_idx" ON "stock_cost_layers"("organization_id", "item_id", "location_id", "in_date", "in_seq");
CREATE INDEX IF NOT EXISTS "stock_cost_layers_in_ledger_entry_id_idx" ON "stock_cost_layers"("in_ledger_entry_id");
CREATE INDEX IF NOT EXISTS "stock_cost_layers_organization_id_source_doc_line_id_idx" ON "stock_cost_layers"("organization_id", "source_doc_line_id");
CREATE INDEX IF NOT EXISTS "stock_layer_draws_layer_id_idx" ON "stock_layer_draws"("layer_id");
CREATE INDEX IF NOT EXISTS "stock_layer_draws_out_ledger_entry_id_idx" ON "stock_layer_draws"("out_ledger_entry_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_cost_layers_organization_id_fkey') THEN
    ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_cost_layers_in_ledger_entry_id_fkey') THEN
    ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_in_ledger_entry_id_fkey" FOREIGN KEY ("in_ledger_entry_id") REFERENCES "stock_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_cost_layers_origin_layer_id_fkey') THEN
    ALTER TABLE "stock_cost_layers" ADD CONSTRAINT "stock_cost_layers_origin_layer_id_fkey" FOREIGN KEY ("origin_layer_id") REFERENCES "stock_cost_layers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_draws_organization_id_fkey') THEN
    ALTER TABLE "stock_layer_draws" ADD CONSTRAINT "stock_layer_draws_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_draws_layer_id_fkey') THEN
    ALTER TABLE "stock_layer_draws" ADD CONSTRAINT "stock_layer_draws_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "stock_cost_layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_layer_draws_out_ledger_entry_id_fkey') THEN
    ALTER TABLE "stock_layer_draws" ADD CONSTRAINT "stock_layer_draws_out_ledger_entry_id_fkey" FOREIGN KEY ("out_ledger_entry_id") REFERENCES "stock_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS — both tables carry their own organization_id (direct form) --------------
ALTER TABLE "stock_cost_layers" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_cost_layers'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_cost_layers"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "stock_layer_draws" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_layer_draws'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_layer_draws"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
