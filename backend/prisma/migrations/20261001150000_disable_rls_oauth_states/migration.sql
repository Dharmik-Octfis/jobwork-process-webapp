-- Disable Row Level Security on oauth_states as it is a temporary OAuth handshake control-plane table
-- (deliberately not tenant-scoped because the OAuth callback is public and unauthenticated)

ALTER TABLE "oauth_states" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "oauth_states";
