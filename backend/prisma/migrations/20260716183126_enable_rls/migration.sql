-- Row-Level Security: the second layer of tenant isolation promised in
-- ARCHITECTURE_AND_TECH_STACK.md §3.10 and never built until now.
--
-- WHAT THIS BUYS US
-- Today, isolation is discipline-only: every query must hand-write
-- `where: { organizationId }`. One omission leaks another company's data and
-- nothing catches it. On 2026-07-16 exactly that happened — see
-- vendors.tenant-isolation.test.ts. After this, Postgres itself refuses to
-- return another tenant's rows, so a forgotten WHERE returns nothing instead of
-- everything.
--
-- The app-layer filters STAY. This is the net under them, not a replacement.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IS IT SAFE TO APPLY RIGHT NOW?  Yes — applying this changes no behaviour.
--
-- `ENABLE ROW LEVEL SECURITY` does not apply to a table's OWNER. The app
-- currently connects as `postgres`, which owns every table, so these policies
-- are inert until DATABASE_URL is switched to the `jobwork_app` role created
-- below. That is deliberate: it lets the policies land ahead of the cutover
-- rather than in the same risky step.
--
-- Protection turns ON at the moment you switch DATABASE_URL, not here.
-- See docs/PRISMA.md §8 "Turning RLS on" for that runbook.
-- ─────────────────────────────────────────────────────────────────────────────

-- PREREQUISITE: the `jobwork_app` role must already exist.
--
--   CREATE ROLE jobwork_app LOGIN PASSWORD '<from your secret store>';
--
-- It is created by hand, once per environment — see docs/PRISMA.md §8
-- "Turning RLS on". Deliberately NOT created here, for three reasons:
--
--   * A role is a CLUSTER-level object, shared by every database on the server.
--     A migration describes one database's schema. "Create this role per
--     database" is not a meaningful statement — the second database's CREATE
--     would just be a no-op.
--   * The password cannot live in a committed migration, so the role would be
--     defined in two places: half here, half by hand. One place is better.
--   * Creating roles from a migration forces every deploy runner to hold
--     CREATEROLE. A deploy should be able to change schema without being able
--     to mint new logins.
--
-- If the role is missing, the GRANTs below fail with "role jobwork_app does not
-- exist". That is intentional: it tells you to do the ops step first, rather
-- than silently creating something half-configured.
--
-- Why a separate role at all, when `postgres` on RDS is not a superuser and has
-- no BYPASSRLS? Because `postgres` OWNS these tables. An owner is exempt from
-- its own policies, and can `DROP POLICY` / `DISABLE ROW LEVEL SECURITY` at
-- will — so an SQL-injection bug in the app could switch off the very thing
-- protecting the data. A non-owner role cannot. Ownership stays with
-- `postgres`, which is what runs migrations.

-- 1. Grants -------------------------------------------------------------------
-- Data rights only. No CREATE, no ownership, no DDL.

GRANT USAGE ON SCHEMA public TO jobwork_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobwork_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jobwork_app;

-- Tables created by future migrations must be reachable too, otherwise every
-- new table silently 403s at runtime until someone re-runs the GRANT by hand.
-- This applies to objects created by `postgres`, which is who runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobwork_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO jobwork_app;

-- Migration bookkeeping is none of the app's business. Guarded because this must
-- also run against the *shadow database* — the throwaway database `migrate dev`
-- builds to replay every migration from scratch — where Prisma has not created
-- `_prisma_migrations` yet. An unguarded REVOKE here fails with
-- "relation _prisma_migrations does not exist" and takes the whole migration
-- with it, on the shadow database and on any genuinely fresh one.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM jobwork_app';
  END IF;
END
$$;

-- 2. Row-Level Security -------------------------------------------------------
--
-- WHICH TABLES GET A POLICY, AND WHY NOT THE OTHERS
--
-- Only tenant *data* tables. The tables that ESTABLISH the tenant cannot
-- themselves be tenant-gated — that is a deadlock, not an oversight:
--
--   memberships   `tenantContext` reads this to discover which org you are in.
--                 Gating it on app.current_tenant means the lookup that SETS
--                 the tenant needs the tenant already set. Nobody could ever
--                 authenticate into an organization.
--   organizations "List my organizations" runs before any org is selected —
--                 there is no current tenant yet by definition.
--   invitations   The accept-by-token page is deliberately public: no session,
--                 no organization. RLS would make every invite link 404.
--
-- These three stay app-scoped, which they already are: organizations filters on
-- `memberships: { some: { userId } }` (organizations.controller.ts) and
-- invitations scopes every mutation by organizationId (invitations.service.ts).
--
-- Never tenant-scoped at all: users, refresh_tokens, password_reset_tokens
-- (a user exists before any organization), and the master-data tables
-- industries / states / cities / countries / app_modules (shared reference data,
-- identical for every tenant).
--
-- THE POLICY EXPRESSION, PIECE BY PIECE
--
--   current_setting('app.current_tenant', true)
--       The `true` is `missing_ok`: return NULL rather than ERROR when the
--       setting was never set. NULL makes the comparison NULL — not true — so
--       an unscoped connection sees ZERO rows. Failing closed is the point.
--
--   NULLIF(..., '')
--       An unset GUC can read back as an empty string, and ''::uuid raises
--       `invalid input syntax for type uuid`. That would turn every query into
--       a 500 instead of a clean empty result. NULLIF maps '' to NULL first.
--
--   ::uuid
--       organization_id is uuid; current_setting always returns text, and
--       Postgres will not compare uuid to text. Without this cast the policy
--       errors on every query. (It was TEXT until commit f48d2fe changed it —
--       a policy written against the old schema would be wrong today.)
--
--   USING vs WITH CHECK
--       USING filters rows you can SEE (SELECT/UPDATE/DELETE).
--       WITH CHECK validates rows you WRITE (INSERT/UPDATE).
--       USING alone would still let a caller INSERT a row belonging to another
--       organization — visible to nobody, but written all the same.

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendors"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Adding a tenant table later (purchase_orders, custom_field_definitions, …)?
-- Copy the two statements above. A tenant table with no policy is unprotected
-- and nothing will warn you — rls.test.ts asserts the list, so add it there too.
