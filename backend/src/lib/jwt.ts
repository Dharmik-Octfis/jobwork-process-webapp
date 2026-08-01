import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.ts';

/**
 * Short-lived access token (architecture §3.8). The client keeps it in a memory
 * variable — never localStorage, and never a cookie (that is the refresh token).
 *
 * The payload carries identity (`sub`) plus the session it belongs to (`sid`,
 * the `refresh_tokens` row id). `sid` is what lets logout end exactly this
 * device's session without a separate session table or any device metadata:
 * the row is found by primary key straight from the token.
 *
 * Permissions and the active organization (§3.9) are resolved into the token
 * once memberships exist.
 */
export interface AccessTokenPayload {
  /** User id — the JWT `sub` claim. */
  sub: string;
  /** Session id — the `refresh_tokens` row this token was issued alongside. */
  sid: string;
}

/** Refresh tokens carry identity only; the row is found by the token string. */
export interface RefreshTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string, sessionId: string): string {
  const options: SignOptions = {
    expiresIn: env.jwt.accessTtl as SignOptions['expiresIn'],
  };
  return jwt.sign({ sid: sessionId }, env.jwt.accessSecret, { ...options, subject: userId });
}

/** Throws if the token is expired, tampered with, or malformed. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret);

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.sid !== 'string'
  ) {
    throw new jwt.JsonWebTokenError('Token is missing required claims');
  }

  return { sub: decoded.sub, sid: decoded.sid };
}

/**
 * Read the session id from an access token, accepting one that has expired.
 *
 * Logout must still work after the 1-minute access token lapses, and an
 * expired-but-authentically-signed token is proof enough of which session to
 * end. The signature is still verified — only the expiry is ignored — so a
 * caller cannot forge a `sid` for a session that isn't theirs.
 */
export function readSessionId(token: string): string {
  const decoded = jwt.verify(token, env.jwt.accessSecret, { ignoreExpiration: true });

  if (typeof decoded === 'string' || typeof decoded.sid !== 'string') {
    throw new jwt.JsonWebTokenError('Token is missing a session claim');
  }

  return decoded.sid;
}

/**
 * 🔴 `jwtid` is not decoration — it is what makes two tokens distinguishable.
 *
 * The payload is otherwise `{ sub, iat, exp }`, and `iat` has one-SECOND
 * resolution. So without a unique claim, two tokens signed for the same user in
 * the same second are byte-identical — and `refresh_tokens.token` is unique, so
 * the second insert fails the index. That is a real, reproduced failure, not a
 * theoretical one: two devices logging in at the same moment returned 500, and so
 * did two browser tabs refreshing together. `authenticate.test.ts` documented the
 * quirk (it reached for `jwtid` to force a distinct token) instead of the code
 * fixing it. `randomUUID()` is what fixes it.
 *
 * Nothing reads `jti` back — `verifyRefreshToken` ignores it. Its only job is to
 * make the string unique.
 */
export function signRefreshToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: env.jwt.refreshTtl as SignOptions['expiresIn'],
  };
  return jwt.sign({}, env.jwt.refreshSecret, {
    ...options,
    subject: userId,
    jwtid: randomUUID(),
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.jwt.refreshSecret);

  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new jwt.JsonWebTokenError('Token is missing a subject claim');
  }

  return { sub: decoded.sub };
}
