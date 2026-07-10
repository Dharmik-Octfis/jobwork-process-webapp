import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError.ts';
import { verifyAccessToken } from '../lib/jwt.ts';

/**
 * Reject the request unless it carries a valid `Authorization: Bearer <token>`.
 * On success, `req.user` holds the caller's id.
 *
 * `requirePermission()` (architecture §3.9) layers on top of this once
 * permission profiles exist.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(new ApiError(401, 'Sign in to continue.'));
    return;
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    // Expired, tampered, or signed with a different secret — all the same to
    // the caller. Distinguishing them tells an attacker which one they hit.
    next(new ApiError(401, 'Your session has expired. Please sign in again.'));
  }
}
