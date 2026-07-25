-- Split ROLE (a job title) from PERMISSION TEMPLATE (an access bundle).
--
-- Until now a Membership had one `permission_template_id` and the UI called it
-- "the role", so a job title and an access bundle were the same object. Two people
-- with the same title routinely need different access, and one bundle is routinely
-- shared across titles, so they are now two independent axes: memberships and
-- invitations point at one of each. See permissions.prisma and
-- docs/ROLES_AND_PERMISSIONS.md.
--
-- 🔴 Only permission_template_id affects authorization. role_id is a label —
-- nothing in the request path reads it.
--
-- NOTE: `prisma migrate diff` against the dev DB also emits DROP TABLE for
-- list_view_preferences, locations and the purchase_order_* tables — objects that
-- exist in the database but in no schema file (see docs/PRISMA.md drift notes).
-- Those drops are deliberately NOT here; this migration only adds.

-- 1. Schema -------------------------------------------------------------------

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roles_organization_id_is_deleted_idx" ON "roles"("organization_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "role_id" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "role_id" UUID;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting a role must never delete a membership. The
-- service also refuses to delete a role that is still assigned.
-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restrict on the invitation side: a role with a pending invite cannot be deleted
-- out from under it.
-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Backfill ------------------------------------------------------------------
-- Every existing org gets the one seeded system role ("Owner"), matching what
-- roles.service.ts seedSystemRoles() creates for a NEW org, and the org creator's
-- membership is given it as a title. Everyone else keeps role_id NULL — a title
-- is descriptive, and inventing one for existing members would put words in the
-- admin's mouth. Migrations run as the table owner (bypassing RLS), so no
-- app.current_tenant is needed. Guarded so re-running is a no-op.

INSERT INTO "roles" (organization_id, name, description, is_system)
SELECT o.id, 'Owner', 'The organization owner. Cannot be edited or deleted.', true
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" r WHERE r.organization_id = o.id AND r.name = 'Owner'
);

UPDATE "memberships" m
SET role_id = r.id
FROM "roles" r
WHERE r.organization_id = m.organization_id
  AND r.name = 'Owner'
  AND lower(m.role) = 'owner'
  AND m.role_id IS NULL;

-- 3. Row-Level Security --------------------------------------------------------
-- `roles` is a tenant table, so it needs a policy or it is unprotected and
-- nothing says so (CLAUDE.md). Copied from the permission_templates migration;
-- also added to TENANT_TABLES in src/db/rls.test.ts.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "roles"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
