-- roles_partial_unique_name
--
-- Hand-written: Prisma cannot express a PARTIAL index, so this is not, and can
-- never be, produced by `npm run db:draft`. `@@unique([organizationId, name])`
-- is removed from the Role model for the same reason — the rule now lives here
-- only. Prisma still surfaces a violation as P2002, so `withUniqueViolation`
-- in roles.service keeps returning "A role with this name already exists."
--
-- Why: roles soft-delete (`is_deleted`), and a soft-deleted row keeps occupying
-- its unique key — so deleting "Supervisor" made that title unusable forever.
-- Scoping the index to live rows frees the name on delete and still blocks two
-- live roles sharing one within an organization.
--
-- No data is touched. The new index is strictly WEAKER than the one it
-- replaces (every pair it rejects, the old one rejected too), so it cannot fail
-- to build on existing rows.

-- @destructive-ok: replaces roles_organization_id_name_key with the same index
-- scoped to `is_deleted = false`. Uniqueness across LIVE roles is unchanged;
-- only soft-deleted rows stop reserving a name. No rows are read or written.

-- DropIndex
DROP INDEX "roles_organization_id_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_name_key"
  ON "roles"("organization_id", "name")
  WHERE "is_deleted" = false;
