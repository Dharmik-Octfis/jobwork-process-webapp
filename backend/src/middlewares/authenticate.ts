import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError.ts';
import { verifyAccessToken } from '../lib/jwt.ts';

/**
 * Reject the request unless it carries a valid `Authorization: Bearer <token>`.
 * On success, `req.user` holds the caller's id and session id.
 *
 * The access token is a Bearer credential the client holds in memory — not a
 * cookie — so we read it from the header. `requirePermission()` (architecture
 * §3.9) layers on top of this once permission profiles exist.
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
