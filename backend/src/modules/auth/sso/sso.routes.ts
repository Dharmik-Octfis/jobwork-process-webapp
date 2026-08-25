import { Router, urlencoded } from 'express';
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
 * Every route here is deliberately unauthenticated. The first two ARE the
 * authentication; the third proves itself with a signed logout token instead.
 */
export const ssoRouter = Router();

if (env.sso.enabled) {
  ssoRouter.get('/login', ssoController.startLogin);
  ssoRouter.get('/callback', ssoController.callback);
  ssoRouter.get('/signup', ssoController.startSignup);
  ssoRouter.get('/logout', ssoController.startLogout);

  /**
   * 🔴 Server-to-server, from the accounts service — never from a browser. Its own
   * body parser, because the spec posts `application/x-www-form-urlencoded` and this
   * router deliberately has none mounted at its top.
   *
   * Unauthenticated by design: the LOGOUT TOKEN is the credential, and
   * `logoutToken.ts` is where it is proven. Anything that ends sessions on an
   * unauthenticated POST has to earn that with verification, not with a guard.
   */
  ssoRouter.post(
    '/backchannel-logout',
    urlencoded({ extended: false }),
    ssoController.backchannelLogout,
  );
}
