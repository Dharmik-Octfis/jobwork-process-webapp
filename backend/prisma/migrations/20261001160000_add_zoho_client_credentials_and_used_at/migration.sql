-- Alter zoho_integrations to add client_id and encrypted client_secret
ALTER TABLE "zoho_integrations" ADD COLUMN IF NOT EXISTS "client_id" VARCHAR(255);
ALTER TABLE "zoho_integrations" ADD COLUMN IF NOT EXISTS "client_secret" TEXT;
ALTER TABLE "zoho_integrations" ALTER COLUMN "status" TYPE VARCHAR(50);

-- Alter oauth_states to add used_at and index on expires_at
ALTER TABLE "oauth_states" ADD COLUMN IF NOT EXISTS "used_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "idx_oauth_states_expires_at" ON "oauth_states"("expires_at");
