import { runAsTenant, type TenantClient } from '../../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../../lib/apiError.ts';
import { SYSTEM_ROLES } from '../permission-templates/permissions.catalog.ts';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schemas.ts';
import type { PublicRole } from './roles.types.ts';

/**
 * Roles — job titles, arranged in a reporting hierarchy. A role carries NO
 * permissions and grants nothing; it says what someone is here to do, not what they
 * may do. Access lives in permission templates, on a separate endpoint
 * (`permission-templates.service.ts`), so the same title can hold different access
 * and the same access can span titles.
 *
 * 🔴 Nothing in the request path reads a role, and `parentRoleId` does not change
 * that. The hierarchy is structure for humans: an org chart, indented pickers, and
 * a "reports to" line on a user's record. It grants nothing to a parent and takes
 * nothing from a child. If you ever find code branching on a role name OR walking
 * this tree to decide what someone may do or see, that is an authorization bug —
 * the check belongs in the permission catalog and `requirePermission`.
 */

/**
 * How deep an org chart may go. Not a technical limit — Postgres and the recursive
 * walks here would handle far more — but a guard against a UI that indents itself
 * off the screen, and a bound that makes every tree walk in this file provably
 * terminate even if a cycle somehow reached the table.
 */
const MAX_DEPTH = 10;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  parentRoleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  parentRoleId: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Tree helpers ────────────────────────────────────────────────────────────
//
// All of them work on the full set of the org's live roles, loaded once. A role
// tree is a handful of rows, so walking it in memory beats a recursive CTE per
// question — and keeps the cycle rules in one readable place rather than in SQL.

type RoleIndex = Map<string, RoleRow>;

function indexRoles(rows: RoleRow[]): RoleIndex {
  return new Map(rows.map((r) => [r.id, r]));
}

/** Root-first ids from the tree top down to `id`, inclusive. */
function ancestorChain(id: string, index: RoleIndex): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;

  // The `seen` guard is belt-and-braces: writes below make a cycle impossible, so
  // reaching it would mean the table was edited outside the app. Terminating with a
  // partial chain beats hanging the request.
  while (cursor && !seen.has(cursor) && chain.length <= MAX_DEPTH + 1) {
    seen.add(cursor);
    chain.unshift(cursor);
    cursor = index.get(cursor)?.parentRoleId ?? null;
  }

  return chain;
}

/** Every id at or below `id`. Used to reject a move into a role's own subtree. */
function subtreeIds(id: string, rows: RoleRow[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentRoleId) continue;
    const list = childrenOf.get(r.parentRoleId);
    if (list) list.push(r.id);
    else childrenOf.set(r.parentRoleId, [r.id]);
  }

  const out = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const child of childrenOf.get(next) ?? []) {
      if (out.has(child)) continue; // pre-existing cycle; do not loop forever
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** Deepest level below `id`, counted in edges. 0 when it has no children. */
function subtreeHeight(id: string, rows: RoleRow[]): number {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentRoleId) continue;
    const list = childrenOf.get(r.parentRoleId);
    if (list) list.push(r.id);
    else childrenOf.set(r.parentRoleId, [r.id]);
  }

  let height = 0;
  let level = [id];
  const seen = new Set<string>([id]);

  while (level.length > 0 && height <= MAX_DEPTH + 1) {
    const next: string[] = [];
    for (const nodeId of level) {
      for (const child of childrenOf.get(nodeId) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    if (next.length === 0) break;
    height += 1;
    level = next;
  }

  return height;
}

/**
 * Validate a proposed parent for `roleId` (null when creating).
 *
 * Four ways this can be wrong, and all four are refused here rather than left to
 * the FK — the database can only tell you "constraint violated", which an admin
 * cannot act on:
 *
 *  1. the parent isn't a live role in THIS org (or is an id from another tenant);
 *  2. the parent is the role itself — a one-node cycle;
 *  3. the parent is inside the role's own subtree — the classic re-parenting cycle
 *     that would orphan the whole branch from the root;
 *  4. the move would push the branch past `MAX_DEPTH`.
 *
 * Postgres would happily store 2, 3 and 4: an FK prevents a *dangling* parent, not
 * a cyclic or absurdly deep one.
 */
async function assertValidParent(
  tx: TenantClient,
  organizationId: string,
  roleId: string | null,
  parentRoleId: string,
): Promise<void> {
  if (roleId && parentRoleId === roleId) {
    throw ApiError.badRequest('A role cannot report to itself.');
  }

  const rows = (await tx.role.findMany({
    where: { organizationId, isDeleted: false },
    select: ROLE_SELECT,
  })) as RoleRow[];

  const index = indexRoles(rows);
  const parent = index.get(parentRoleId);
  if (!parent) {
    throw ApiError.badRequest('That parent role does not exist.');
  }

  if (roleId) {
    const descendants = subtreeIds(roleId, rows);
    if (descendants.has(parentRoleId)) {
      throw ApiError.badRequest(
        `"${parent.name}" reports to this role, so it cannot also be its parent. ` +
          'Move it out from under this role first.',
      );
    }
  }

  // Depth of the parent (edges from root) + the edge we are about to add + however
  // deep the moving branch already is.
  const parentDepth = ancestorChain(parentRoleId, index).length - 1;
  const movingHeight = roleId ? subtreeHeight(roleId, rows) : 0;

  if (parentDepth + 1 + movingHeight > MAX_DEPTH) {
    throw ApiError.badRequest(
      `That would make the role hierarchy more than ${MAX_DEPTH} levels deep. ` +
        'Flatten part of the structure first.',
    );
  }
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

function toPublic(
  row: RoleRow,
  index: RoleIndex,
  memberCount: number,
  childCount: number,
): PublicRole {
  const chain = ancestorChain(row.id, index);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    parentRoleId: row.parentRoleId,
    parentRoleName: row.parentRoleId ? (index.get(row.parentRoleId)?.name ?? null) : null,
    depth: Math.max(0, chain.length - 1),
    path: chain.map((id) => index.get(id)?.name ?? '—'),
    memberCount,
    childCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Direct-child counts for every role in one pass. */
function childCounts(rows: RoleRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.parentRoleId) continue;
    counts.set(r.parentRoleId, (counts.get(r.parentRoleId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Seed a brand-new organization's roles and return the Owner role's id, so the
 * caller can title the creator's Membership with it. Runs inside the caller's
 * tenant transaction — `roles` is RLS-protected, so `tx` must already be scoped
 * via runAsTenant or the INSERTs are rejected.
 *
 * The first title ("CEO") is immutable; the rest are editable suggestions so the
 * screen isn't empty on day one. See SYSTEM_ROLES for why they are named as job
 * titles rather than access levels.
 *
 * Created in dependency order (not `Promise.all`) because each row's parent must
 * already exist: CEO → Senior Manager → Manager → Staff gives a new org a single
 * chain to edit rather than four disconnected roots.
 */
export async function seedSystemRoles(
  tx: TenantClient,
  organizationId: string,
  actorUserId: string | null,
): Promise<{ ownerRoleId: string }> {
  let ownerRoleId = '';
  let parentRoleId: string | null = null;

  for (const spec of SYSTEM_ROLES) {
    const created: { id: string; isSystem: boolean } = await tx.role.create({
      data: {
        organizationId,
        name: spec.name,
        description: spec.description,
        isSystem: spec.isSystem,
        parentRoleId,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      select: { id: true, isSystem: true },
    });

    if (created.isSystem) ownerRoleId = created.id;
    // Each seeded title reports to the one before it, in SYSTEM_ROLES order.
    parentRoleId = created.id;
  }

  return { ownerRoleId };
}

/**
 * Every role in the org, ordered as a **depth-first walk of the org chart** —
 * parents immediately followed by their children — so the client can render an
 * indented tree by reading `depth` straight down the array, with no grouping pass.
 * Siblings are ordered system-first then alphabetically, matching the old flat
 * ordering within each level.
 */
export function listRoles(organizationId: string): Promise<PublicRole[]> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = (await tx.role.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    })) as RoleRow[];

    const index = indexRoles(rows);
    const children = childCounts(rows);
    const counts = await memberCounts(
      tx,
      organizationId,
      rows.map((r) => r.id),
    );

    // A role whose parent was soft-deleted would otherwise vanish from the walk.
    // Treat it as a root so it stays visible and fixable.
    const isRoot = (r: RoleRow) => !r.parentRoleId || !index.has(r.parentRoleId);

    const ordered: RoleRow[] = [];
    const emitted = new Set<string>();

    const walk = (node: RoleRow, depth: number): void => {
      if (emitted.has(node.id) || depth > MAX_DEPTH + 1) return;
      emitted.add(node.id);
      ordered.push(node);
      for (const child of rows.filter((r) => r.parentRoleId === node.id)) {
        walk(child, depth + 1);
      }
    };

    for (const root of rows.filter(isRoot)) walk(root, 0);
    // Anything left is inside a cycle (only possible if the table was edited
    // outside the app). Append rather than drop it — an invisible role is a role
    // nobody can repair.
    for (const row of rows) if (!emitted.has(row.id)) ordered.push(row);

    return ordered.map((r) => toPublic(r, index, counts.get(r.id) ?? 0, children.get(r.id) ?? 0));
  });
}

export function getRole(organizationId: string, id: string): Promise<PublicRole> {
  return runAsTenant(organizationId, async (tx) => {
    const rows = (await tx.role.findMany({
      where: { organizationId, isDeleted: false },
      select: ROLE_SELECT,
    })) as RoleRow[];

    const row = rows.find((r) => r.id === id);
    if (!row) throw ApiError.notFound('Role not found.');

    const counts = await memberCounts(tx, organizationId, [row.id]);
    return toPublic(
      row,
      indexRoles(rows),
      counts.get(row.id) ?? 0,
      childCounts(rows).get(row.id) ?? 0,
    );
  });
}

export function createRole(
  userId: string,
  organizationId: string,
  input: CreateRoleInput,
): Promise<PublicRole> {
  return runAsTenant(organizationId, async (tx) => {
    if (input.parentRoleId) {
      await assertValidParent(tx, organizationId, null, input.parentRoleId);
    }

    const created = await withUniqueViolation('A role with this name already exists.', () =>
      tx.role.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          parentRoleId: input.parentRoleId ?? null,
          isSystem: false,
          createdBy: userId,
          updatedBy: userId,
        },
        select: ROLE_SELECT,
      }),
    );

    // Re-read the set so `path`/`depth` include the row just written.
    const rows = (await tx.role.findMany({
      where: { organizationId, isDeleted: false },
      select: ROLE_SELECT,
    })) as RoleRow[];

    return toPublic(created as RoleRow, indexRoles(rows), 0, 0);
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
      select: { id: true, isSystem: true, name: true },
    });
    if (!existing) throw ApiError.notFound('Role not found.');
    // Named from the row, not from SYSTEM_ROLES: the built-in title is identified
    // by `isSystem`, so an org that predates a rename here still gets a message
    // that matches what it sees on screen.
    if (existing.isSystem) {
      throw new ApiError(403, `The built-in "${existing.name}" role cannot be edited.`);
    }

    const data: {
      updatedBy: string;
      name?: string;
      description?: string | null;
      parentRoleId?: string | null;
    } = { updatedBy: userId };

    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    if (input.parentRoleId !== undefined) {
      // null promotes the role to a root of the chart — always legal.
      if (input.parentRoleId !== null) {
        await assertValidParent(tx, organizationId, id, input.parentRoleId);
      }
      data.parentRoleId = input.parentRoleId;
    }

    // Scoped to the org so an id from another tenant is a no-op (RLS also guards).
    await withUniqueViolation('A role with this name already exists.', () =>
      tx.role.updateMany({ where: { id, organizationId }, data }),
    );

    const rows = (await tx.role.findMany({
      where: { organizationId, isDeleted: false },
      select: ROLE_SELECT,
    })) as RoleRow[];
    const row = rows.find((r) => r.id === id) as RoleRow;
    const counts = await memberCounts(tx, organizationId, [id]);

    return toPublic(row, indexRoles(rows), counts.get(id) ?? 0, childCounts(rows).get(id) ?? 0);
  });
}

/**
 * Soft-delete a role. Refused for the built-in system role, for a role still held by a
 * member, for one a pending invitation would hand out (the invitation FK is
 * `Restrict`, so that case would fail at the database anyway, with an error nobody
 * could act on), and for one that still has roles reporting to it.
 *
 * The children guard is the new one, and it is deliberate. `parent_role_id` is
 * `ON DELETE RESTRICT`, but this is a SOFT delete — an UPDATE the FK never sees —
 * so without this check the subtree would silently detach and reappear as a set of
 * new roots. Making the admin re-parent first means a reorganisation is always
 * something someone chose.
 */
export function deleteRole(userId: string, organizationId: string, id: string): Promise<void> {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.role.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, isSystem: true, name: true },
    });
    if (!existing) throw ApiError.notFound('Role not found.');
    if (existing.isSystem) {
      throw new ApiError(403, `The built-in "${existing.name}" role cannot be deleted.`);
    }

    const children = await tx.role.count({
      where: { organizationId, parentRoleId: id, isDeleted: false },
    });
    if (children > 0) {
      throw ApiError.conflict(
        `${children} role${children === 1 ? '' : 's'} report${children === 1 ? 's' : ''} to this one. ` +
          'Move them under a different role before deleting it.',
      );
    }

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
