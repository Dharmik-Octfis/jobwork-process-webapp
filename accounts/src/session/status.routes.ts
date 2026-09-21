import { Router, type Request, type Response } from 'express';
import type Provider from 'oidc-provider';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { ACTIVE_USER } from '../lib/activeUser.ts';

/**
 * `GET /session/status` → `{ "signedIn": boolean }`.
 * docs/SSO_WEBSITE_ENTRY_PLAN.md §4.1–§4.2.
 *
 * Asked by the product website (`https://www.octfis.com/job-work-1`) to choose between
 * "Sign In" and "Access Jobwork". Both labels link to the same sign-in URL, so this
 * answer is cosmetic: a wrong `false` costs nothing, and every failure here — a 500,
 * a blocked request — lands the website on "Sign In", which still works.
 *
 * 🔴 A boolean and NOTHING else. No email, no name, no list of apps. This is
 * unauthenticated surface reachable from a public page; "signed in as …" would turn
 * it into identity disclosure and needs its own decision.
 */

/**
 * The library's own session lookup, not a hand-rolled one: `Session.get` reads the
 * `_session` cookie with the same signed-cookie keys and rotation the provider uses,
 * and `find` enforces expiry on read (adapter.ts). Nothing here re-implements cookie
 * verification, so nothing here can drift from it.
 *
 * Then `sso_sessions`, for what the library's row does not say: that the session was
 * not revoked by us (password reset, and any future admin revocation that stamps the
 * row) and that the account behind it is still usable. A disabled account's session
 * survives in `oidc_payloads`, but `findAccount` refuses it, so clicking through would
 * show the sign-in form — the label must not promise otherwise.
 *
 * The mirror is best-effort (sessionMirror.ts), so a missing row answers `false` —
 * the harmless direction.
 */
export async function hasLiveSession(
  provider: Provider,
  req: Request,
  res: Response,
): Promise<boolean> {
  const session = await provider.Session.get(provider.createContext(req, res));
  if (!session.accountId) return false;

  const live = await prisma.ssoSession.findFirst({
    where: {
      id: session.uid,
      userId: session.accountId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: ACTIVE_USER,
    },
    select: { id: true },
  });
  return live !== null;
}

/**
 * 🔴 The first and only CORS exception in this service — see the note in app.ts.
 *
 * - The origin is matched EXACTLY against `SESSION_STATUS_ORIGINS` and echoed back
 *   only on a match. Never `*` (a wildcard cannot carry credentials anyway), never a
 *   reflected unchecked `Origin`, which would hand the answer to any page on the web.
 * - `Allow-Credentials` on this route only. It is what makes the browser send the
 *   `_session` cookie, and the cookie IS the answer.
 * - `Vary: Origin` + `no-store`, so no cache ever serves one visitor's answer — or
 *   one origin's CORS headers — to another.
 * - GET with no custom headers is a "simple" request, so there is no preflight and no
 *   OPTIONS handler to get wrong.
 *
 * A disallowed origin still gets a response, just without the CORS headers; the
 * browser then refuses to let that page read it.
 *
 * `_session` stays `SameSite=Lax` (provider.ts). `www.octfis.com` and
 * `accounts.octfis.com` are the same SITE, so a credentialed fetch between them
 * already carries a Lax cookie — relaxing it to `None` would weaken every session in
 * the estate and still not get past Safari's third-party blocking. §2 of the plan.
 */
export function sessionStatusRouter(provider: Provider): Router {
  const router = Router();

  router.get('/session/status', async (req, res) => {
    const origin = req.get('origin');
    if (origin && env.sessionStatusOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    res.vary('Origin');
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');

    res.json({ signedIn: await hasLiveSession(provider, req, res) });
  });

  return router;
}
