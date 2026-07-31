-- Per-organization member profiles + role hierarchy.
--
-- Hand-written rather than `migrate diff` output: the interesting part is the
-- backfill in step 2, which no generator can infer. Order is load-bearing —
-- columns land nullable, get backfilled, and only then become NOT NULL. Adding
-- them NOT NULL in one statement would fail on any non-empty table.
--
-- Not destructive: nothing is dropped and no column narrows. `db:promote` should
-- accept it without a `-- @destructive-ok:` marker.
--
-- ⚠️ DELIBERATELY NOT INCLUDED — pre-existing drift, not ours:
--
--     CREATE UNIQUE INDEX "organizations_org_code_key" ON "organizations"("org_code");
--
-- `Organization.orgCode` is `@unique` in the schema but the index is missing in the
-- database (it appears to have been left out of 20260729071843_add_org_code). It is
-- unrelated to per-org member profiles, and it is the one statement here that can
-- FAIL on live data: if any two organizations already share an org code, creating
-- the index errors and would take this migration down with it. Fix it in its own
-- migration, after checking for duplicates:
--
--     SELECT org_code, count(*) FROM organizations GROUP BY org_code HAVING count(*) > 1;
--
-- Until then `db:check-drift` will keep reporting that one line. That is correct —
-- the schema and the database really do disagree — and quietly folding it in here
-- would hide a data problem inside an unrelated change.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. memberships — the per-org employee record
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships"
  ADD COLUMN "first_name"    VARCHAR(40),
  ADD COLUMN "last_name"     VARCHAR(40),
  ADD COLUMN "full_name"     VARCHAR(81),
  ADD COLUMN "avatar_url"    TEXT,
  ADD COLUMN "phone"         VARCHAR(20),
  ADD COLUMN "mobile"        VARCHAR(20),
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "address_line1" VARCHAR(255),
  ADD COLUMN "address_line2" VARCHAR(255),
  ADD COLUMN "city_id"       UUID,
  ADD COLUMN "state_code"    VARCHAR(6),
  ADD COLUMN "country_code"  VARCHAR(2),
  ADD COLUMN "zip"           VARCHAR(20),
  ADD COLUMN "is_active"     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Users is a full module now (ENTITY_TYPES += 'member'), so it carries the same
  -- per-org custom-fields column every other domain table does. Empty JSONB on an
  -- existing table is free; adding it later is a migration for no reason.
  ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill every existing membership from its user's account name.
--
--    This is the one step that cannot be re-run from scratch later: once the app
--    starts writing per-org names, the account name is no longer the source of
--    truth for anybody. It must happen here, in the same migration.
--
--    A user whose account name was never filled in (`users.first_name` defaults
--    to '') would otherwise become a NOT NULL empty string — a row that renders
--    as a blank line in the Users list. Those fall back to the email local-part,
--    which is the only human-readable identifier we actually hold for them. It
--    is a placeholder, not a fact: see the verification query at the bottom for
--    how to list the rows an admin should review.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE "memberships" m
SET
  "first_name" = COALESCE(NULLIF(BTRIM(u."first_name"), ''), split_part(u."email"::text, '@', 1)),
  "last_name"  = COALESCE(NULLIF(BTRIM(u."last_name"),  ''), '')
FROM "users" u
WHERE u."id" = m."user_id";

-- `full_name` is derived, never independently supplied — same rule the service
-- layer follows (`composeFullName`). BTRIM collapses the trailing space left by
-- an empty last name.
UPDATE "memberships"
SET "full_name" = BTRIM(COALESCE("first_name", '') || ' ' || COALESCE("last_name", ''));

-- Defence in depth: a membership whose user row vanished (should be impossible —
-- the FK is ON DELETE CASCADE) would still be NULL here and block the NOT NULL
-- below with an error that reads like a bug in the migration.
UPDATE "memberships"
SET "first_name" = COALESCE("first_name", 'Unknown'),
    "last_name"  = COALESCE("last_name", ''),
    "full_name"  = COALESCE(NULLIF(BTRIM("full_name"), ''), 'Unknown')
WHERE "first_name" IS NULL OR "full_name" IS NULL OR BTRIM("full_name") = '';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Now they can be required.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships"
  ALTER COLUMN "first_name" SET NOT NULL,
  ALTER COLUMN "last_name"  SET NOT NULL,
  ALTER COLUMN "full_name"  SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Address FKs — mirroring `organizations` exactly. `states` is keyed by
--    `code` VARCHAR(6) and `countries` by a 2-char `code`, NOT by uuid; using
--    uuid here would fail at runtime with "operator does not exist: uuid = text"
--    and `prisma validate` would not catch it (CLAUDE.md).
--
--    🔴 ON DELETE SET NULL, not RESTRICT. These relations declare no `onDelete` in
--    the schema — exactly like `organizations`' own city/state/country — so Prisma
--    infers SET NULL for an optional relation. Writing RESTRICT here would work
--    fine in Postgres and then leave `npm run db:check-drift` reporting drift
--    forever, because the schema and the database would genuinely disagree.
--    Match what the schema says; if RESTRICT is wanted, declare it in the schema.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_city_id_fkey"
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "memberships_state_code_fkey"
    FOREIGN KEY ("state_code") REFERENCES "states"("code") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "memberships_country_code_fkey"
    FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every list screen in the app resolves createdBy/updatedBy names through this
-- index, one probe per (org, member). See lib/memberDirectory.ts.
CREATE INDEX IF NOT EXISTS "memberships_organization_id_is_deleted_idx"
  ON "memberships" ("organization_id", "is_deleted");

-- ────────────────────────────────────────────────────────────────────────────
-- 5. invitations — the inviter now names the person they are inviting.
--
--    Deliberately NULLABLE in the database even though the API requires both.
--    Invitations created before today have no name, and deriving one from the
--    email local-part here would plant fabricated data in a customer's org with
--    no way to tell it apart from something a human typed. `acceptInvitation`
--    falls back to the account name for those rows.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "invitations"
  ADD COLUMN "first_name" VARCHAR(40),
  ADD COLUMN "last_name"  VARCHAR(40);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. roles — reporting hierarchy.
--
--    RESTRICT, not SET NULL or CASCADE: deleting a middle title must not silently
--    re-parent its subtree to the root, nor delete it. `deleteRole` refuses while
--    children exist and explains why.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "roles"
  ADD COLUMN "parent_role_id" UUID;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_parent_role_id_fkey"
    FOREIGN KEY ("parent_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "roles_organization_id_parent_role_id_idx"
  ON "roles" ("organization_id", "parent_role_id");

-- Seeded suggestion, applied only where an org still has the untouched shape the
-- seeder produced: Manager reports to Owner, Staff reports to Manager. Skipped
-- entirely for any org that has already renamed or restructured its roles, so
-- this cannot stomp a customer's existing setup.
UPDATE "roles" staff
SET "parent_role_id" = mgr."id"
FROM "roles" mgr
WHERE mgr."organization_id" = staff."organization_id"
  AND mgr."name" = 'Manager'
  AND staff."name" = 'Staff'
  AND staff."parent_role_id" IS NULL
  AND staff."is_deleted" = FALSE
  AND mgr."is_deleted" = FALSE;

UPDATE "roles" mgr
SET "parent_role_id" = owner."id"
FROM "roles" owner
WHERE owner."organization_id" = mgr."organization_id"
  AND owner."is_system" = TRUE
  AND mgr."name" = 'Manager'
  AND mgr."parent_role_id" IS NULL
  AND mgr."is_deleted" = FALSE
  AND owner."is_deleted" = FALSE;

-- ────────────────────────────────────────────────────────────────────────────
-- Verification — run after `npm run db:apply`. Both must return 0 rows.
-- ────────────────────────────────────────────────────────────────────────────
--
--   -- No membership left without a usable name:
--   SELECT id, organization_id, full_name FROM memberships WHERE BTRIM(full_name) = '';
--
--   -- No cycle in the role tree (the app also guards this on every write):
--   WITH RECURSIVE walk(id, root, depth) AS (
--     SELECT id, id, 0 FROM roles WHERE parent_role_id IS NULL AND is_deleted = FALSE
--     UNION ALL
--     SELECT r.id, w.root, w.depth + 1
--     FROM roles r JOIN walk w ON r.parent_role_id = w.id
--     WHERE w.depth < 20
--   )
--   SELECT id FROM roles WHERE is_deleted = FALSE AND id NOT IN (SELECT id FROM walk);
--
-- Placeholder names an admin should review (informational, not a failure) —
-- memberships whose name came from the email because the account had none:
--
--   SELECT m.organization_id, u.email, m.full_name
--   FROM memberships m JOIN users u ON u.id = m.user_id
--   WHERE m.last_name = '' OR m.full_name = split_part(u.email::text, '@', 1);
