-- AlterTable
ALTER TABLE "items" ADD COLUMN     "bin_location_tracking" TEXT,
ADD COLUMN     "front_image" TEXT,
ADD COLUMN     "images" TEXT[],
ADD COLUMN     "inventory_account" TEXT,
ADD COLUMN     "inventory_tracking" TEXT,
ADD COLUMN     "inventory_valuation_method" TEXT,
ADD COLUMN     "rear_image" TEXT,
ADD COLUMN     "track_inventory" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "country_code" VARCHAR(2);

-- CreateTable
CREATE TABLE "item_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "primary_contact_salutation" VARCHAR(20),
    "primary_contact_first_name" VARCHAR(100),
    "primary_contact_last_name" VARCHAR(100),
    "company_name" VARCHAR(255),
    "display_name" VARCHAR(255) NOT NULL DEFAULT '',
    "customer_number" VARCHAR(50) NOT NULL,
    "email_address" VARCHAR(255),
    "work_phone" VARCHAR(50),
    "mobile_phone" VARCHAR(50),
    "currency" VARCHAR(10),
    "payment_terms" VARCHAR(100),
    "remarks" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact_persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "salutation" VARCHAR(20),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "email_address" VARCHAR(255),
    "work_phone" VARCHAR(50),
    "mobile_phone" VARCHAR(50),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "address_type" VARCHAR(50) NOT NULL,
    "attention" VARCHAR(255),
    "country" VARCHAR(100),
    "street1" TEXT,
    "street2" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pin_code" VARCHAR(20),
    "phone" VARCHAR(50),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_customer_number_key" ON "customers"("organization_id", "customer_number");

-- AddForeignKey
ALTER TABLE "item_activities" ADD CONSTRAINT "item_activities_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_activities" ADD CONSTRAINT "item_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_activities" ADD CONSTRAINT "item_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_persons" ADD CONSTRAINT "customer_contact_persons_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_persons" ADD CONSTRAINT "customer_contact_persons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_persons" ADD CONSTRAINT "customer_contact_persons_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_activities" ADD CONSTRAINT "customer_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_comments" ADD CONSTRAINT "customer_comments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_comments" ADD CONSTRAINT "customer_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_comments" ADD CONSTRAINT "customer_comments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. RLS: customers
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customers"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- 2. RLS: customer_* children (scope through the parent customer)
ALTER TABLE "customer_contact_persons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_contact_persons"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "customer_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_activities"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "customer_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_comments"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_addresses"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
