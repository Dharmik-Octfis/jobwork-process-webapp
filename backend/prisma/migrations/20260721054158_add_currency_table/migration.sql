/*
  Warnings:

  - You are about to drop the column `description` on the `units_of_measurement` table. All the data in the column will be lost.
  - Added the required column `symbol` to the `units_of_measurement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "units_of_measurement" DROP COLUMN "description",
ADD COLUMN     "symbol" TEXT NOT NULL,
ADD COLUMN     "unit_precision" INTEGER NOT NULL DEFAULT 2,
ALTER COLUMN "uqc" SET DEFAULT 'OTH';

-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "currency_name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_organization_id_currency_code_key" ON "currencies"("organization_id", "currency_code");

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "currencies"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
