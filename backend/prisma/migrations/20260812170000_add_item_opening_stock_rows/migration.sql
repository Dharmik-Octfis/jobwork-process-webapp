-- add_item_opening_stock_rows
--
-- New tenant table for persisted item opening-stock rows. This is the source of
-- truth for the Locations screen; the stock ledger still records the actual
-- inventory movements.

CREATE TABLE "item_opening_stock_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "opening_stock" DECIMAL(10,2),
    "opening_stock_value_per_unit" DECIMAL(10,2),
    "batches" JSONB NOT NULL DEFAULT '[]',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_opening_stock_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_opening_stock_rows_organization_id_item_id_location_id_key"
  ON "item_opening_stock_rows"("organization_id", "item_id", "location_id");
CREATE INDEX "item_opening_stock_rows_organization_id_item_id_idx"
  ON "item_opening_stock_rows"("organization_id", "item_id");
CREATE INDEX "item_opening_stock_rows_organization_id_location_id_idx"
  ON "item_opening_stock_rows"("organization_id", "location_id");

ALTER TABLE "item_opening_stock_rows"
  ADD CONSTRAINT "item_opening_stock_rows_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_opening_stock_rows"
  ADD CONSTRAINT "item_opening_stock_rows_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_opening_stock_rows"
  ADD CONSTRAINT "item_opening_stock_rows_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_opening_stock_rows"
  ADD CONSTRAINT "item_opening_stock_rows_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "item_opening_stock_rows"
  ADD CONSTRAINT "item_opening_stock_rows_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item_opening_stock_rows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON "item_opening_stock_rows"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
