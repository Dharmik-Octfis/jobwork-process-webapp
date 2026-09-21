import { Router } from 'express';
import type Provider from 'oidc-provider';
import { env } from '../config/env.ts';
import { errorPage } from '../interaction/views.ts';
import { accountHomePage } from '../login/account.views.ts';
import { portalSignInUrl, portalSignOutUrl } from '../oidc/portal.ts';
import { liveAccount } from '../session/status.routes.ts';

/**
 * The "My Account" portal: what someone sees when they type accounts.octfis.com.
 * Signed in → their account page. Not signed in → the login form, then the account
 * page. See oidc/portal.ts for why the portal is a client of this service.
 */
export function portalRouter(provider: Provider): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const account = await liveAccount(provider, req, res);
    // 302, not 301: which of the two it is depends on the visitor, every time.
    res.redirect(302, account ? '/account' : portalSignInUrl(env.oidcIssuer));
  });

  /**
   * Where the portal's sign-in lands. The login form has already set this service's
   * session cookie — that is the sign-in — so the code in the query is not redeemed
   * (it expires unused in 60 s). An error means the form did not complete.
   */
  router.get('/account/callback', (req, res) => {
    if (typeof req.query['error'] === 'string') {
      res
        .status(400)
        .type('html')
        .send(errorPage('Sign-in did not complete. Open accounts.octfis.com to try again.'));
      return;
    }
    res.redirect(302, '/account');
  });

  router.get('/account', async (req, res) => {
    const account = await liveAccount(provider, req, res);
    if (!account) {
      res.redirect(302, '/');
      return;
    }
    res.type('html').send(
      accountHomePage({
        name: [account.firstName, account.lastName].filter(Boolean).join(' '),
        email: account.email,
        productSiteUrl: env.productSiteUrl,
        signOutHref: portalSignOutUrl(env.oidcIssuer),
      }),
    );
  });

  return router;
}
