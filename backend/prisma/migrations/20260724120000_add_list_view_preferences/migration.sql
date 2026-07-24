-- Per-user, per-organization list column layout ("Customize Columns").
--
-- Hand-authored rather than generated: `prisma migrate diff` against this dev
-- database emits DROPs for tables that exist in the database but not (yet) in the
-- Prisma schema (accounts, locations, purchase_orders, …). Applying that diff
-- would destroy them, so this migration contains only the new table.
--
-- The RLS policy ships in the SAME migration as the table on purpose. payment_terms
-- shipped without one and spent a day unprotected — a tenant table with no policy
-- is unprotected and nothing warns you. `list_view_preferences` is also added to
-- TENANT_TABLES in src/db/rls.test.ts, so dropping this policy fails that test.
--
-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.

-- CreateTable
CREATE TABLE "list_view_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_view_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "list_view_preferences_user_id_organization_id_entity_type_key" ON "list_view_preferences"("user_id", "organization_id", "entity_type");

-- AddForeignKey
ALTER TABLE "list_view_preferences" ADD CONSTRAINT "list_view_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_view_preferences" ADD CONSTRAINT "list_view_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_view_preferences" ADD CONSTRAINT "list_view_preferences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_view_preferences" ADD CONSTRAINT "list_view_preferences_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security. The table carries its own organization_id, so the policy
-- compares directly rather than joining a parent. Copied from the enable_rls
-- migration: USING filters rows you can SEE, WITH CHECK validates rows you WRITE
-- (USING alone would still let a caller INSERT a row into another organization).
ALTER TABLE "list_view_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "list_view_preferences"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
