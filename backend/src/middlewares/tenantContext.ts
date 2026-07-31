import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { ApiError } from '../lib/apiError.ts';
import {
  ALL_PERMISSIONS,
  withImpliedRead,
} from '../modules/settings/organization/permission-templates/permissions.catalog.ts';
import { getTemplateBody } from '../modules/settings/organization/permission-templates/permissionTemplates.cache.ts';

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
  //
  // 🔴 `isActive: true` (added 2026-07-30) is what makes deactivating a member in
  // the Users screen MEAN anything. Without it "Inactive" would be a label in a
  // list while the person kept full read/write access — the same fail-open shape
  // as a route with no `requirePermission`. Like the two filters above it is
  // re-read on every request, so deactivation takes effect immediately on every
  // device rather than at the end of the 15-minute access-token window (that
  // bound applies to `User.isActive`, which is checked only at refresh — see
  // CLAUDE.md and authenticate.test.ts).
  const membership = await prisma.membership.findFirst({
    where: {
      userId: req.user.id,
      organizationId,
      isDeleted: false,
      isActive: true,
      organization: { isDeleted: false },
    },
    select: { isOwner: true, permissionTemplateId: true },
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
    isOwner: membership.isOwner,
    permissionTemplateId: membership.permissionTemplateId,
    permissions,
  };
  next();
}

/**
 * Turn a membership into the set of permission keys it grants.
 *
 *  - **Owner → every permission, before a template is even read.** Ownership sits
 *    ABOVE the permission system: an owner cannot be locked out of their own
 *    organization by a template, whether through a mistake, a hostile admin, or a
 *    future code path nobody has written yet. Resolving it here — once — is also
 *    what keeps `requirePermission` a pure set check with no ownership special
 *    case in any of the ~40 routes that use it.
 *  - Template with `grantsAllPermissions` → the whole catalog, computed, so a
 *    newly-shipped permission needs no backfill.
 *  - Any other template → exactly its stored keys, plus implied reads.
 *  - No template, or a template deleted out from under the membership → **empty
 *    set**. Fails closed: a non-owner with no template can do nothing until one is
 *    assigned.
 *
 * The template body comes from `permissionTemplates.cache.ts` rather than
 * straight from Postgres — that read was a full `runAsTenant` (four round trips
 * to RDS, holding a pooled connection) on every request. The *membership* read
 * above is deliberately NOT cached, which is what keeps member removal effective
 * immediately; see the long note in that module for why the split sits there.
 *
 * The resolved `Set` is rebuilt here on every request and never cached: it is a
 * pure function of the membership and the template body, and constructing it
 * from ~40 strings costs microseconds.
 */
async function resolvePermissions(
  organizationId: string,
  membership: { isOwner: boolean; permissionTemplateId: string | null },
): Promise<Set<string>> {
  if (membership.isOwner) return new Set(ALL_PERMISSIONS);

  if (!membership.permissionTemplateId) return new Set();

  const template = await getTemplateBody(organizationId, membership.permissionTemplateId);

  if (!template) return new Set();
  if (template.grantsAllPermissions) return new Set(ALL_PERMISSIONS);
  // Rows written before `read` became implied (or by anything but the editor) get
  // the same treatment as a fresh save — see `withImpliedRead`.
  return new Set(withImpliedRead(template.permissions));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_ACCESS = new ApiError(403, 'You do not have access to this organization.');
