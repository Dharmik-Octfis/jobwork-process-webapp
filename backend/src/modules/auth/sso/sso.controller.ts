import type { Request, Response } from 'express';
import * as client from 'openid-client';
import { env } from '../../../config/env.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { clearTokenCookies, setRefreshTokenAsCookie } from '../../../lib/cookies.ts';
import { prisma } from '../../../db/prisma.ts';
import { readSessionId } from '../../../lib/jwt.ts';
import {
  formatPublicUser,
  issueTokens,
  logout as logoutLocalSession,
  logoutByToken as logoutLocalSessionByToken,
} from '../auth.service.ts';
import { verifyLogoutToken } from './logoutToken.ts';
import {
  landingPathFor,
  linkOrCreateLocalUser,
  safeReturnTo,
  ssoConfig,
  type IdTokenClaims,
  type SsoFlowState,
} from './sso.service.ts';

/**
 * The two endpoints of the login redirect. §9.2.
 *
 * Controllers hold no try/catch (CLAUDE.md): Express 5 forwards a rejected promise
 * from an async handler straight to `errorHandler`.
 */

const FLOW_COOKIE = 'sso_flow';

/**
 * 🔴 The flow cookie carries the PKCE verifier, so it is the secret that proves this
 * browser started this sign-in. `SameSite=Lax` because the IdP redirects back with a
 * top-level GET, which Lax allows and Strict would drop — dropping it makes every
 * login fail with "sign-in expired", which reads as the design being broken.
 *
 * Ten minutes: long enough to type a password, short enough that an abandoned tab
 * does not leave a usable verifier lying around.
 */
const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function flowCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/api/auth/sso',
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
  };
}

/** GET /api/auth/sso/login — start the redirect. */
export async function startLogin(req: Request, res: Response): Promise<void> {
  const config = await ssoConfig();

  const codeVerifier = client.randomPKCECodeVerifier();
  const flow: SsoFlowState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
    returnTo: safeReturnTo(req.query['returnTo']),
  };

  res.cookie(FLOW_COOKIE, JSON.stringify(flow), flowCookieOptions());

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: env.sso.redirectUri!,
    /**
     * 🔴 No `offline_access` — §3. Asking for it would make accounts issue us a
     * refresh token we would then have to store and rotate, when the whole point is
     * that jobwork refreshes against its OWN database and never calls accounts
     * again after this exchange.
     */
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });

  res.redirect(authorizationUrl.href);
}

/** GET /api/auth/sso/callback — the only place an IdP token is read. */
export async function callback(req: Request, res: Response): Promise<void> {
  const config = await ssoConfig();

  const raw = req.cookies?.[FLOW_COOKIE] as string | undefined;
  // Clear it immediately and unconditionally: the verifier is single-use, and a
  // failed attempt must not leave one behind for a second try.
  res.clearCookie(FLOW_COOKIE, { ...flowCookieOptions(), maxAge: undefined });

  if (!raw) throw ApiError.badRequest('Sign-in expired. Please try again.');

  let flow: SsoFlowState;
  try {
    flow = JSON.parse(raw) as SsoFlowState;
  } catch {
    throw ApiError.badRequest('Sign-in expired. Please try again.');
  }

  const currentUrl = new URL(env.sso.redirectUri!);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') currentUrl.searchParams.set(key, value);
  }

  /**
   * Exchanges the code AND validates the ID token — signature against JWKS, `iss`,
   * `aud`, `exp`, and both `state` and `nonce` against what we generated. Passing
   * the expectations in is what makes them checked; omitting one silently skips it.
   */
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });

  const idClaims = tokens.claims();
  if (!idClaims?.sub) throw ApiError.badRequest('Sign-in failed. Please try again.');

  const claims: IdTokenClaims = {
    sub: idClaims.sub,
    email: typeof idClaims['email'] === 'string' ? idClaims['email'] : undefined,
    // Absent counts as NOT verified. The email-matching branch in
    // linkOrCreateLocalUser turns on this being true, so defaulting it the other
    // way would let an unverified address claim an existing account.
    emailVerified: idClaims['email_verified'] === true,
    name: typeof idClaims['name'] === 'string' ? idClaims['name'] : undefined,
    picture: typeof idClaims['picture'] === 'string' ? idClaims['picture'] : undefined,
    sid: typeof idClaims['sid'] === 'string' ? idClaims['sid'] : undefined,
  };

  // Refuses here if this identity is not entitled to jobwork — §9.3.
  const user = await linkOrCreateLocalUser(claims);

  /**
   * From this line on it is an ordinary jobwork login. `issueTokens` is the one
   * place a `refresh_tokens` row is created, so the SSO path produces exactly the
   * same session shape as a password login and every downstream flow — refresh,
   * logout, the session report — works unchanged.
   */
  const { accessToken, refreshToken, refreshTokenExpiresAt } = await issueTokens(
    await formatPublicUser(user),
    {
      userAgent: req.get('user-agent') ?? null,
      idpSessionId: claims.sid ?? null,
      idpSubject: claims.sub,
    },
  );

  setRefreshTokenAsCookie(res, refreshToken, refreshTokenExpiresAt);

  /**
   * The access token goes to the SPA in the URL fragment, not the query string: a
   * fragment is never sent to the server, so it stays out of access logs and out of
   * the `Referer` header. The app reads it once on load and keeps it in memory,
   * exactly as it does after a password login.
   */
  const landing = await landingPathFor(user.id, flow.returnTo);
  res.redirect(`${env.appUrl}${landing}#access_token=${encodeURIComponent(accessToken)}`);
}

/**
 * GET /api/auth/sso/logout — §9.1: end the local session, then hand the browser to
 * the IdP to end the SSO session too.
 *
 * 🔴 Without this, "log out" in jobwork is not a logout. The local row goes, the
 * browser bounces back to the login screen, and the SSO cookie at accounts is still
 * live — so the next sign-in completes silently and instantly. To the user it looks
 * like the button did nothing; on a shared machine it means the previous person is
 * one click from being signed back in.
 *
 * The local revoke happens FIRST and unconditionally. If the redirect to accounts
 * fails, or the user closes the tab on the IdP's confirmation page, this app's
 * session must already be gone.
 */
export async function startLogout(req: Request, res: Response): Promise<void> {
  const accessToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length).trim()
    : undefined;
  const refreshToken = req.cookies?.['refreshToken'] as string | undefined;

  try {
    if (accessToken) await logoutLocalSession(readSessionId(accessToken));
    else if (refreshToken) await logoutLocalSessionByToken(refreshToken);
  } catch {
    // A missing or forged token means there is nothing to revoke. Still clear the
    // cookie and still send them to the IdP — the SSO session is the point.
  }

  clearTokenCookies(res);

  const config = await ssoConfig();
  const endSession = config.serverMetadata().end_session_endpoint;

  // An IdP that publishes no end_session_endpoint cannot be logged out of remotely.
  // Local logout has already happened, so degrade to that rather than erroring.
  if (!endSession) {
    res.redirect(`${env.appUrl}/login`);
    return;
  }

  const url = new URL(endSession);
  /**
   * `client_id` rather than `id_token_hint`, because §3 means we never keep the ID
   * token — it is read once at login and discarded. The spec allows this, and the
   * IdP asks the user to confirm instead, which is the correct trade: the
   * alternative is storing a token we have no other use for.
   */
  url.searchParams.set('client_id', env.sso.clientId!);
  if (env.sso.postLogoutRedirectUri) {
    url.searchParams.set('post_logout_redirect_uri', env.sso.postLogoutRedirectUri);
  }

  res.redirect(url.href);
}

/**
 * POST /api/auth/sso/backchannel-logout — §10.2.
 *
 * Called by the accounts service, never by a browser. This is what closes the gap
 * in §10.1: without it, a centrally disabled account or a "log out everywhere"
 * keeps working here for up to seven days, because `refresh` is the only place this
 * app checks anything and it trusts its own row.
 */
export async function backchannelLogout(req: Request, res: Response): Promise<void> {
  const claims = await verifyLogoutToken(req.body?.['logout_token']);

  /**
   * `sid` ends ONE browser's session here; `sub` ends the whole account everywhere.
   * Both filter `revokedAt: null` so an already-ended session is not re-stamped with
   * a later timestamp and a wrong reason — the login report would then misreport why
   * and when it ended.
   */
  const where = claims.sid
    ? { idpSessionId: claims.sid, revokedAt: null }
    : { idpSubject: claims.sub!, revokedAt: null };

  const { count } = await prisma.refreshToken.updateMany({
    where,
    data: { revokedAt: new Date(), revokedReason: 'sso_logout' },
  });

  console.log(
    `sso: back-channel logout revoked ${count} session(s) by ${claims.sid ? 'sid' : 'sub'}`,
  );

  /**
   * 🔴 Deliberately NOT `sendSuccess`. The back-channel logout spec fixes this
   * response shape, and the caller is the accounts service rather than
   * `web/src/api/client.ts`. CLAUDE.md's envelope rule governs endpoints our own
   * frontend reads; wrapping this one would make a conformant IdP treat every
   * successful logout as a malformed response.
   *
   * 200 with an empty body, and no cache.
   */
  res.set('Cache-Control', 'no-store').status(200).json({});
}
