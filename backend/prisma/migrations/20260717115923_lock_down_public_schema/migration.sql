-- Make "only migrations create tables" explicit rather than inherited.
--
-- THE DEFAULT WE ARE NOT RELYING ON
-- In PostgreSQL 14 and older, schema `public` grants CREATE to the PUBLIC
-- pseudo-role — i.e. to every role in the cluster. On such a server `jobwork_app`
-- could create tables even though nobody ever granted it that, because it is a
-- privilege you have to take away rather than one you hand out.
--
-- PostgreSQL 15 removed that default, and jobwork_dev runs 18.3, so the ACL is
-- already correct here:
--     {postgres=UC/postgres, jobwork_app=U/postgres}
-- Note there is no bare `=UC/postgres` entry — that would be the PUBLIC grant.
--
-- So on our RDS this REVOKE is a no-op. It exists for the two cases where it is
-- not:
--   * a developer running PostgreSQL 14 or older locally, whose database has the
--     hole and whose `jobwork_app` therefore does not match production's;
--   * anyone who later grants it back by accident — this states the intent in a
--     place that gets replayed on every fresh database.
--
-- WHAT THIS DOES NOT DO
-- It does not stop a human with the `postgres` password from creating a table by
-- hand in pgAdmin — `postgres` owns the schema and always may. There is no
-- Postgres setting for "only accept DDL from Prisma". That is enforced socially
-- (day-to-day work uses `jobwork_app`; `postgres` is for migrations) and
-- mechanically by `npm run db:check-drift`, which fails when the database and
-- prisma/schema disagree. Run it in CI. It is what caught a hand-made `countries`
-- table on 2026-07-16.

REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;

-- Belt and braces: `jobwork_app` needs USAGE (reach the objects) but never
-- CREATE. Explicit, so a reader does not have to know the version default.
REVOKE CREATE ON SCHEMA "public" FROM jobwork_app;
GRANT USAGE ON SCHEMA "public" TO jobwork_app;
