-- Ownership becomes a boolean above the permission system, and every org gets
-- usable starting templates.
--
-- Four things happen here:
--   1. memberships.role (VARCHAR storing one bit) → memberships.is_owner
--   2. permission_templates.is_owner → grants_all_permissions (honest name: it
--      never meant "this is the owner", it meant "auto-grant everything")
--   3. stale permission keys dropped from stored templates (organization:create /
--      organization:delete no longer exist — deleting an org is owner-only and
--      gated by requireOwner, which no template can satisfy)
--   4. existing orgs get the same seeds a new org now gets: Manager / Staff roles
--      and Full access / View only templates, all editable
--
-- 🔴 is_owner is scoped to ONE organization. It short-circuits the permission
-- resolver (tenantContext) and gates requireOwner; it never widens tenant scope.
--
-- NOTE: `prisma migrate diff` against the dev DB also emits DROP TABLE /
-- DropForeignKey for list_view_preferences, locations and purchase_order_* —
-- objects that exist in the database but in no schema file (docs/PRISMA.md drift
-- notes). Those are deliberately NOT here; this migration touches only the tables
-- named above.

-- 1. memberships.role → memberships.is_owner --------------------------------
-- Added, backfilled, then the old column dropped, so the data survives the swap.
-- Only 'owner' carried meaning: nothing wrote 'admin', and 'member' was the
-- default for everyone else.

ALTER TABLE "memberships" ADD COLUMN "is_owner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "memberships" SET is_owner = true WHERE lower(role) = 'owner';

-- Fallback: flag the organization's CREATOR when the step above found no owner.
--
-- Not paranoia — it happened. On a shared dev database, another branch ran
-- `prisma db push` after this migration had already dropped `role`; the push
-- re-created the column with its 'member' default, so every original 'owner'
-- value was gone by the time the migration was re-applied, and the whole database
-- ended up with no owners at all (nobody could edit their own organization).
-- `organizations.created_by` is the same fact recorded a second time, so it
-- recovers the answer. Guarded to a last resort: it only fires for an org where
-- nothing was flagged.
UPDATE "memberships" m
SET is_owner = true
FROM "organizations" o
WHERE o.id = m.organization_id
  AND o.created_by = m.user_id
  AND m.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM "memberships" m2
    WHERE m2.organization_id = m.organization_id AND m2.is_owner AND m2.is_deleted = false
  );

ALTER TABLE "memberships" DROP COLUMN "role";

-- A partial unique index (`UNIQUE (organization_id) WHERE is_owner AND NOT
-- is_deleted`) would make "exactly one owner per org" structural. Deliberately
-- omitted: Prisma cannot express a partial index, so it would show up forever as
-- schema drift, and this repo treats `db:check-drift` exit 2 as a CI failure.
-- Nothing but organization creation ever sets is_owner = true, and there is no
-- API that grants it. Revisit when ownership transfer is built.

-- 2. permission_templates.is_owner → grants_all_permissions -------------------
-- A rename, not a drop-and-add: the flag's meaning is unchanged, so the Owner
-- template must keep carrying it.

ALTER TABLE "permission_templates" RENAME COLUMN "is_owner" TO "grants_all_permissions";

-- 3. Drop permission keys the catalog no longer defines ----------------------
-- `organization` now exposes only read/update. A stored key outside the catalog
-- gates nothing, but leaving it there makes the row lie about what it grants.

UPDATE "permission_templates"
SET permissions = array_remove(array_remove(permissions, 'organization:create'), 'organization:delete')
WHERE permissions && ARRAY['organization:create', 'organization:delete']::text[];

-- 4. Seed existing organizations ---------------------------------------------
-- Matches what roles.service.ts / permission-templates.service.ts now create for
-- a NEW org, so every org looks the same regardless of when it was made. All four
-- rows are is_system = false: they are editable starting points, and an admin can
-- rename, retune or delete any of them.
--
-- The permission lists below are a point-in-time SNAPSHOT of permissions.catalog.ts.
-- That is correct — a migration is frozen history, not a live import of app code.
-- Migrations run as the table owner and bypass RLS, so no app.current_tenant is
-- needed. Every statement is guarded, so re-running is a no-op.

-- Roles are JOB TITLES and grant nothing. Named as titles, not access levels, on
-- purpose: "Manager" on "View only" has to read as a deliberate choice, which it
-- would not if the role were called "Admin" next to a template called "Admin".
INSERT INTO "roles" (organization_id, name, description, is_system)
SELECT o.id, v.name, v.description, false
FROM "organizations" o
CROSS JOIN (VALUES
  ('Manager', 'Runs a team or a function.'),
  ('Staff',   'Works in the business day to day.')
) AS v(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" r WHERE r.organization_id = o.id AND r.name = v.name
);

-- Full access — everything EXCEPT writing permission templates. Withheld on
-- purpose: with permission_template:update a holder can grant themselves any
-- permission in the catalog, which makes them the owner in all but name. They
-- keep :read so they can see what access exists. An owner can tick the write
-- boxes for an org that wants it.
INSERT INTO "permission_templates" (organization_id, name, description, is_system, grants_all_permissions, permissions)
SELECT o.id, 'Full access',
  'Manage everything day to day. Cannot change what other people are allowed to do.',
  false, false,
  ARRAY[
    'item:read','item:create','item:update','item:delete',
    'vendor:read','vendor:create','vendor:update','vendor:delete',
    'customer:read','customer:create','customer:update','customer:delete',
    'organization:read','organization:update',
    'member:read','member:create','member:update','member:delete',
    'role:read','role:create','role:update','role:delete',
    'permission_template:read',
    'uom:read','uom:create','uom:update','uom:delete',
    'currency:read','currency:create','currency:update','currency:delete',
    'payment_term:read','payment_term:create','payment_term:update','payment_term:delete',
    'custom_field:read','custom_field:create','custom_field:update','custom_field:delete'
  ]::text[]
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "permission_templates" pt WHERE pt.organization_id = o.id AND pt.name = 'Full access'
);

-- The immutable Owner template. Seeded by 20260722130000 originally, re-asserted
-- here because the same out-of-band `db push` described above deleted those rows
-- in the dev database (the FK is SET NULL, so it silently unlinked every owner's
-- membership too). An org missing it looks nothing like a freshly created one.
-- Owners do not actually need it — the resolver short-circuits on
-- memberships.is_owner — but the members and templates screens both name it.
INSERT INTO "permission_templates" (organization_id, name, description, is_system, grants_all_permissions, permissions)
SELECT o.id, 'Owner', 'Full access to everything. Cannot be edited or deleted.', true, true, ARRAY[]::text[]
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "permission_templates" pt WHERE pt.organization_id = o.id AND pt.name = 'Owner'
);

-- Re-link owners whose template was unlinked, and title them.
UPDATE "memberships" m
SET permission_template_id = pt.id
FROM "permission_templates" pt
WHERE pt.organization_id = m.organization_id
  AND pt.is_system
  AND m.is_owner
  AND m.permission_template_id IS NULL;

UPDATE "memberships" m
SET role_id = r.id
FROM "roles" r
WHERE r.organization_id = m.organization_id
  AND r.is_system
  AND m.is_owner
  AND m.role_id IS NULL;

-- View only — every read in the catalog, nothing else.
INSERT INTO "permission_templates" (organization_id, name, description, is_system, grants_all_permissions, permissions)
SELECT o.id, 'View only', 'See everything, change nothing.', false, false,
  ARRAY[
    'item:read','vendor:read','customer:read','organization:read','member:read',
    'role:read','permission_template:read','uom:read','currency:read',
    'payment_term:read','custom_field:read'
  ]::text[]
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "permission_templates" pt WHERE pt.organization_id = o.id AND pt.name = 'View only'
);
