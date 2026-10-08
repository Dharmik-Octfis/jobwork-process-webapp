-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "invoices" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "payment_terms" VARCHAR(100),
    "sub_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Draft',
    "delivery_type" VARCHAR(50) NOT NULL DEFAULT 'Location',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location_id" UUID,
    "attachments" JSONB DEFAULT '[]',
    "terms_and_conditions" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL DEFAULT 1,
    "rate" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_percentage" DECIMAL(5,2),
    "discount_amount" DECIMAL(15,2),
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_key" ON "invoices"("organization_id", "invoice_number");

-- CreateIndex
-- CreateIndex
-- CreateIndex
-- CreateIndex
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_comments" ADD CONSTRAINT "invoice_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_comments" ADD CONSTRAINT "invoice_comments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_comments" ADD CONSTRAINT "invoice_comments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoice_items"
  USING (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_items"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_items"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "invoice_activities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoice_activities"
  USING (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_activities"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_activities"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "invoice_comments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoice_comments"
  USING (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_comments"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "invoices" WHERE "invoices"."id" = "invoice_comments"."invoice_id" AND "invoices"."organization_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

