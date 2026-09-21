import { Router, urlencoded, type Request, type Response } from 'express';
import argon2 from 'argon2';
import type Provider from 'oidc-provider';
import { prisma } from '../db/prisma.ts';
import { ACTIVE_USER } from '../lib/activeUser.ts';
import * as service from '../login/account.service.ts';
import { firstError, signupSchema, verifySchema } from '../login/account.routes.ts';
import { signupPage, verifyEmailPage } from '../login/account.views.ts';
import { bindingOf, bindThisBrowser, clearBinding } from '../login/binding.ts';
import { PORTAL_CLIENT_ID, PORTAL_NAME } from '../oidc/portal.ts';
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
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);
    const { prompt, params, uid } = details;

    const clientId = String(params['client_id'] ?? '');

    if (prompt.name === 'login') {
      /**
       * `login_hint` is the standard OIDC way for an app to say "we believe this is
       * who is arriving" — here it is the address an invitation was sent to, passed
       * through from jobwork. It prefills the field and follows the user to signup.
       *
       * A hint, never a credential: the user can change it, and it decides nothing.
       * It is escaped where it is rendered, like everything else on this page.
       */
      const loginHint = typeof params['login_hint'] === 'string' ? params['login_hint'] : undefined;

      res
        .type('html')
        .send(loginPage({ uid, clientName: await clientName(clientId), email: loginHint }));
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
       *
       * ⚠️ Rarely reached now: `loadFirstPartyGrant` (oidc/firstPartyGrant.ts) issues
       * the same grant before the prompt is evaluated, so consent is normally already
       * satisfied. A third-party client has to be stopped in BOTH places.
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
    // A form left open past the 30 minutes is the usual way to get here expired.
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);
    const appName = await clientName(String(details.params['client_id'] ?? ''));

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
            clientName: appName,
            email,
            error: 'That email and password do not match.',
          }),
        );
      return;
    }

    /**
     * Password right, address never confirmed: verify it HERE, then continue — rather
     * than signing them in and letting the app refuse an unverified email with no
     * explanation. Reached only after the password matched, so it reveals nothing
     * about which addresses exist.
     */
    if (!user.emailVerified) {
      await service.startVerification(user.email, bindThisBrowser(res));
      res.type('html').send(
        verifyEmailPage({
          email: user.email,
          action: `/interaction/${encodeURIComponent(details.uid)}/verify`,
          notice: `Confirm your email to continue. We sent a 6-digit code to ${user.email}.`,
          restartHref: `/interaction/${encodeURIComponent(details.uid)}`,
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

  /**
   * 🔴 Signup INSIDE the interaction — the fix for an invitee stranded on "You can
   * sign in now". Under `/interaction/:uid/` the `_interaction` cookie rides along, so
   * `interactionDetails` proves this is the same browser and sign-in; a confirmed code
   * then finishes it and the browser carries on to the app that sent them, signed in,
   * without typing the password a second time.
   *
   * The address comes from the interaction's `login_hint` — an invitation's address —
   * never from the URL.
   */
  router.get('/interaction/:uid/signup', async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const hint = details.params['login_hint'];
    res.type('html').send(
      signupPage({
        email: typeof hint === 'string' ? hint : undefined,
        ...interactionLinks(details.uid, 'signup'),
      }),
    );
  });

  router.post('/interaction/:uid/signup', form, async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(
          signupPage({
            email: typeof req.body?.['email'] === 'string' ? req.body['email'] : undefined,
            error: firstError(parsed.error),
            ...interactionLinks(details.uid, 'signup'),
          }),
        );
      return;
    }

    await service.signup(parsed.data, bindThisBrowser(res));

    // Same answer for a new and an existing address — see the service.
    res.type('html').send(
      verifyEmailPage({
        email: parsed.data.email,
        notice: `If ${parsed.data.email} can receive mail, a 6-digit code is on its way.`,
        ...interactionLinks(details.uid, 'verify'),
      }),
    );
  });

  /** The code form's target, for both a new signup and an unverified sign-in. */
  router.post('/interaction/:uid/verify', form, async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const parsed = verifySchema.safeParse(req.body);
    const accountId = parsed.success
      ? await service.verifyEmail(parsed.data.email, parsed.data.otp, bindingOf(req))
      : null;

    if (!accountId) {
      res
        .status(400)
        .type('html')
        .send(
          verifyEmailPage({
            email: typeof req.body?.['email'] === 'string' ? req.body['email'] : undefined,
            error: parsed.success ? 'That code is invalid or expired.' : firstError(parsed.error),
            ...interactionLinks(details.uid, 'verify'),
          }),
        );
      return;
    }

    clearBinding(res);

    // The code proved the inbox and applied the password chosen with it: sign in.
    await provider.interactionFinished(
      req,
      res,
      { login: { accountId } },
      { mergeWithLastSubmission: false },
    );
  });

  return router;
}

/**
 * The app name shown as "to continue to …". The portal is this service's own client
 * and has no registry row (oidc/portal.ts), so it is answered here.
 */
async function clientName(clientId: string): Promise<string> {
  if (clientId === PORTAL_CLIENT_ID) return PORTAL_NAME;
  const client = await prisma.oidcClient.findFirst({
    where: { id: clientId, isActive: true, isDeleted: false },
  });
  return client?.name ?? clientId;
}

/**
 * The interaction behind this request, or null once it has expired or this browser
 * does not hold its cookie. `interactionDetails` throws in both cases, which would
 * surface as a bare 500 to someone who only waited too long for their email.
 */
async function detailsOrNull(provider: Provider, req: Request, res: Response) {
  try {
    return await provider.interactionDetails(req, res);
  } catch {
    return null;
  }
}

function expired(res: Response): void {
  res
    .status(400)
    .type('html')
    .send(errorPage('This sign-in has expired. Go back to the app and sign in again.'));
}

/** Form target and links that keep a signup inside interaction `uid`. */
function interactionLinks(uid: string, form: 'signup' | 'verify') {
  const base = `/interaction/${encodeURIComponent(uid)}`;
  return {
    action: `${base}/${form}`,
    signInHref: base,
    restartHref: `${base}/signup`,
  };
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
