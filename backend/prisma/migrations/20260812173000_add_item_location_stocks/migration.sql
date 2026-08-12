-- add_item_location_stocks
--
-- Persisted location-level stock summary for item Locations screen. This is the
-- source of truth for stock_on_hand / committed / available figures, while
-- item_opening_stock_rows keeps the batch breakdown.

CREATE TABLE "item_location_stocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "stock_on_hand" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "committed_stock" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "available_for_sale" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_location_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_location_stocks_organization_id_item_id_location_id_key"
  ON "item_location_stocks"("organization_id", "item_id", "location_id");
CREATE INDEX "item_location_stocks_organization_id_item_id_idx"
  ON "item_location_stocks"("organization_id", "item_id");
CREATE INDEX "item_location_stocks_organization_id_location_id_idx"
  ON "item_location_stocks"("organization_id", "location_id");

ALTER TABLE "item_location_stocks"
  ADD CONSTRAINT "item_location_stocks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_location_stocks"
  ADD CONSTRAINT "item_location_stocks_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_location_stocks"
  ADD CONSTRAINT "item_location_stocks_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_location_stocks"
  ADD CONSTRAINT "item_location_stocks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "item_location_stocks"
  ADD CONSTRAINT "item_location_stocks_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item_location_stocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON "item_location_stocks"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
