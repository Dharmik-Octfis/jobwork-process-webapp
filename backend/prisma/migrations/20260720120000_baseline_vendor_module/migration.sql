-- Baseline of the vendor module + number_sequences that were applied to the dev
-- database OUT OF BAND (no migration was ever written). This migration records
-- those changes so the migration history matches reality again.
--
-- On the existing dev DB it is marked as ALREADY APPLIED (`prisma migrate
-- resolve --applied`) and never runs — the tables already exist. On a fresh
-- environment it runs normally, after 0_init created `vendors` with its old
-- columns, to bring the schema up to the current shape.
--
-- RLS for the new tenant tables is intentionally NOT here — it is added in the
-- next migration (20260720120100), which also matches the real DB (these tables
-- currently have no policy). The organizations country_code -> dial_code rename
-- likewise lives in that next migration.

-- AlterTable
ALTER TABLE "vendors" DROP COLUMN "gst_treatment",
DROP COLUMN "phone",
DROP COLUMN "source_of_supply",
DROP COLUMN "vendor_name",
ADD COLUMN     "company_name" VARCHAR(255),
ADD COLUMN     "currency" VARCHAR(10),
ADD COLUMN     "display_name" VARCHAR(255) NOT NULL DEFAULT '',
ADD COLUMN     "mobile_phone" VARCHAR(50),
ADD COLUMN     "payment_terms" VARCHAR(100),
ADD COLUMN     "primary_contact_first_name" VARCHAR(100),
ADD COLUMN     "primary_contact_last_name" VARCHAR(100),
ADD COLUMN     "primary_contact_salutation" VARCHAR(20),
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN     "work_phone" VARCHAR(50);

-- CreateTable
CREATE TABLE "vendor_contact_persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "salutation" VARCHAR(20),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "email_address" VARCHAR(255),
    "work_phone" VARCHAR(50),
    "mobile_phone" VARCHAR(50),

    CONSTRAINT "vendor_contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_addresses" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "address_type" VARCHAR(50) NOT NULL,
    "attention" VARCHAR(255),
    "country" VARCHAR(100),
    "street1" TEXT,
    "street2" TEXT,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pin_code" VARCHAR(20),
    "phone" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_organization_id_entity_type_key" ON "number_sequences"("organization_id", "entity_type");

-- AddForeignKey
ALTER TABLE "vendor_contact_persons" ADD CONSTRAINT "vendor_contact_persons_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_activities" ADD CONSTRAINT "vendor_activities_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_comments" ADD CONSTRAINT "vendor_comments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_addresses" ADD CONSTRAINT "vendor_addresses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
