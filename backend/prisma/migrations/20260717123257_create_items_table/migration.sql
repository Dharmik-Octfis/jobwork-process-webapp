-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "alias_name" TEXT,
    "type" VARCHAR(50) NOT NULL DEFAULT 'Goods',
    "category" TEXT,
    "brand" TEXT,
    "manufacturer" TEXT,
    "hsn_code" TEXT,
    "tax_preference" VARCHAR(50) NOT NULL DEFAULT 'Taxable',
    "item_type" VARCHAR(50) NOT NULL DEFAULT 'Single Item',
    "unit" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "is_sales_info" BOOLEAN NOT NULL DEFAULT false,
    "selling_price" DECIMAL(10,2),
    "sales_account" TEXT,
    "is_purchase_info" BOOLEAN NOT NULL DEFAULT false,
    "cost_price" DECIMAL(10,2),
    "purchase_account" TEXT,
    "packaging" TEXT,
    "delivery_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "items"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
