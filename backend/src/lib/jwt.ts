import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.ts';

/**
 * Short-lived access token (architecture §3.8). The client keeps it in memory
 * only — never localStorage.
 *
 * DEFERRED: refresh-token rotation. §3.8 calls for a long-lived refresh token,
 * hashed and rotated in a `refresh_tokens` table. That table doesn't exist yet,
 * so today an expired access token means the user logs in again. Build it
 * alongside the `auth.prisma` domain file.
 *
 * The payload carries identity only. Permissions and the active organization
 * (§3.9) are resolved into the token once memberships exist.
 */
export interface AccessTokenPayload {
  /** User id — the JWT `sub` claim. */
  sub: string;
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: env.jwt.accessTtl as SignOptions['expiresIn'],
  };
  return jwt.sign({}, env.jwt.accessSecret, { ...options, subject: userId });
}

/** Throws if the token is expired, tampered with, or malformed. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret);

  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new jwt.JsonWebTokenError('Token is missing a subject claim');
  }

  return { sub: decoded.sub };
}
