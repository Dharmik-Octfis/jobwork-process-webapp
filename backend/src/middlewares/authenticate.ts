import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError.ts';
import { verifyAccessToken } from '../lib/jwt.ts';

/**
 * Reject the request unless it carries a valid `Authorization: Bearer <token>`.
 * On success, `req.user` holds the caller's id and session id.
 *
 * 🔴 **This is a signature check only — it never touches the database.** That is
 * a deliberate throughput decision, not an oversight, and it has a cost worth
 * understanding before you rely on this middleware for anything:
 *
 * A signature proves the token was genuine *when it was minted*. It says nothing
 * about now. So for up to `JWT_ACCESS_TTL` (**15m**) after the fact, an access
 * token keeps working even though its owner was deactivated, soft-deleted, or
 * logged out, and even though their session row was revoked. Nothing on the
 * request path asks, so nothing notices.
 *
 * **Revocation happens at the refresh boundary instead.** `auth.service.refresh`
 * is the single enforcement point: it requires the `refresh_tokens` row to still
 * exist, to belong to `sub`, to be unexpired, and the user to satisfy
 * `ACTIVE_USER` — and it revokes every session when that last check fails. A
 * disabled account is therefore locked out within one access-token lifetime.
 * That check is now load-bearing for the whole system; do not weaken it.
 *
 * What is NOT bounded by 15 minutes, because it is checked live on every request:
 *  - organization membership → `tenantContext` (removal takes effect immediately,
 *    on every device)
 *  - permissions            → `requirePermission`
 *  - row visibility         → `runAsTenant` + RLS
 *
 * A previous revision resolved `sid` against `refresh_tokens` here, which closed
 * the 15-minute window at the price of one indexed lookup per request. It was
 * removed on 2026-07-24 for query throughput. If you want the window back
 * without the per-request round trip, cache the lookup on `sid` with a short TTL
 * rather than reinstating it unconditionally — see docs/AUTHENTICATION.md.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

  if (!token) {
    next(new ApiError(401, 'Sign in to continue.'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, sid: payload.sid };
    next();
  } catch {
    // Expired, tampered, or signed with a different secret — all the same to
    // the caller. Distinguishing them tells an attacker which one they hit.
    next(new ApiError(401, 'Your session has expired. Please sign in again.'));
  }
}
