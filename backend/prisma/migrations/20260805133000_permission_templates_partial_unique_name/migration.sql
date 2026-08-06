-- permission_templates_partial_unique_name
--
-- The same change `20260805130000_roles_partial_unique_name` made to `roles`,
-- for the table that sits beside it. Hand-written for the same reason: Prisma
-- has no partial-index syntax, so `npm run db:draft` cannot produce this and
-- `@@unique([organizationId, name])` comes off the PermissionTemplate model —
-- the rule lives here only. Violations still surface as P2002, so the
-- `isUniqueViolation` branches in permission-templates.service keep returning
-- "A template with this name already exists."
--
-- Why: permission templates soft-delete (`is_deleted`), and a soft-deleted row
-- keeps occupying its unique key — so deleting "Warehouse Staff" made that name
-- unusable forever. Scoping the index to live rows frees the name on delete and
-- still blocks two live templates sharing one within an organization.
--
-- No data is touched. The new index is strictly WEAKER than the one it
-- replaces (every pair it rejects, the old one rejected too), so it cannot fail
-- to build on existing rows.

-- @destructive-ok: replaces permission_templates_organization_id_name_key with
-- the same index scoped to `is_deleted = false`. Uniqueness across LIVE
-- templates is unchanged; only soft-deleted rows stop reserving a name. No rows
-- are read or written.

-- DropIndex
DROP INDEX "permission_templates_organization_id_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "permission_templates_organization_id_name_key"
  ON "permission_templates"("organization_id", "name")
  WHERE "is_deleted" = false;
