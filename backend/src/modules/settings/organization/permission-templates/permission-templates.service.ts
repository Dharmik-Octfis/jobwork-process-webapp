import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { getMemberDirectory, type MemberDirectory } from '../../../../lib/memberDirectory.ts';
import { pageSlice, searchWhere, takeForPage, type ListQuery } from '../../../../lib/pagination.ts';
import { filterWhere } from '../../list-views/listFilters.catalog.ts';
import { invalidateTemplate } from './permissionTemplates.cache.ts';
import { ALL_PERMISSIONS, SYSTEM_TEMPLATES } from './permissions.catalog.ts';
import type { CreateTemplateInput, UpdateTemplateInput } from './permission-templates.schemas.ts';
import type { PublicPermissionTemplate } from './permission-templates.types.ts';
import type { Prisma } from '../../../../../generated/prisma/client.ts';

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  grantsAllPermissions: boolean;
  permissions: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPublic(
  row: TemplateRow,
  memberCount: number,
  directory: MemberDirectory,
): PublicPermissionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    grantsAllPermissions: row.grantsAllPermissions,
    // An auto-granting template stores no keys — expose the full computed catalog
    // so the UI renders its checkboxes (all ticked, read-only) like any other.
    permissions: row.grantsAllPermissions ? [...ALL_PERMISSIONS] : row.permissions,
    memberCount,
    // Ids → this org's names. Never a join: see the header of memberDirectory.ts.
    createdByName: directory.actorName(row.createdBy),
    updatedByName: directory.actorName(row.updatedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  grantsAllPermissions: true,
  permissions: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Seed a brand-new organization's templates (Owner, Full access, View only) and
 * return the Owner template's id, so the caller can point the creator's
 * Membership at it. Runs inside the caller's tenant transaction — `tx` must
 * already be scoped to `organizationId` via runAsTenant, because
 * permission_templates is RLS-protected and the INSERTs are checked against
 * `app.current_tenant`.
 *
 * Only Owner is `isSystem`; the other two are editable rows the org owns from the
 * moment they exist. See SYSTEM_TEMPLATES for what each grants and why "Full
 * access" stops short of rewriting templates.
 */
export async function seedSystemTemplates(
  tx: TenantClient,
  organizationId: string,
  actorUserId: string | null,
): Promise<{ ownerTemplateId: string }> {
  const createdTemplates = await Promise.all(
    SYSTEM_TEMPLATES.map((spec) =>
      tx.permissionTemplate.create({
        data: {
          organizationId,
          name: spec.name,
          description: spec.description,
          isSystem: spec.isSystem,
          grantsAllPermissions: spec.grantsAllPermissions,
          permissions: [...spec.permissions],
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
        select: { id: true, isSystem: true },
      }),
    ),
  );

  const ownerTemplate = createdTemplates.find((t) => t.isSystem);
  return { ownerTemplateId: ownerTemplate?.id ?? '' };
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

/**
 * The one `where` both the list and the count are built from — so the total can
 * never disagree with the rows on screen because the two queries drifted.
 *
 * Search spans name AND description: an admin looking for "warehouse" is as
 * likely to have written it in the sentence explaining the profile as in its name.
 */
function templateListWhere(
  organizationId: string,
  opts: ListQuery,
): Prisma.PermissionTemplateWhereInput {
  return {
    // RLS covers `permission_templates`, but the filter stays — both layers, always
    // (CLAUDE.md). The soft-delete rule is here too: a deleted profile must not
    // resurface in a list, a search, or a count.
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.PermissionTemplateWhereInput>('permission_template', opts.filter),
    ...searchWhere<Prisma.PermissionTemplateWhereInput>(opts.search, ['name', 'description']),
  };
}

/**
 * Settings → Permissions, on the same paginated + searchable contract as every
 * other module list (`lib/pagination.ts`, memory: list-search-pagination-pattern),
 * so the screen is built from the shared `useListSearch` / `useListColumns` /
 * `Pagination` pieces rather than a bespoke card list.
 *
 * Built-in first, then A–Z: the Owner profile is the reference everyone compares
 * against, and it is the one row that can never be edited.
 */
export async function listTemplates(organizationId: string, opts: ListQuery) {
  // 🔴 Directory FIRST, outside the transaction — acquiring a second pooled
  // connection while already holding one is how a 5-connection pool deadlocks.
  // Same rule as members.service.ts.
  const directory = await getMemberDirectory(organizationId);
  const { page, perPage } = opts;

  return runAsTenant(organizationId, async (tx) => {
    // No COUNT here — one row beyond the page answers "is there a next page?".
    const rows = await tx.permissionTemplate.findMany({
      where: templateListWhere(organizationId, opts),
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      select: TEMPLATE_SELECT,
    });

    const { results, pageContext } = pageSlice(rows, page, perPage);
    // Counted for the page's rows only, never the whole table.
    const counts = await memberCounts(
      tx,
      organizationId,
      results.map((r) => r.id),
    );
    return {
      results: results.map((r) => toPublic(r, counts.get(r.id) ?? 0, directory)),
      pageContext,
    };
  });
}

/** The opt-in total behind the "Total count: view" link. Same `where` as the list. */
export function countTemplates(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.permissionTemplate.count({ where: templateListWhere(organizationId, opts) }),
  );
}

export async function getTemplate(
  organizationId: string,
  id: string,
): Promise<PublicPermissionTemplate> {
  const directory = await getMemberDirectory(organizationId);

  return runAsTenant(organizationId, async (tx) => {
    const row = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: TEMPLATE_SELECT,
    });
    if (!row) throw new ApiError(404, 'Permission template not found.');
    const counts = await memberCounts(tx, organizationId, [row.id]);
    return toPublic(row, counts.get(row.id) ?? 0, directory);
  });
}

export async function createTemplate(
  userId: string,
  organizationId: string,
  input: CreateTemplateInput,
): Promise<PublicPermissionTemplate> {
  const directory = await getMemberDirectory(organizationId);

  return runAsTenant(organizationId, async (tx) => {
    const lowerName = input.name.trim().toLowerCase();
    const existingTemplates = await tx.permissionTemplate.findMany({
      where: { organizationId, isDeleted: false },
      select: { id: true, name: true },
    });
    if (existingTemplates.some((t) => t.name.toLowerCase() === lowerName)) {
      throw ApiError.conflict('A profile with this name already exists.');
    }

    try {
      const row = await tx.permissionTemplate.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          // Never settable through the API — only the seeded Owner template
          // auto-grants. See the field comment in permissions.prisma.
          grantsAllPermissions: false,
          permissions: input.permissions,
          createdBy: userId,
          updatedBy: userId,
        },
        select: TEMPLATE_SELECT,
      });
      return toPublic(row, 0, directory);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A profile with this name already exists.');
      }
      throw error;
    }
  });
}

export async function updateTemplate(
  userId: string,
  organizationId: string,
  id: string,
  input: UpdateTemplateInput,
): Promise<PublicPermissionTemplate> {
  const directory = await getMemberDirectory(organizationId);

  const result = await runAsTenant(organizationId, async (tx) => {
    const existing = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new ApiError(404, 'Permission template not found.');
    if (existing.isSystem) {
      throw new ApiError(403, 'The Owner template cannot be edited.');
    }

    const data: {
      updatedBy: string;
      name?: string;
      description?: string | null;
      permissions?: string[];
    } = { updatedBy: userId };
    
    if (input.name !== undefined) {
      const lowerName = input.name.trim().toLowerCase();
      const existingTemplates = await tx.permissionTemplate.findMany({
        where: { organizationId, isDeleted: false },
        select: { id: true, name: true },
      });
      if (existingTemplates.some((t) => t.id !== id && t.name.toLowerCase() === lowerName)) {
        throw ApiError.conflict('A profile with this name already exists.');
      }
      data.name = input.name;
    }
    
    if (input.description !== undefined) data.description = input.description;
    if (input.permissions !== undefined) data.permissions = input.permissions; // wholesale replace

    try {
      // Scope the write to the org so an id from another tenant is a no-op (RLS also guards).
      await tx.permissionTemplate.updateMany({ where: { id, organizationId }, data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A profile with this name already exists.');
      }
      throw error;
    }

    const row = await tx.permissionTemplate.findFirst({
      where: { id, organizationId },
      select: TEMPLATE_SELECT,
    });
    const counts = await memberCounts(tx, organizationId, [id]);
    return toPublic(row as TemplateRow, counts.get(id) ?? 0, directory);
  });

  // 🔴 AFTER the transaction commits, never inside it. Invalidating early opens
  // a window where another request reads the still-uncommitted old row and
  // caches it — and nothing would invalidate that entry again, so the stale
  // permissions would live until the TTL. This is what actually keeps a
  // permission change effective; the TTL only covers a delete that never ran.
  await invalidateTemplate(organizationId, id);
  return result;
}

/** Soft-delete a custom template. Refuses system templates and any template still
 * assigned to a member (reassign them first — there is no per-user override). */
export async function deleteTemplate(
  userId: string,
  organizationId: string,
  id: string,
): Promise<void> {
  await runAsTenant(organizationId, async (tx) => {
    const existing = await tx.permissionTemplate.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true },
    });
    if (!existing) throw new ApiError(404, 'Permission template not found.');
    if (existing.isSystem) {
      throw new ApiError(403, 'The Owner template cannot be deleted.');
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

  // After commit — same reasoning as updateTemplate. Belt and braces here, since
  // the guard above refuses to delete a template any member still holds, so
  // nothing should be resolving through it by this point.
  await invalidateTemplate(organizationId, id);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

