import type { NextFunction, Request, Response } from 'express';
import { prisma, runAsTenant } from '../db/prisma.ts';
import { ApiError } from '../lib/apiError.ts';
import {
  ALL_PERMISSIONS,
  permissionsForRole,
} from '../modules/settings/organization/permission-templates/permissions.catalog.ts';

/**
 * Resolve which organization this request acts inside, and prove the caller
 * belongs to it.
 *
 * The organization id comes from the route — `/organizations/:orgId/...` — which
 * is the convention the whole API follows (organizations, invitations, and
 * everything nested under them). It is a value the *client* chose, so it is a
 * claim, not a credential: anyone can type a different id into the URL bar. It
 * means nothing until checked against `memberships`, and doing that check is
 * this middleware's entire job.
 *
 * Route param vs header is a REST/ergonomics choice, not a security one. The
 * middleware this replaced took the id from an `x-organization-id` header and
 * only asserted it was non-empty — never that the caller was a member — which
 * let any authenticated user read and write any organization's data. A route
 * param with no membership check would be exactly as broken; the attacker edits
 * the URL instead of localStorage. See vendors.tenant-isolation.test.ts.
 *
 * Requirements at the mount site:
 *  - must run after `authenticate` — it needs `req.user`
 *  - the router must be created with `Router({ mergeParams: true })`, or
 *    `req.params.orgId` is undefined in a nested router and every request 400s
 */
export async function tenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // Express 5 types a route param as `string | string[]` — a repeated pattern
  // like `/:id+` yields an array. Narrow rather than cast: `as string` would
  // compile and then hand an array to Postgres at runtime.
  const raw = req.params['orgId'];
  const organizationId = typeof raw === 'string' ? raw.trim() : undefined;

  if (!organizationId) {
    next(ApiError.badRequest('No organization specified in the URL.'));
    return;
  }

  if (!req.user) {
    // A programming error: this middleware was mounted without `authenticate`.
    next(new ApiError(401, 'Sign in to continue.'));
    return;
  }

  // A malformed id must not reach Postgres as a uuid comparison — that throws a
  // driver error and surfaces as a 500. Reject it as what it is: not yours.
  if (!UUID_PATTERN.test(organizationId)) {
    next(NO_ACCESS);
    return;
  }

  // The `organization.isDeleted` filter makes a soft-deleted org behave exactly
  // like one you're not a member of — it can't be read or written through any
  // tenant route once deleted, even though the membership row still exists.
  // `isDeleted: false` on the membership is load-bearing: removing a member is a
  // SOFT delete, so without it a removed person still resolves a tenant and keeps
  // every permission their old role granted — invisible in the members list, but
  // fully able to read and write. The `organization.isDeleted` filter does the
  // same job for a deleted org.
  const membership = await prisma.membership.findFirst({
    where: {
      userId: req.user.id,
      organizationId,
      isDeleted: false,
      organization: { isDeleted: false },
    },
    select: { role: true, permissionTemplateId: true },
  });

  if (!membership) {
    // Deliberately the same error whether the organization does not exist, is
    // soft-deleted, or the caller simply is not in it. Distinguishing them would
    // let someone enumerate which organization ids are real.
    next(NO_ACCESS);
    return;
  }

  // Resolve the caller's permission set (what they may DO). This is separate from
  // tenant isolation (whose data they can touch) — routes still runAsTenant. The
  // permission template lives in an RLS-protected table, so it must be read
  // inside a tenant context; membership above is on the un-gated control plane.
  let permissions: Set<string>;
  try {
    permissions = await resolvePermissions(organizationId, membership);
  } catch (error) {
    next(error);
    return;
  }

  req.tenantId = organizationId;
  req.membership = {
    role: membership.role,
    permissionTemplateId: membership.permissionTemplateId,
    permissions,
  };
  next();
}

/**
 * Turn a membership into the set of permission keys it grants.
 *  - Owner template (isOwner) → every permission in the catalog, computed, so a
 *    newly-shipped permission needs no backfill.
 *  - Any other template → exactly its stored keys.
 *  - No template (legacy row, pre-dating this module) → fall back to the old
 *    `role` string mapped onto the equivalent seeded set, so access keeps working
 *    even before the data backfill runs.
 */
async function resolvePermissions(
  organizationId: string,
  membership: { role: string; permissionTemplateId: string | null },
): Promise<Set<string>> {
  if (!membership.permissionTemplateId) {
    return new Set(permissionsForRole(membership.role));
  }

  const template = await runAsTenant(organizationId, (tx) =>
    tx.permissionTemplate.findFirst({
      where: { id: membership.permissionTemplateId!, organizationId, isDeleted: false },
      select: { isOwner: true, permissions: true },
    }),
  );

  // Template missing/archived out from under the membership → fall back to role
  // rather than silently granting nothing.
  if (!template) return new Set(permissionsForRole(membership.role));
  if (template.isOwner) return new Set(ALL_PERMISSIONS);
  return new Set(template.permissions);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_ACCESS = new ApiError(403, 'You do not have access to this organization.');
