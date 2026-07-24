-- Repairs a gap opened while fixing this database's migration history.
--
-- `permission_templates` (table + memberships.permission_template_id) had been
-- created in the dev database out-of-band, so 20260722130000_add_permission_templates
-- could not re-apply — it errored with "column permission_template_id already
-- exists" and blocked every later migration. It was resolved with
-- `prisma migrate resolve --applied`.
--
-- But that migration ALSO created the row-level security policy, and marking it
-- applied skipped those statements: the table existed, the policy did not. The
-- table is in TENANT_TABLES, so src/db/rls.test.ts caught it —
-- "permission_templates: RLS not enabled". This migration re-asserts the policy.
--
-- Lesson worth keeping: `migrate resolve --applied` skips the WHOLE migration.
-- If it created objects beyond the ones you verified as present (a policy, a
-- grant, an index), those are silently missing. Check the file, not just the table.
--
-- Idempotent so it is safe on a database where the policy does exist (e.g. one
-- where 20260722130000 genuinely ran).

ALTER TABLE "permission_templates" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "permission_templates";

CREATE POLICY tenant_isolation ON "permission_templates"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
