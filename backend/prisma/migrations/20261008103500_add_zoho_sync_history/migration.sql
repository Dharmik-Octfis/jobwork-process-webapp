-- 20261008103500_add_zoho_sync_history
-- Create Zoho sync history table referencing app_modules with tenant RLS isolation

CREATE TABLE IF NOT EXISTS "zoho_sync_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "app_module_id" UUID REFERENCES "app_modules"("id") ON DELETE SET NULL,
  "module_name" VARCHAR(255) NOT NULL,
  "sync_type" VARCHAR(100) NOT NULL,
  "sync_direction" VARCHAR(20) NOT NULL DEFAULT 'PUSH',
  "status" VARCHAR(50) NOT NULL DEFAULT 'Completed',
  "added_count" INT NOT NULL DEFAULT 0,
  "updated_count" INT NOT NULL DEFAULT 0,
  "deleted_count" INT NOT NULL DEFAULT 0,
  "failure_count" INT NOT NULL DEFAULT 0,
  "details" TEXT,
  "error_logs" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_zoho_sync_history_org_time" ON "zoho_sync_history"("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_zoho_sync_history_module" ON "zoho_sync_history"("organization_id", "app_module_id");

-- Enable Row Level Security (RLS) for tenant isolation
ALTER TABLE "zoho_sync_history" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zoho_sync_history' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "zoho_sync_history"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
