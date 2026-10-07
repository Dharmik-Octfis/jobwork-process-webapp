import { type TenantClient } from '../../../db/prisma.ts';
import type { ApproverType, ApproverConfig } from './approvalProcess.types.ts';

export interface ResolvedApprover {
  userId: string;
  fullName: string;
  email: string;
}

export class ApproverResolverService {
  /**
   * Resolves list of users who are eligible to approve for a given stage.
   */
  async resolveApprovers(
    tx: TenantClient,
    organizationId: string,
    approverType: ApproverType,
    config: ApproverConfig,
    record: Record<string, unknown>,
    requesterUserId?: string,
  ): Promise<ResolvedApprover[]> {
    switch (approverType) {
      case 'USER': {
        const userIds = config.userIds || [];
        if (userIds.length === 0) return [];

        const members = await tx.membership.findMany({
          where: {
            organizationId,
            userId: { in: userIds },
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: {
              select: { id: true, email: true, fullName: true },
            },
          },
        });

        return members.map((m) => ({
          userId: m.userId,
          fullName: m.fullName || m.user.fullName,
          email: m.user.email,
        }));
      }

      case 'ROLE': {
        const roleIds = config.roleIds || [];
        if (roleIds.length === 0) return [];

        const members = await tx.membership.findMany({
          where: {
            organizationId,
            roleId: { in: roleIds },
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: {
              select: { id: true, email: true, fullName: true },
            },
          },
        });

        return members.map((m) => ({
          userId: m.userId,
          fullName: m.fullName || m.user.fullName,
          email: m.user.email,
        }));
      }

      case 'RECORD_OWNER': {
        const ownerId =
          (record.ownerId as string) ||
          (record.createdBy as string) ||
          (record.userId as string) ||
          requesterUserId;

        if (!ownerId) return [];

        const member = await tx.membership.findFirst({
          where: {
            organizationId,
            userId: ownerId,
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: {
              select: { id: true, email: true, fullName: true },
            },
          },
        });

        if (!member) return [];
        return [
          {
            userId: member.userId,
            fullName: member.fullName || member.user.fullName,
            email: member.user.email,
          },
        ];
      }

      case 'RECORD_CREATOR': {
        const creatorId = (record.createdBy as string) || requesterUserId;
        if (!creatorId) return [];

        const member = await tx.membership.findFirst({
          where: {
            organizationId,
            userId: creatorId,
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: {
              select: { id: true, email: true, fullName: true },
            },
          },
        });

        if (!member) return [];
        return [
          {
            userId: member.userId,
            fullName: member.fullName || member.user.fullName,
            email: member.user.email,
          },
        ];
      }

      case 'REPORTING_MANAGER': {
        const targetUserId = requesterUserId || (record.createdBy as string);
        if (!targetUserId) return [];

        // Get requester's role
        const targetMember = await tx.membership.findFirst({
          where: {
            organizationId,
            userId: targetUserId,
            isDeleted: false,
          },
          include: {
            role: true,
          },
        });

        if (!targetMember?.role?.parentRoleId) {
          // Fallback to Org Owner if no manager role
          const owner = await tx.membership.findFirst({
            where: {
              organizationId,
              isOwner: true,
              isDeleted: false,
              isActive: true,
            },
            include: {
              user: { select: { id: true, email: true, fullName: true } },
            },
          });
          if (owner) {
            return [
              {
                userId: owner.userId,
                fullName: owner.fullName || owner.user.fullName,
                email: owner.user.email,
              },
            ];
          }
          return [];
        }

        // Find members holding the parent role
        const managers = await tx.membership.findMany({
          where: {
            organizationId,
            roleId: targetMember.role.parentRoleId,
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: { select: { id: true, email: true, fullName: true } },
          },
        });

        return managers.map((m) => ({
          userId: m.userId,
          fullName: m.fullName || m.user.fullName,
          email: m.user.email,
        }));
      }

      case 'LOOKUP_USER': {
        const fieldKey = config.lookupFieldId;
        if (!fieldKey) return [];

        const lookupUserId = record[fieldKey] as string;
        if (!lookupUserId) return [];

        const member = await tx.membership.findFirst({
          where: {
            organizationId,
            userId: lookupUserId,
            isDeleted: false,
            isActive: true,
          },
          include: {
            user: { select: { id: true, email: true, fullName: true } },
          },
        });

        if (!member) return [];
        return [
          {
            userId: member.userId,
            fullName: member.fullName || member.user.fullName,
            email: member.user.email,
          },
        ];
      }

      default:
        return [];
    }
  }
}

export const approverResolverService = new ApproverResolverService();
