-- drop_bill_permission_and_role_unique_indexes
--
-- REPLACES `20260824054127_remove_bill_unique_constraint`, which really did run
-- on the shared database (`applied_steps_count > 0`) and produced the right end
-- state — all three indexes are absent there today — but which can never be
-- REPLAYED, so it broke every rebuild from scratch:
--
--   Applying migration `20260824054127_remove_bill_unique_constraint`
--   Error: P3018 ... Database error code: 42704
--   ERROR: index "permission_templates_organization_id_name_key" does not exist
--
-- `20260810053834_composite_items` had already dropped that index and never
-- recreated it, so by the time 054127 ran on a fresh database its second
-- statement had nothing to drop. Its own header still reads "DRAFT — nothing
-- applies this file": it was promoted with the unreviewed `migrate diff` DROP
-- lines left in, the very lines that several neighbouring migrations carry
-- comments about having stripped by hand.
--
-- An applied migration cannot be edited — Prisma checksums it — so the file is
-- removed and this one takes its place, timestamped 48 seconds later so the
-- drops still happen at the same point in history. Anything between here and
-- today that would have violated those uniques still sees them gone.
-- `20260824054127` therefore stays in `_prisma_migrations` with no file, like the
-- four before it; harmless, and `db:status` will keep saying so.
--
-- IF EXISTS on all three, which is the whole point: `composite_items` may or may
-- not have already removed the permission_templates one depending on where the
-- database came from, and migrations here are not transactional.
--
-- 🔴 ABSENT IS THE INTENDED STATE, not an accident to be repaired later.
-- `prisma/schema/permissions.prisma` says it twice, once per model: "do not
-- 'restore' `@@unique([organizationId, name])`". A full unique index is wrong
-- here because a soft-deleted row keeps occupying its key, so deleting a
-- template or a role would permanently reserve its name.

DROP INDEX IF EXISTS "bills_organization_id_bill_number_key";
DROP INDEX IF EXISTS "permission_templates_organization_id_name_key";
DROP INDEX IF EXISTS "roles_organization_id_name_key";
