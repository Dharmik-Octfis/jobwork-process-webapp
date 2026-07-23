import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { ALL_PERMISSIONS, SYSTEM_TEMPLATES } from './permissions.catalog.ts';
import type { CreateTemplateInput, UpdateTemplateInput } from './permission-templates.schemas.ts';
import type { PublicPermissionTemplate } from './permission-templates.types.ts';

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
};

function toPublic(row: TemplateRow, memberCount: number): PublicPermissionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    isOwner: row.isOwner,
    // The Owner template stores no keys — expose the full computed catalog so the
    // UI renders its checkboxes (all ticked, read-only) like any other template.
    permissions: row.isOwner ? [...ALL_PERMISSIONS] : row.permissions,
    memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  isOwner: true,
  permissions: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Seed the three immutable system templates into a brand-new organization and
 * return the Owner template's id (so the caller can point the owner's Membership
 * at it). Runs inside the caller's tenant transaction — `tx` must already be
 * scoped to `organizationId` via runAsTenant, because permission_templates is
 * RLS-protected and the INSERTs are checked against `app.current_tenant`.
 */
export async function seedSystemTemplates(
  tx: TenantClient,
  organizationId: string,
  actorUserId: string | null,
): Promise<{ ownerTemplateId: string }> {
  let ownerTemplateId = '';

  for (const spec of SYSTEM_TEMPLATES) {
    const created = await tx.permissionTemplate.create({
      data: {
        organizationId,
        name: spec.name,
        description: spec.description,
        isSystem: true,
        isOwner: spec.isOwner,
        permissions: [...spec.permissions], // empty for Owner (computed via isOwner)
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      select: { id: true, isOwner: true },
    });
    if (created.isOwner) ownerTemplateId = created.id;
  }

  return { ownerTemplateId };
}

/** Active member count per template id, scoped to the org (memberships are not
 * RLS-gated, so the organizationId filter is what keeps this tenant-safe). */
async function memberCounts(
  tx: TenantClient,
  organizationId: string,
  templateIds: string[],
): Promise<Map<string, number>> {
  if (templateIds.length === 0) return new Map();
  const rows = await tx.membership.groupBy({
    by: ['permissionTemplateId'],
    where: {
      organizationId,
      isDeleted: false,
      permissionTemplateId: { in: templateIds },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.permissionTemplateId ?? '', r._count._all]));
}

/** All templates for the admin manager, newest system ones first, with usage. */
export function listTemplates(organizationId: string): Promise<PublicPermissionTemplate[]> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.permissionTemplate.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: TEMPLATE_SELECT,
    });
    const counts = await memberCounts(
      tx,
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toPublic(r, counts.get(r.id) ?? 0));
  });
}

export function getTemplate(organizationId: string, id: string): Promise<PublicPermissionTemplate> {
  return runAsTenant(organizationId, async (tx) => {
    const row = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: TEMPLATE_SELECT,
    });
    if (!row) throw new ApiError(404, 'Permission template not found.');
    const counts = await memberCounts(tx, organizationId, [row.id]);
    return toPublic(row, counts.get(row.id) ?? 0);
  });
}

export function createTemplate(
  userId: string,
  organizationId: string,
  input: CreateTemplateInput,
): Promise<PublicPermissionTemplate> {
  return runAsTenant(organizationId, async (tx) => {
    try {
      const row = await tx.permissionTemplate.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          isOwner: false,
          permissions: input.permissions,
          createdBy: userId,
          updatedBy: userId,
        },
        select: TEMPLATE_SELECT,
      });
      return toPublic(row, 0);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A template with this name already exists.');
      }
      throw error;
    }
  });
}

export function updateTemplate(
  userId: string,
  organizationId: string,
  id: string,
  input: UpdateTemplateInput,
): Promise<PublicPermissionTemplate> {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new ApiError(404, 'Permission template not found.');
    if (existing.isSystem) {
      throw new ApiError(403, 'System templates (Owner, Admin, Member) cannot be edited.');
    }

    const data: {
      updatedBy: string;
      name?: string;
      description?: string | null;
      permissions?: string[];
    } = { updatedBy: userId };
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.permissions !== undefined) data.permissions = input.permissions; // wholesale replace

    try {
      // Scope the write to the org so an id from another tenant is a no-op (RLS also guards).
      await tx.permissionTemplate.updateMany({ where: { id, organizationId }, data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A template with this name already exists.');
      }
      throw error;
    }

    const row = await tx.permissionTemplate.findFirst({
      where: { id, organizationId },
      select: TEMPLATE_SELECT,
    });
    const counts = await memberCounts(tx, organizationId, [id]);
    return toPublic(row as TemplateRow, counts.get(id) ?? 0);
  });
}

/** Soft-delete a custom template. Refuses system templates and any template still
 * assigned to a member (reassign them first — there is no per-user override). */
export function deleteTemplate(userId: string, organizationId: string, id: string): Promise<void> {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new ApiError(404, 'Permission template not found.');
    if (existing.isSystem) {
      throw new ApiError(403, 'System templates (Owner, Admin, Member) cannot be deleted.');
    }

    const inUse = await tx.membership.count({
      where: { organizationId, permissionTemplateId: id, isDeleted: false },
    });
    if (inUse > 0) {
      throw ApiError.conflict(
        `This template is assigned to ${inUse} member${inUse === 1 ? '' : 's'}. ` +
          'Assign them a different template before deleting it.',
      );
    }

    await tx.permissionTemplate.updateMany({
      where: { id, organizationId },
      data: { isDeleted: true, updatedBy: userId },
    });
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
