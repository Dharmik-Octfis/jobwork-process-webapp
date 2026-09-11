-- add_missing_locations_unique_index
--
-- HAND-WRITTEN for the same reason as 20260911134500: `db:draft` diffs the
-- schema files against the LIVE database, which already holds this index, so a
-- draft renders it as nothing. The gap is between `prisma/migrations` and the
-- schema files.
--
-- `Location` declares `@@unique([organizationId, name])` and the database has
-- `locations_organization_id_name_key`, but no on-disk migration creates it —
-- found by counting every index in the database against every index name
-- appearing in migration SQL. A database rebuilt from `prisma/migrations` would
-- therefore accept TWO godowns with the same name in one organization, and
-- nothing would have reported it: a missing UNIQUE fails open.
--
-- 🔴 FULL, not partial, because that is what the schema declares and what the
-- database has. It carries the soft-delete hazard CLAUDE.md describes — a
-- soft-deleted location keeps its name reserved, so re-creating a location that
-- was removed needs the old row reactivated (`isDeleted: false`) rather than a
-- second insert. Making it `WHERE is_deleted = false` instead is a real
-- improvement and a SEPARATE decision: Prisma cannot express a partial index, so
-- a hand-written one reads as permanent drift to `db:check-drift`. Codifying
-- today's shape here does not endorse it.
--
-- IF NOT EXISTS because every environment already has it (dev, staging and
-- production share one database) and migrations here are not transactional.

CREATE UNIQUE INDEX IF NOT EXISTS "locations_organization_id_name_key"
  ON "locations" ("organization_id", "name");
