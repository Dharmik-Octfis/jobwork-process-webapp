import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import type { PublicMember } from './members.types.ts';

const MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  permissionTemplateId: true,
  createdAt: true,
  user: { select: { fullName: true, email: true } },
  permissionTemplate: { select: { name: true } },
} as const;

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  permissionTemplateId: string | null;
  createdAt: Date;
  user: { fullName: string; email: string };
  permissionTemplate: { name: string } | null;
};

function toPublic(row: MemberRow): PublicMember {
  return {
    id: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    email: row.user.email,
    permissionTemplateId: row.permissionTemplateId,
    roleName: row.permissionTemplate?.name ?? null,
    isOwner: row.role === 'owner',
    joinedAt: row.createdAt.toISOString(),
  };
}

/** Everyone in the organization, owner first. */
export function listMembers(organizationId: string): Promise<PublicMember[]> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.membership.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], // 'owner' sorts before 'member'
      select: MEMBER_SELECT,
    });
    return rows.map(toPublic);
  });
}

/**
 * Assign a different role (permission template) to a member.
 *
 * Refused in four cases, each of which would be a way to break or escalate the
 * permission model:
 *  - the target is the organization owner (their access is absolute by definition)
 *  - you are changing your own membership (self-escalation / self-lockout)
 *  - the target template is the Owner template (ownership is not grantable)
 *  - the template belongs to another org, or doesn't exist
 */
export function assignRole(
  actingUserId: string,
  organizationId: string,
  membershipId: string,
  permissionTemplateId: string,
): Promise<PublicMember> {
  return runAsTenant(organizationId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, isDeleted: false },
      select: { id: true, role: true, userId: true },
    });
    if (!membership) throw new ApiError(404, 'Member not found.');

    if (membership.role === 'owner') {
      throw new ApiError(403, "The organization owner's role cannot be changed.");
    }
    if (membership.userId === actingUserId) {
      throw new ApiError(403, 'You cannot change your own role.');
    }

    const template = await tx.permissionTemplate.findFirst({
      where: { id: permissionTemplateId, organizationId, isDeleted: false },
      select: { id: true, isOwner: true },
    });
    if (!template) throw ApiError.badRequest('That role does not exist.');
    if (template.isOwner) {
      throw new ApiError(403, 'The Owner role cannot be assigned to another member.');
    }

    await tx.membership.updateMany({
      where: { id: membershipId, organizationId },
      data: { permissionTemplateId, updatedBy: actingUserId },
    });

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
      select: { id: true, role: true, userId: true },
    });
    if (!membership) throw new ApiError(404, 'Member not found.');

    if (membership.role === 'owner') {
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
