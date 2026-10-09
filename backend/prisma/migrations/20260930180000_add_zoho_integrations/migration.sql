-- 20260930180000_add_zoho_integrations
-- Create Zoho Books integrations and OAuth state tables with tenant RLS isolation

CREATE TABLE IF NOT EXISTS "zoho_integrations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "provider" VARCHAR(50) NOT NULL DEFAULT 'ZOHO_BOOKS',
  "status" VARCHAR(30) NOT NULL DEFAULT 'NOT_CONNECTED',
  "refresh_token" TEXT,
  "access_token" TEXT,
  "token_type" VARCHAR(50) DEFAULT 'Bearer',
  "expires_at" TIMESTAMPTZ(6),
  "api_domain" VARCHAR(255),
  "accounts_server" VARCHAR(255),
  "zoho_location" VARCHAR(50),
  "selected_organization_id" VARCHAR(100),
  "selected_organization_name" VARCHAR(255),
  "connected_at" TIMESTAMPTZ(6),
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_zoho_integrations_org" ON "zoho_integrations"("organization_id", "status");

CREATE TABLE IF NOT EXISTS "oauth_states" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "state" VARCHAR(128) NOT NULL UNIQUE,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" VARCHAR(50) NOT NULL DEFAULT 'ZOHO_BOOKS',
  "accounts_server" VARCHAR(255),
  "return_to" VARCHAR(255),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_oauth_states_org" ON "oauth_states"("organization_id");
CREATE INDEX IF NOT EXISTS "idx_oauth_states_state" ON "oauth_states"("state");

-- Enable Row Level Security (RLS) for tenant isolation
ALTER TABLE "zoho_integrations" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'zoho_integrations' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "zoho_integrations"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oauth_states' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "oauth_states"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
