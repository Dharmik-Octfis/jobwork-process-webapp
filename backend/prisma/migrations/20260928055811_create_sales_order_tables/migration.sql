-- create_sales_order_tables

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "so_number" VARCHAR(100) NOT NULL,
    "so_date" DATE NOT NULL,
    "delivery_date" DATE,
    "payment_terms" VARCHAR(100),
    "sub_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Draft',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location_id" UUID,
    "attachments" JSONB DEFAULT '[]',
    "terms_and_conditions" TEXT,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sales_order_id" UUID NOT NULL,
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

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sales_order_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sales_order_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_so_number_key" ON "sales_orders"("organization_id", "so_number");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_activities" ADD CONSTRAINT "sales_order_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_activities" ADD CONSTRAINT "sales_order_activities_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_activities" ADD CONSTRAINT "sales_order_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_comments" ADD CONSTRAINT "sales_order_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_comments" ADD CONSTRAINT "sales_order_comments_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_comments" ADD CONSTRAINT "sales_order_comments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ENABLE RLS

ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'sales_orders'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "sales_orders"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "sales_order_items" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'sales_order_items'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "sales_order_items"
      USING (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "sales_order_activities" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'sales_order_activities'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "sales_order_activities"
      USING (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "sales_order_comments" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'sales_order_comments'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "sales_order_comments"
      USING (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "sales_orders" so WHERE so.id = sales_order_id
        AND so.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;
