-- fix_rls

-- @destructive-ok: fixing broken RLS policy
DROP POLICY IF EXISTS "Tenant isolation" ON "item_assembly_activities";

CREATE POLICY "Tenant isolation" ON "item_assembly_activities"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
