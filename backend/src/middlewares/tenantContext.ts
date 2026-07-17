import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { ApiError } from '../lib/apiError.ts';

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

  const membership = await prisma.membership.findUnique({
    where: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prisma compound-unique key
      userId_organizationId: { userId: req.user.id, organizationId },
    },
    select: { role: true },
  });

  if (!membership) {
    // Deliberately the same error whether the organization does not exist or
    // the caller simply is not in it. Distinguishing the two would let someone
    // enumerate which organization ids are real.
    next(NO_ACCESS);
    return;
  }

  req.tenantId = organizationId;
  req.membership = { role: membership.role };
  next();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_ACCESS = new ApiError(403, 'You do not have access to this organization.');
