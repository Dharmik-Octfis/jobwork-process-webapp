-- Two changes, both real (this migration RUNS on every environment):
--
--   1. organizations.country_code -> dial_code. The column only ever held a
--      phone calling code ("+91"), never a country code, so the name was
--      misleading. RENAME (not drop+add) so existing values are preserved.
--
--   2. Row-Level Security for the tenant tables added out of band in
--      20260720120000. They shipped with RLS OFF and no policy — an unprotected
--      tenant table, exactly what enable_rls (20260716183126) warns against.
--
-- Policy expression is identical to enable_rls / items: fail-closed on an unset
-- GUC via NULLIF(current_setting('app.current_tenant', true), '')::uuid.
-- `number_sequences` scopes on its own organization_id. The vendor_* child
-- tables have no organization_id, so they scope by joining to their parent
-- vendor — whose own RLS already restricts it to the current tenant.

-- 1. Rename ------------------------------------------------------------------
ALTER TABLE "organizations" RENAME COLUMN "country_code" TO "dial_code";

-- 2. RLS: number_sequences (direct organization_id) --------------------------
ALTER TABLE "number_sequences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "number_sequences"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- 3. RLS: vendor_* children (scope through the parent vendor) -----------------
ALTER TABLE "vendor_contact_persons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_contact_persons"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "vendor_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_activities"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "vendor_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_comments"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));

ALTER TABLE "vendor_addresses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_addresses"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
