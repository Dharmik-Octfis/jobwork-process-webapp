import { Router } from 'express';
import { env } from '../../../config/env.ts';
import * as ssoController from './sso.controller.ts';

/**
 * SSO routes. §13 step 4.
 *
 * 🔴 Mounted only when `SSO_ENABLED` is true. Not merely disabled — absent, so a
 * deployment that has not been cut over cannot be walked into a half-configured
 * login by guessing a URL. Local password login remains the way in until the flag
 * is set, which is the rollback path step 4 asks for.
 *
 * Both routes are deliberately unauthenticated: they ARE the authentication.
 */
export const ssoRouter = Router();

if (env.sso.enabled) {
  ssoRouter.get('/login', ssoController.startLogin);
  ssoRouter.get('/callback', ssoController.callback);
}
