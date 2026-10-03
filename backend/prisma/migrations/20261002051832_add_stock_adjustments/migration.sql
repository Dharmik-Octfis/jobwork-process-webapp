-- add_stock_adjustments
--
-- Stock adjustment (docs/STOCK_ADJUSTMENT_PLAN.md): the header and the batches
-- it touched. Hand-trimmed from the generated draft, which also carried this
-- database's unrelated drift (approval tables and others) — none of that belongs here.
--
-- RLS is written by hand: `migrate diff` never generates it. Both tables carry
-- their own `organization_id`, so both take the direct policy form.
-- No GRANTs needed: 20260716183126_enable_rls set default privileges.

CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "adjustment_number" VARCHAR(50) NOT NULL,
    "adjustment_date" TIMESTAMPTZ(6) NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity_adjusted" DECIMAL(18,4) NOT NULL,
    "quantity_before" DECIMAL(18,4) NOT NULL,
    "cost_price" DECIMAL(18,4),
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason" VARCHAR(40) NOT NULL,
    "reference_number" VARCHAR(100),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'adjusted',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_adjustment_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "batch_unit_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_adjustments_organization_id_item_id_adjustment_date_idx" ON "stock_adjustments"("organization_id", "item_id", "adjustment_date");
CREATE INDEX "stock_adjustments_organization_id_location_id_adjustment_da_idx" ON "stock_adjustments"("organization_id", "location_id", "adjustment_date");
CREATE UNIQUE INDEX "stock_adjustments_organization_id_adjustment_number_key" ON "stock_adjustments"("organization_id", "adjustment_number");
CREATE INDEX "stock_adjustment_batches_organization_id_adjustment_id_idx" ON "stock_adjustment_batches"("organization_id", "adjustment_id");
CREATE INDEX "stock_adjustment_batches_organization_id_batch_id_idx" ON "stock_adjustment_batches"("organization_id", "batch_id");
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_adjustments'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_adjustments"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "stock_adjustment_batches" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_adjustment_batches'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_adjustment_batches"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
