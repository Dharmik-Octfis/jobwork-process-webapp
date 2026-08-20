ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
DROP POLICY IF EXISTS "Tenant isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
