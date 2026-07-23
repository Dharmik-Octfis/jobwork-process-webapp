import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError.ts';

/**
 * Gate a route on one or more permissions (architecture §3.9). Must be mounted
 * AFTER `authenticate` and `tenantContext` — the latter is what resolves the
 * caller's Membership into `req.membership.permissions` (from their permission
 * template; the Owner template resolves to every permission). This middleware
 * only checks that set; it never touches the database, so it is cheap to stack
 * on every route.
 *
 *   router.post('/', requirePermission('vendor:create'), createVendor);
 *
 * Multiple permissions are AND-ed — the caller must hold every one listed. A
 * single permission per route is the common case; pass several only when an
 * action genuinely spans resources.
 *
 * This is authorization (what you may do), a layer ABOVE tenant isolation (whose
 * data you can touch). It does NOT replace `runAsTenant` + `where organizationId`
 * — a member with `vendor:read` still only ever sees their own org's vendors.
 */
export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const granted = req.membership?.permissions;

    // No resolved permission set means tenantContext did not run (a wiring bug)
    // or the caller has no membership — either way, deny. Fail closed.
    if (!granted) {
      next(new ApiError(403, 'You do not have permission to perform this action.'));
      return;
    }

    const missing = required.filter((perm) => !granted.has(perm));
    if (missing.length > 0) {
      next(new ApiError(403, 'You do not have permission to perform this action.'));
      return;
    }

    next();
  };
}
