import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.ts';
import { ApiError } from '../../lib/apiError.ts';
import { getLatencyReport } from './diagnostics.controller.ts';

/**
 * Ops-only latency probe. Mounted at `/api/diagnostics` — **only when
 * `DIAGNOSTICS_TOKEN` is set** (see `routes/index.ts`).
 *
 * WHY A SHARED SECRET AND NOT `authenticate` + `requireOwner`
 * The point of this endpoint is to measure the request path on a deployed
 * instance, which must work before anyone has logged in, on an instance nobody
 * has an account on, and from a shell script. A login would make the common
 * case impossible and would also put the auth round trip inside the thing being
 * measured.
 *
 * It is NOT tenant-scoped and deliberately never touches a tenant table, so
 * `tenantContext` and `requirePermission` have nothing to check — there is no
 * organization in the path and no customer data in the response. What it does
 * expose is infrastructure shape (latency, pool state, Node version), which is
 * exactly why it is off by default.
 */
const router = Router();

/**
 * Compare in constant time. A plain `!==` leaks the token one character at a
 * time to anyone who can measure response timing — the classic way a secret
 * this shape gets brute-forced. Lengths are compared first because
 * `timingSafeEqual` throws on a length mismatch.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireDiagnosticsToken(req: Request, _res: Response, next: NextFunction): void {
  const expected = env.diagnosticsToken;

  // Defence in depth: routes/index.ts already refuses to mount this router
  // without a token, so reaching here with none is a wiring bug. Fail closed.
  if (!expected) {
    next(new ApiError(404, 'Not found.'));
    return;
  }

  const header = req.headers.authorization;
  const provided = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : undefined;

  if (!provided || !tokenMatches(provided, expected)) {
    // 404, not 401: an unauthenticated prober should not learn that a
    // diagnostics endpoint exists on this deployment at all.
    next(new ApiError(404, 'Not found.'));
    return;
  }

  next();
}

router.use(requireDiagnosticsToken);

router.get('/latency', getLatencyReport);

export { router as diagnosticsRouter };
