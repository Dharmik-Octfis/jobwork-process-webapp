import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.ts';

const ACCESS_TOKEN_MAX_AGE = 1 * 60 * 1000;

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
};

export function setAccessTokenAsCookie(res: Response, accessToken: string): void {
  res.cookie('accessToken', accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
}

export function clearTokenCookies(res: Response): void {
  res.clearCookie('accessToken', baseCookieOptions);
}
