-- item_activities was the one tenant table with NO row-level security policy.
--
-- It is listed in TENANT_TABLES (src/db/rls.test.ts) but for a long time existed
-- only as drift — created by hand, reproduced by no migration — so it never
-- received the policy its siblings got in 20260720120100. Exactly the failure
-- mode CLAUDE.md warns about: "a tenant table with no policy is unprotected and
-- nothing will tell you." Until now an unfiltered read of item_activities
-- returned every tenant's rows.
--
-- ORDERING: this must run AFTER 20260723063148_init_customers, which is what
-- finally creates item_activities. The file was originally timestamped
-- 20260722160000 and renamed — at that position it ran before the CREATE TABLE
-- and would fail on a fresh database with "relation item_activities does not
-- exist", even though it worked on the dev DB where the table already existed.
--
-- Like vendor_activities, this table has no organization_id of its own — it
-- scopes through its parent item, so the policy joins to items. Copied verbatim
-- from the vendor_* children in 20260720120100_rename_dial_code_and_enable_vendor_rls.

ALTER TABLE "item_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "item_activities"
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = item_id
    AND i.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = item_id
    AND i.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
