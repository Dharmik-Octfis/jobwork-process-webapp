import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/jwt.ts';

/**
 * Like `authenticate`, but never rejects: if a valid `Authorization: Bearer`
 * token is present, `req.user` is populated; otherwise the request proceeds
 * anonymously.
 *
 * Used by the invitation-accept route, which serves two callers on the same
 * endpoint — a logged-in user joining an org, and an anonymous new user
 * creating an account from the invite. The handler branches on `req.user`.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, sid: payload.sid };
    } catch {
      // Expired/invalid token → treat as anonymous, don't fail the request.
    }
  }

  next();
}
