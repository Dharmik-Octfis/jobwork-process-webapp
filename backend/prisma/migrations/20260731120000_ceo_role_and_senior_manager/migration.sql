-- Seeded org chart: "Owner" becomes "CEO", "Senior Manager" is inserted between
-- it and "Manager", and every existing organization is backfilled to the full
-- four-title chain.
--
-- New organizations get this from SYSTEM_ROLES (permissions.catalog.ts), whose
-- array ORDER is the chart: CEO → Senior Manager → Manager → Staff. This file is
-- the catch-up for organizations seeded before that change, so both paths agree.
--
-- 🔴 DATA ONLY — no DDL. `roles.parent_role_id` already exists
-- (20260730120000_per_org_member_profiles), so `db:check-drift` sees nothing here
-- and this file will never be produced by `migrate diff`. It is hand-written on
-- purpose and must be promoted as-is.
--
-- Nothing authorizes off a role, so none of this changes who can do what. A role
-- is a job title; access is the permission template on the membership. The
-- built-in role is matched on `is_system`, never on the string 'Owner' — the app
-- does the same — so this rename cannot un-protect it.
--
-- Every statement is guarded to fire ONLY on the untouched shape the seeder
-- produced. An org that has already renamed or restructured its roles is skipped
-- rather than stomped, which is why each step re-checks rather than assuming the
-- one before it ran. Two guards recur and are deliberate:
--
--   * existence checks ignore `is_deleted`, because a soft-deleted row still
--     occupies its (organization_id, name) unique key — inserting "over" one
--     aborts the whole migration. Skipping also means a title an admin DELETED is
--     never resurrected behind their back;
--   * parent lookups require `is_deleted = FALSE`, because a chart may not hang
--     off a removed title.
--
-- Order matters: 1 → 2 → 3 → 4 build the chain top-down, each anchored on the
-- level above it, and 5 runs last because it needs step 2's row to exist.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Owner → CEO, for the built-in role only.
--
--    `is_system = TRUE` is the identity; the name is just what it is called
--    today. Skipped where the org already renamed it to something else, and
--    where a role called "CEO" already exists — roles are unique per
--    (organization_id, name), so writing over one would abort the migration.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE "roles" r
SET "name" = 'CEO',
    "updated_at" = NOW()
WHERE r."is_system" = TRUE
  AND r."name" = 'Owner'
  AND r."is_deleted" = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM "roles" other
    WHERE other."organization_id" = r."organization_id"
      AND other."name" = 'CEO'
      AND other."id" <> r."id"
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. "Senior Manager" reports to the built-in root.
--
--    created_by/updated_by stay NULL: a migration has no acting user, which is
--    exactly why those columns are nullable.
--
--    An org with no live `is_system` role gets nothing from steps 2-4 — there is
--    no root to hang a chart from, and inventing one would be inventing an owner.
--    (jobwork_dev on 2026-07-31: 0 such orgs.)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO "roles" ("organization_id", "name", "description", "parent_role_id", "is_system")
SELECT root."organization_id",
       'Senior Manager',
       'Leads several teams or functions.',
       root."id",
       FALSE
FROM "roles" root
WHERE root."is_system" = TRUE
  AND root."is_deleted" = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM "roles" existing
    WHERE existing."organization_id" = root."organization_id"
      AND existing."name" = 'Senior Manager'
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. "Manager" reports to Senior Manager — only where the org has no Manager at
--    all. An org that already has one keeps it; step 5 re-parents that row
--    instead, so an existing Manager is moved, never duplicated.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO "roles" ("organization_id", "name", "description", "parent_role_id", "is_system")
SELECT senior."organization_id",
       'Manager',
       'Runs a team or a function.',
       senior."id",
       FALSE
FROM "roles" senior
WHERE senior."name" = 'Senior Manager'
  AND senior."is_deleted" = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM "roles" existing
    WHERE existing."organization_id" = senior."organization_id"
      AND existing."name" = 'Manager'
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. "Staff" reports to Manager. Same rule: inserted only where the org has no
--    Staff title, and only under a LIVE Manager.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO "roles" ("organization_id", "name", "description", "parent_role_id", "is_system")
SELECT mgr."organization_id",
       'Staff',
       'Works in the business day to day.',
       mgr."id",
       FALSE
FROM "roles" mgr
WHERE mgr."name" = 'Manager'
  AND mgr."is_deleted" = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM "roles" existing
    WHERE existing."organization_id" = mgr."organization_id"
      AND existing."name" = 'Staff'
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Slide the pre-existing "Manager" down a level: it reported to the root, now
--    it reports to Senior Manager.
--
--    Only where Manager still hangs directly off the built-in root — that is the
--    seeded shape. If an admin already moved Manager somewhere, that placement
--    was a decision and is left alone. Staff needs no move either way: it already
--    reports to Manager, and Manager moving carries the whole branch with it.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE "roles" mgr
SET "parent_role_id" = senior."id",
    "updated_at" = NOW()
FROM "roles" senior, "roles" root
WHERE senior."organization_id" = mgr."organization_id"
  AND senior."name" = 'Senior Manager'
  AND senior."is_deleted" = FALSE
  AND root."organization_id" = mgr."organization_id"
  AND root."is_system" = TRUE
  AND root."is_deleted" = FALSE
  AND mgr."name" = 'Manager'
  AND mgr."is_deleted" = FALSE
  AND mgr."parent_role_id" = root."id"
  AND senior."id" <> mgr."id";

-- ────────────────────────────────────────────────────────────────────────────
-- Verification — run after `npm run db:apply`.
-- ────────────────────────────────────────────────────────────────────────────
--
--   -- Every org's chart, top down. Expect CEO → Senior Manager → Manager → Staff
--   -- for anything still on the seeded shape:
--   WITH RECURSIVE walk(id, organization_id, name, parent_role_id, depth, path) AS (
--     SELECT id, organization_id, name, parent_role_id, 0, name::text
--     FROM roles WHERE parent_role_id IS NULL AND is_deleted = FALSE
--     UNION ALL
--     SELECT r.id, r.organization_id, r.name, r.parent_role_id, w.depth + 1,
--            w.path || ' → ' || r.name
--     FROM roles r JOIN walk w ON r.parent_role_id = w.id
--     WHERE w.depth < 20
--   )
--   SELECT organization_id, depth, path FROM walk ORDER BY organization_id, path;
--
--   -- Must return 0 rows — no org left with a built-in role still called Owner:
--   SELECT organization_id, name FROM roles WHERE is_system = TRUE AND name = 'Owner';
--
--   -- Must return 0 rows — no role orphaned or cycled by step 5:
--   WITH RECURSIVE walk(id, depth) AS (
--     SELECT id, 0 FROM roles WHERE parent_role_id IS NULL AND is_deleted = FALSE
--     UNION ALL
--     SELECT r.id, w.depth + 1 FROM roles r JOIN walk w ON r.parent_role_id = w.id
--     WHERE w.depth < 20
--   )
--   SELECT id, name FROM roles WHERE is_deleted = FALSE AND id NOT IN (SELECT id FROM walk);
