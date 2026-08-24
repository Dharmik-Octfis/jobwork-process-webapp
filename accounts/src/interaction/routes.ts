import { Router, urlencoded, type Request, type Response } from 'express';
import argon2 from 'argon2';
import type Provider from 'oidc-provider';
import { prisma } from '../db/prisma.ts';
import { loginPage, errorPage } from './views.ts';

/**
 * The interaction endpoints — where `/authorize` sends a browser that is not yet
 * signed in. docs/SSO_AND_IDENTITY.md §7.1.
 *
 * 🔴 These MUST be mounted before the provider's catch-all, and the body parser is
 * per-route rather than app-wide: `oidc-provider` parses its own request bodies, so
 * a parser above it leaves the token endpoint with an empty body and every code
 * exchange fails with an error that blames the client.
 */

/** Same predicate as the app's ACTIVE_USER. One definition of "usable account". */
const ACTIVE_USER = { isActive: true, isDeleted: false } as const;

/**
 * 🔴 Answer a bad email and a bad password identically, and spend the same work on
 * both. Reading the user first and verifying against a dummy hash when they do not
 * exist is what stops the response time from telling an attacker which addresses
 * are registered. `login` in the app does the same thing for the same reason.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findFirst({ where: { email, ...ACTIVE_USER } });

  if (!user?.passwordHash) {
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    return null;
  }

  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  return ok ? user : null;
}

export function interactionRouter(provider: Provider): Router {
  const router = Router();
  const form = urlencoded({ extended: false });

  /** The interaction itself: show a login form, or auto-approve consent. */
  router.get('/interaction/:uid', async (req: Request, res: Response) => {
    const details = await provider.interactionDetails(req, res);
    const { prompt, params, uid } = details;

    const clientId = String(params['client_id'] ?? '');
    const client = await prisma.oidcClient.findFirst({
      where: { id: clientId, isActive: true, isDeleted: false },
    });

    if (prompt.name === 'login') {
      res.type('html').send(loginPage({ uid, clientName: client?.name ?? clientId }));
      return;
    }

    if (prompt.name === 'consent') {
      /**
       * 🔴 Auto-approved, deliberately, and ONLY because every client here is
       * first-party — apps we build and operate, registered by hand in
       * `oidc_clients` (§8). A consent screen exists to protect a user from an app
       * the operator does not vouch for; there is no such app in this registry.
       *
       * The moment a third-party client is registered, this branch must become a
       * real screen. That is a decision about the registry, not about this code, so
       * it is written here rather than in a ticket.
       */
      await approveConsent(provider, req, res, details);
      return;
    }

    res
      .status(400)
      .type('html')
      .send(errorPage(`Unsupported interaction: ${prompt.name}`));
  });

  /** The login form's target. */
  router.post('/interaction/:uid/login', form, async (req: Request, res: Response) => {
    const details = await provider.interactionDetails(req, res);
    const clientId = String(details.params['client_id'] ?? '');
    const client = await prisma.oidcClient.findFirst({ where: { id: clientId } });
    const clientName = client?.name ?? clientId;

    const email = String(req.body?.['email'] ?? '').trim();
    const password = String(req.body?.['password'] ?? '');

    const user = await verifyCredentials(email, password);

    if (!user) {
      // Deliberately not "no such account" or "wrong password" — either phrasing
      // turns this form into a way to enumerate who has an account here.
      res
        .status(401)
        .type('html')
        .send(
          loginPage({
            uid: details.uid,
            clientName,
            email,
            error: 'That email and password do not match.',
          }),
        );
      return;
    }

    /**
     * `mergeWithLastSubmission: false` — this is a fresh sign-in, so nothing from a
     * previous attempt at this interaction should survive into the session.
     */
    await provider.interactionFinished(
      req,
      res,
      { login: { accountId: user.id } },
      { mergeWithLastSubmission: false },
    );
  });

  return router;
}

/**
 * Grant every scope the client asked for and finish the interaction.
 *
 * A Grant is what the library records as "this account has allowed this client
 * these scopes"; without one it keeps returning the consent prompt forever.
 */
async function approveConsent(
  provider: Provider,
  req: Request,
  res: Response,
  details: Awaited<ReturnType<Provider['interactionDetails']>>,
): Promise<void> {
  const { grantId, params, session, prompt } = details;
  const accountId = session?.accountId;
  const clientId = String(params['client_id'] ?? '');

  if (!accountId) {
    res.status(400).type('html').send(errorPage('Sign-in expired. Please start again.'));
    return;
  }

  // Reuse the existing grant when the user has been here before, so re-approving
  // widens the same record instead of leaving a trail of one-scope grants.
  const grant = grantId
    ? await provider.Grant.find(grantId)
    : new provider.Grant({ accountId, clientId });

  if (!grant) {
    res.status(400).type('html').send(errorPage('Sign-in expired. Please start again.'));
    return;
  }

  const missing = prompt.details['missingOIDCScope'];
  if (Array.isArray(missing)) grant.addOIDCScope(missing.join(' '));

  await provider.interactionFinished(
    req,
    res,
    { consent: { grantId: await grant.save() } },
    { mergeWithLastSubmission: true },
  );
}
