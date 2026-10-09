import { Router, urlencoded, type Request, type Response } from 'express';
import argon2 from 'argon2';
import type Provider from 'oidc-provider';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { ACTIVE_USER } from '../lib/activeUser.ts';
import * as service from '../login/account.service.ts';
import { firstError, signupSchema, verifySchema } from '../login/account.routes.ts';
import { signupPage, verifyEmailPage } from '../login/account.views.ts';
import { bindingOf, bindThisBrowser, clearBinding } from '../login/binding.ts';
import { PORTAL_CLIENT_ID, PORTAL_NAME } from '../oidc/portal.ts';
import { canSignIn, INVITEE_MISMATCH, STAY_RESULT, vouchedHint } from './invitee.ts';
import { loginPage, errorPage, mismatchPage, modeQuery, type HintMode } from './views.ts';

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
      const hint = await hintOf(provider, details);
      const mode = modeOf(req, hint);
      const name = await clientName(clientId);

      if (hint && mode === 'locked') {
        // Signed in as someone else: ask before anything, unless they already chose Switch.
        if (prompt.reasons.includes(INVITEE_MISMATCH) && req.query['invitee'] !== '1') {
          const signedInAs = await emailOf(details.session?.accountId);
          if (signedInAs) {
            res.type('html').send(mismatchPage({ uid, signedInAs, invitedEmail: hint }));
            return;
          }
        }

        if (!(await canSignIn(hint))) {
          res
            .type('html')
            .send(signupPage({ email: hint, ...interactionLinks(uid, 'signup', mode) }));
          return;
        }

        res.type('html').send(loginPage({ uid, clientName: name, email: hint, mode }));
        return;
      }

      /**
       * Not vouched: `login_hint` only prefills an editable field, as it always has —
       * it decides nothing, because anyone can put one in a URL. After "Not you?" the
       * field starts empty: the invited address is the one they just said is not theirs.
       */
      const loginHint =
        mode === 'open' && typeof params['login_hint'] === 'string'
          ? params['login_hint']
          : undefined;

      res.type('html').send(loginPage({ uid, clientName: name, email: loginHint, mode }));
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
    const hint = await hintOf(provider, details);
    const mode = modeOf(req, hint);

    // Locked: the vouched address, whatever the form says — the read-only field is display.
    const email = mode === 'locked' ? hint! : String(req.body?.['email'] ?? '').trim();
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
            mode,
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
          action: `/interaction/${encodeURIComponent(details.uid)}/verify${modeQuery(mode)}`,
          notice: `Confirm your email to continue. We sent a 6-digit code to ${user.email}.`,
          restartHref: `/interaction/${encodeURIComponent(details.uid)}${modeQuery(mode)}`,
          emailLocked: mode === 'locked',
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
   * never from the URL. When the app vouched for it, it is also the only address this
   * signup can register (invitee.ts).
   */
  router.get('/interaction/:uid/signup', async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const hint = await hintOf(provider, details);
    const mode = modeOf(req, hint);

    if (hint && mode === 'locked' && (await canSignIn(hint))) {
      // The address already has an account: signing up again would replace its
      // password. Send them to the locked Sign In instead.
      res.redirect(`/interaction/${encodeURIComponent(details.uid)}?invitee=1`);
      return;
    }

    const raw = details.params['login_hint'];
    const email = mode === 'switched' ? undefined : typeof raw === 'string' ? raw : undefined;
    res.type('html').send(signupPage({ email, ...interactionLinks(details.uid, 'signup', mode) }));
  });

  router.post('/interaction/:uid/signup', form, async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const hint = await hintOf(provider, details);
    const mode = modeOf(req, hint);

    // 🔴 Locked: register the vouched address, whatever was posted. `readonly` is only
    // what the form shows; this is the lock.
    const body = mode === 'locked' ? { ...req.body, email: hint } : req.body;

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(
          signupPage({
            email: typeof body?.['email'] === 'string' ? body['email'] : undefined,
            error: firstError(parsed.error),
            ...interactionLinks(details.uid, 'signup', mode),
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
        ...interactionLinks(details.uid, 'verify', mode),
      }),
    );
  });

  /** The code form's target, for both a new signup and an unverified sign-in. */
  router.post('/interaction/:uid/verify', form, async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details) return expired(res);

    const hint = await hintOf(provider, details);
    const mode = modeOf(req, hint);
    const body = mode === 'locked' ? { ...req.body, email: hint } : req.body;

    const parsed = verifySchema.safeParse(body);
    const accountId = parsed.success
      ? await service.verifyEmail(parsed.data.email, parsed.data.otp, bindingOf(req))
      : null;

    if (!accountId) {
      res
        .status(400)
        .type('html')
        .send(
          verifyEmailPage({
            email: typeof body?.['email'] === 'string' ? body['email'] : undefined,
            error: parsed.success ? 'That code is invalid or expired.' : firstError(parsed.error),
            ...interactionLinks(details.uid, 'verify', mode),
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

  /**
   * "Stay signed in as X" on the mismatch screen. Finishes WITHOUT a login result —
   * X is already signed in, and a login result would restamp their authentication
   * time as if they had just typed a password. The marker tells the mismatch check
   * the question was answered, so the resumed request does not ask it again.
   */
  router.post('/interaction/:uid/continue', async (req: Request, res: Response) => {
    const details = await detailsOrNull(provider, req, res);
    if (!details?.session?.accountId) return expired(res);

    await provider.interactionFinished(
      req,
      res,
      { [STAY_RESULT]: true },
      { mergeWithLastSubmission: false },
    );
  });

  return router;
}

/** The vouched address for this interaction's client, or undefined — invitee.ts. */
async function hintOf(
  provider: Provider,
  details: Awaited<ReturnType<Provider['interactionDetails']>>,
): Promise<string | undefined> {
  const client = await provider.Client.find(String(details.params['client_id'] ?? ''));
  return vouchedHint(client, details.params['login_hint']);
}

/** `?switch=1` means "Not you?" was chosen; it means nothing without a vouched address. */
function modeOf(req: Request, hint: string | undefined): HintMode {
  if (!hint) return 'open';
  return req.query['switch'] === '1' ? 'switched' : 'locked';
}

async function emailOf(accountId: string | undefined): Promise<string | undefined> {
  if (!accountId) return undefined;
  const user = await prisma.user.findUnique({ where: { id: accountId }, select: { email: true } });
  return user?.email;
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

/**
 * An expired interaction no longer says which app started it, so the way back is
 * the product site, where every app's Sign In button lives — not a dead end.
 */
function expired(res: Response): void {
  res
    .status(400)
    .type('html')
    .send(
      errorPage('This sign-in has expired. Start again from the app you were signing in to.', {
        href: env.productSiteUrl,
        label: 'Go to your Octfis apps',
      }),
    );
}

/**
 * Form target and links that keep a signup inside interaction `uid`, carrying the
 * mode along: `?switch=1` while switched, the read-only address while locked.
 */
function interactionLinks(uid: string, form: 'signup' | 'verify', mode: HintMode = 'open') {
  const base = `/interaction/${encodeURIComponent(uid)}`;
  const query = modeQuery(mode);
  const locked = mode === 'locked';
  return {
    action: `${base}/${form}${query}`,
    signInHref: `${base}${query}`,
    restartHref: `${base}${locked ? '' : '/signup'}${query}`,
    emailLocked: locked,
    ...(locked ? { notYouHref: `${base}?switch=1` } : {}),
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

  if (!accountId) return expired(res);

  // Reuse the existing grant when the user has been here before, so re-approving
  // widens the same record instead of leaving a trail of one-scope grants.
  const grant = grantId
    ? await provider.Grant.find(grantId)
    : new provider.Grant({ accountId, clientId });

  if (!grant) return expired(res);

  const missing = prompt.details['missingOIDCScope'];
  if (Array.isArray(missing)) grant.addOIDCScope(missing.join(' '));

  await provider.interactionFinished(
    req,
    res,
    { consent: { grantId: await grant.save() } },
    { mergeWithLastSubmission: true },
  );
}
