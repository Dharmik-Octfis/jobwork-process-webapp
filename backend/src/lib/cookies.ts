import type { CookieOptions, Response } from 'express';
import ms from 'ms';
import { env } from '../config/env.ts';

/**
 * The refresh token is the one long-lived, high-value credential, so it lives
 * in an httpOnly cookie the browser stores and sends for us — JavaScript (and
 * therefore XSS) can never read it. The access token is NOT a cookie: the
 * client keeps it in memory and sends it as `Authorization: Bearer` (see
 * `authenticate`).
 *
 * `path` scopes the cookie to the auth routes only, so it rides along with
 * `POST /api/auth/refresh-token` and `POST /api/auth/logout` but is never
 * attached to ordinary API calls.
 */
const REFRESH_COOKIE_NAME = 'refreshToken';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  path: '/api/auth',
};

export function setRefreshTokenAsCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions,
    maxAge: ms(env.jwt.refreshTtl as ms.StringValue),
  });
}

export function clearTokenCookies(res: Response): void {
  // clearCookie only matches when name AND path/sameSite/secure line up.
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
}
