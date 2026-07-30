import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../../lib/apiError.ts';
import { SYSTEM_ROLES } from '../permission-templates/permissions.catalog.ts';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schemas.ts';
import type { PublicRole } from './roles.types.ts';

/**
 * Roles — job titles. A role carries NO permissions and grants nothing; it says
 * what someone is here to do, not what they may do. Access lives in permission
 * templates, on a separate endpoint (`permission-templates.service.ts`), so the
 * same title can hold different access and the same access can span titles.
 *
 * 🔴 Nothing in the request path reads a role. If you ever find code branching on
 * a role name, that is an authorization bug — the check belongs in the permission
 * catalog and `requirePermission`.
 */

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPublic(row: RoleRow, memberCount: number): PublicRole {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Seed a brand-new organization's roles and return the Owner role's id, so the
 * caller can title the creator's Membership with it. Runs inside the caller's
 * tenant transaction — `roles` is RLS-protected, so `tx` must already be scoped
 * via runAsTenant or the INSERTs are rejected.
 *
 * "Owner" is immutable; "Manager" and "Staff" are editable suggestions so the
 * screen isn't empty on day one. See SYSTEM_ROLES for why they are named as job
 * titles rather than access levels.
 */
export async function seedSystemRoles(
  tx: TenantClient,
  organizationId: string,
  actorUserId: string | null,
): Promise<{ ownerRoleId: string }> {
  const createdRoles = await Promise.all(
    SYSTEM_ROLES.map((spec) =>
      tx.role.create({
        data: {
          organizationId,
          name: spec.name,
          description: spec.description,
          isSystem: spec.isSystem,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
        select: { id: true, isSystem: true },
      })
    )
  );

  const ownerRole = createdRoles.find((r) => r.isSystem);
  return { ownerRoleId: ownerRole?.id ?? '' };
}

/** How many active members hold each of these titles. Memberships are not
 * RLS-gated, so the organizationId filter is what keeps this tenant-safe. */
async function memberCounts(
  tx: TenantClient,
  organizationId: string,
  roleIds: string[],
): Promise<Map<string, number>> {
  if (roleIds.length === 0) return new Map();
  const rows = await tx.membership.groupBy({
    by: ['roleId'],
    where: { organizationId, isDeleted: false, roleId: { in: roleIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.roleId ?? '', r._count._all]));
}

/** Every role in the org, system first then alphabetical, with usage counts. */
export function listRoles(organizationId: string): Promise<PublicRole[]> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.role.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
    const counts = await memberCounts(
      tx,
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toPublic(r, counts.get(r.id) ?? 0));
  });
}

export function getRole(organizationId: string, id: string): Promise<PublicRole> {
  return runAsTenant(organizationId, async (tx) => {
    const row = await tx.role.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: ROLE_SELECT,
    });
    if (!row) throw ApiError.notFound('Role not found.');
    const counts = await memberCounts(tx, organizationId, [row.id]);
    return toPublic(row, counts.get(row.id) ?? 0);
  });
}

export function createRole(
  userId: string,
  organizationId: string,
  input: CreateRoleInput,
): Promise<PublicRole> {
  return runAsTenant(organizationId, async (tx) => {
    const row = await withUniqueViolation('A role with this name already exists.', () =>
      tx.role.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          createdBy: userId,
          updatedBy: userId,
        },
        select: ROLE_SELECT,
      }),
    );
    return toPublic(row, 0);
  });
}

export function updateRole(
  userId: string,
  organizationId: string,
  id: string,
  input: UpdateRoleInput,
): Promise<PublicRole> {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.role.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw ApiError.notFound('Role not found.');
    if (existing.isSystem) throw new ApiError(403, 'The Owner role cannot be edited.');

    const data: { updatedBy: string; name?: string; description?: string | null } = {
      updatedBy: userId,
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    // Scoped to the org so an id from another tenant is a no-op (RLS also guards).
    await withUniqueViolation('A role with this name already exists.', () =>
      tx.role.updateMany({ where: { id, organizationId }, data }),
    );

    const row = await tx.role.findFirst({ where: { id, organizationId }, select: ROLE_SELECT });
    const counts = await memberCounts(tx, organizationId, [id]);
    return toPublic(row as RoleRow, counts.get(id) ?? 0);
  });
}

/**
 * Soft-delete a role. Refused for the system Owner role, for a role still held by
 * a member, and for one a pending invitation would hand out — the invitation FK is
 * `Restrict`, so the second case would fail at the database anyway, with an error
 * nobody could act on.
 */
export function deleteRole(userId: string, organizationId: string, id: string): Promise<void> {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.role.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw ApiError.notFound('Role not found.');
    if (existing.isSystem) throw new ApiError(403, 'The Owner role cannot be deleted.');

    const inUse = await tx.membership.count({
      where: { organizationId, roleId: id, isDeleted: false },
    });
    if (inUse > 0) {
      throw ApiError.conflict(
        `This role is assigned to ${inUse} member${inUse === 1 ? '' : 's'}. ` +
          'Give them a different role before deleting it.',
      );
    }

    const pendingInvites = await tx.invitation.count({
      where: { organizationId, roleId: id, status: 'pending' },
    });
    if (pendingInvites > 0) {
      throw ApiError.conflict(
        `This role is used by ${pendingInvites} pending invitation${pendingInvites === 1 ? '' : 's'}. ` +
          'Revoke them before deleting it.',
      );
    }

    await tx.role.updateMany({
      where: { id, organizationId },
      data: { isDeleted: true, updatedBy: userId },
    });
  });
}
