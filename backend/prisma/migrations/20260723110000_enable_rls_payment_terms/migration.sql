-- payment_terms shipped in 20260723104320_add_payment_terms WITHOUT a row-level
-- security policy. It is a tenant table — it carries organization_id and holds
-- per-org configuration — so until now an unfiltered read returned every
-- tenant's payment terms, and a write could target another org's row.
--
-- This is precisely the failure CLAUDE.md warns about: "A tenant table with no
-- policy is unprotected and nothing will tell you." Nothing warned, because the
-- table was also missing from TENANT_TABLES in src/db/rls.test.ts — added there
-- in the same change, so the test now fails if this policy is ever dropped.
--
-- The table has its own organization_id, so the policy compares directly rather
-- than joining a parent (unlike the vendor_*/customer_*/item_activities children).
-- Copied from the enable_rls migration.

ALTER TABLE "payment_terms" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "payment_terms"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
