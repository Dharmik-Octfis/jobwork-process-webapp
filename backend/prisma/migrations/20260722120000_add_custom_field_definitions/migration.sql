-- AlterTable
ALTER TABLE "items" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "data_type" VARCHAR(30) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "show_in_print" BOOLEAN NOT NULL DEFAULT true,
    "show_in_list" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_organization_id_entity_type_status_idx" ON "custom_field_definitions"("organization_id", "entity_type", "status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_organization_id_entity_type_key_key" ON "custom_field_definitions"("organization_id", "entity_type", "key");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable Row-Level Security — custom_field_definitions is a tenant table.
-- Copied from 20260717123257_create_items_table. The app connects as `jobwork_app`
-- (non-owner) so this policy is enforced; runAsTenant sets app.current_tenant.
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "custom_field_definitions"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
