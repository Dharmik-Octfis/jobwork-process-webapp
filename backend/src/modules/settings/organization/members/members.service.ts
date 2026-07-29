import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import type { UpdateMemberInput } from './members.schemas.ts';
import type { PublicMember } from './members.types.ts';

const MEMBER_SELECT = {
  id: true,
  userId: true,
  isOwner: true,
  roleId: true,
  permissionTemplateId: true,
  createdAt: true,
  user: { select: { fullName: true, email: true, userAgent: true } },
  role: { select: { name: true } },
  permissionTemplate: { select: { name: true } },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  isOwner: boolean;
  roleId: string | null;
  permissionTemplateId: string | null;
  createdAt: Date;
  user: { fullName: string; email: string; userAgent?: string | null };
  role: { name: string } | null;
  permissionTemplate: { name: string } | null;
};

function toPublic(row: MemberRow): PublicMember {
  return {
    id: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    email: row.user.email,
    roleId: row.roleId,
    roleName: row.role?.name ?? null,
    permissionTemplateId: row.permissionTemplateId,
    permissionTemplateName: row.permissionTemplate?.name ?? null,
    isOwner: row.isOwner,
    joinedAt: row.createdAt.toISOString(),
    userAgent: row.user.userAgent ?? 'unknown',
  };
}

/** Everyone in the organization, owner first. */
export function listMembers(organizationId: string): Promise<PublicMember[]> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.membership.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }], // owner first, then join order
      select: MEMBER_SELECT,
    });
    return rows.map(toPublic);
  });
}

/**
 * Prove a permission template may be handed to this member. The Owner template is
 * refused: ownership comes from creating the organization, not from being granted.
 */
async function assertAssignableTemplate(
  tx: TenantClient,
  organizationId: string,
  permissionTemplateId: string,
): Promise<void> {
  const template = await tx.permissionTemplate.findFirst({
    where: { id: permissionTemplateId, organizationId, isDeleted: false },
    select: { isSystem: true },
  });
  if (!template) throw ApiError.badRequest('That permission template does not exist.');
  // `isSystem` is the Owner template. The seeded "Full access" / "View only" rows
  // are ordinary editable templates and freely assignable.
  if (template.isSystem) {
    throw new ApiError(403, 'The Owner permission template cannot be assigned to another member.');
  }
}

/** Prove a job title may be handed to this member. The seeded Owner role is
 * refused for the same reason its template is — it means "this is the owner". */
async function assertAssignableRole(
  tx: TenantClient,
  organizationId: string,
  roleId: string,
): Promise<void> {
  const role = await tx.role.findFirst({
    where: { id: roleId, organizationId, isDeleted: false },
    select: { isSystem: true },
  });
  if (!role) throw ApiError.badRequest('That role does not exist.');
  if (role.isSystem) {
    throw new ApiError(403, 'The Owner role cannot be assigned to another member.');
  }
}

/**
 * Change a member's job title, their permission template, or both — they are
 * independent, so the same title can hold different access and vice versa.
 *
 * Refused in these cases, each of which would break or escalate the model:
 *  - the target is the organization owner (their access is absolute by definition)
 *  - you are changing your own membership (self-escalation / self-lockout)
 *  - the target template or role is the Owner one (ownership is not grantable)
 *  - the template or role belongs to another org, or doesn't exist
 *
 * The self/owner guard covers the title too, even though a title grants nothing:
 * the owner's "Owner" title is part of what marks them, and one rule is easier to
 * reason about than "titles are editable but access isn't".
 */
export function updateMember(
  actingUserId: string,
  organizationId: string,
  membershipId: string,
  input: UpdateMemberInput,
): Promise<PublicMember> {
  return runAsTenant(organizationId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: { id: true, isOwner: true, userId: true },
    });
    if (!membership) throw ApiError.notFound('Member not found.');

    if (membership.isOwner) {
      throw new ApiError(403, "The organization owner's role and permissions cannot be changed.");
    }
    if (membership.userId === actingUserId) {
      throw new ApiError(403, 'You cannot change your own role or permissions.');
    }

    const data: { updatedBy: string; roleId?: string | null; permissionTemplateId?: string } = {
      updatedBy: actingUserId,
    };

    if (input.permissionTemplateId !== undefined) {
      await assertAssignableTemplate(tx, organizationId, input.permissionTemplateId);
      data.permissionTemplateId = input.permissionTemplateId;
    }

    // `null` clears the title; a uuid must resolve to a role in this org.
    if (input.roleId !== undefined) {
      if (input.roleId !== null) await assertAssignableRole(tx, organizationId, input.roleId);
      data.roleId = input.roleId;
    }

    await tx.membership.updateMany({ where: { id: membershipId, organizationId }, data });

    const updated = await tx.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: MEMBER_SELECT,
    });
    return toPublic(updated as MemberRow);
  });
}

/** Remove a member from the organization (soft delete). The owner and yourself
 * are both off-limits — an org must always keep its owner, and removing yourself
 * is an account action, not a member-management one. */
export function removeMember(
  actingUserId: string,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  return runAsTenant(organizationId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: { id: true, isOwner: true, userId: true },
    });
    if (!membership) throw ApiError.notFound('Member not found.');

    if (membership.isOwner) {
      throw new ApiError(403, 'The organization owner cannot be removed.');
    }
    if (membership.userId === actingUserId) {
      throw new ApiError(403, 'You cannot remove yourself from the organization.');
    }

    await tx.membership.updateMany({
      where: { id: membershipId, organizationId },
      data: { isDeleted: true, updatedBy: actingUserId },
    });
  });
}
