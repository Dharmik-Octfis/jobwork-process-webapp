import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.ts';
import { hashBinding } from './account.service.ts';

/**
 * The browser half of a verification code's binding — see `bindingHash` on the
 * `VerificationToken` model.
 *
 * 🔴 The raw value lives only here, in an HttpOnly cookie on the browser that asked
 * for the code; the database keeps its hash. So a code can be redeemed only where it
 * was requested: the owner of an inbox cannot be walked into confirming a signup a
 * stranger started (and thereby adopting the stranger's password), and a stranger
 * cannot guess at the owner's code at all.
 *
 * `Path=/` because the standalone `/verify-email` and the interaction's
 * `/interaction/:uid/verify` both need it. 30 minutes covers the code's own 10 plus
 * the wait for the email; a newer request simply overwrites it.
 */
const BINDING_COOKIE = 'verify_binding';
const BINDING_MAX_AGE_MS = 30 * 60 * 1000;

/** Mint a binding for this browser and return the hash to store with the code. */
export function bindThisBrowser(res: Response): string {
  const value = randomBytes(32).toString('base64url');
  res.cookie(BINDING_COOKIE, value, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: BINDING_MAX_AGE_MS,
  });
  return hashBinding(value);
}

/** The hash of this browser's binding, if it has one. */
export function bindingOf(req: Request): string | undefined {
  const value = req.cookies?.[BINDING_COOKIE] as string | undefined;
  return value ? hashBinding(value) : undefined;
}

/** Spent once its code is redeemed. */
export function clearBinding(res: Response): void {
  res.clearCookie(BINDING_COOKIE, { path: '/' });
}
