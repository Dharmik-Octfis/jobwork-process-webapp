-- An organization now ships with exactly ONE role: Owner. The Admin and Member
-- templates are no longer seeded — the Owner must create a role before anyone can
-- be invited, so every granted permission is a deliberate choice rather than a
-- default nobody reviewed. Invitations therefore grant a permission template
-- instead of a free-text role string.

-- 1. Drop the previously-seeded Admin / Member system templates -----------------
-- Guarded: only remove ones nothing points at. A template still assigned to a
-- member (or a pending invite) is left in place rather than silently stripping
-- someone's access — that would need a deliberate reassignment first.
DELETE FROM "permission_templates" pt
WHERE pt.is_system = true
  AND pt.is_owner = false
  AND pt.name IN ('Admin', 'Member')
  AND NOT EXISTS (
    SELECT 1 FROM "memberships" m WHERE m.permission_template_id = pt.id
  );

-- 2. Invitations grant a role (permission template), not a role string ----------
-- `role` held 'admin' | 'member', which no longer exist as concepts. The column is
-- dropped rather than kept nullable: a half-used legacy column is how two sources
-- of truth start. permission_template_id is NOT NULL — an invite without a role is
-- meaningless now that there is no default to fall back on.
ALTER TABLE "invitations" DROP COLUMN "role",
ADD COLUMN     "permission_template_id" UUID NOT NULL;

-- RESTRICT, not CASCADE: deleting a role that a pending invite depends on must
-- fail loudly rather than quietly voiding the invitation.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_permission_template_id_fkey" FOREIGN KEY ("permission_template_id") REFERENCES "permission_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
