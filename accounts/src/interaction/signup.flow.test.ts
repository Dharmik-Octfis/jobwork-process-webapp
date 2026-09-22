import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import express from 'express';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFirstPartyGrant } from '../oidc/firstPartyGrant.ts';

/**
 * The invitee journey, end to end through a REAL oidc-provider: an app sends someone
 * with no account to sign in; they create one inside that sign-in, confirm the code,
 * and must land back at the APP'S CALLBACK WITH A CODE — signed in, not stranded on
 * "You can sign in now", which is where this flow used to end.
 *
 * The account service is a stand-in (its own rules are pinned in
 * account.service.test.ts); what is under test is that the interaction survives
 * signup and that a confirmed code finishes it.
 */

vi.mock('../config/env.ts', () => ({
  env: { isProduction: false, productSiteUrl: 'https://www.octfis.example' },
}));
vi.mock('../db/prisma.ts', () => ({
  prisma: { oidcClient: { findFirst: async () => ({ name: 'Jobwork' }) }, user: {} },
}));

const signup = vi.fn();
const verifyEmail = vi.fn();
vi.mock('../login/account.service.ts', () => ({
  hashBinding: (v: string) => createHash('sha256').update(v).digest('hex'),
  signup: (...a: unknown[]) => signup(...a),
  verifyEmail: (...a: unknown[]) => verifyEmail(...a),
  startVerification: vi.fn(),
}));

const { interactionRouter } = await import('./routes.ts');

const REDIRECT_URI = 'https://app.example/api/auth/sso/callback';
const INVITEE = 'invitee@example.com';
const NEW_ACCOUNT_ID = 'new-account-id';

let server: Server;
let base: string;

beforeAll(async () => {
  const provider = new Provider('http://localhost', {
    clients: [
      {
        client_id: 'app',
        client_secret: 'secret',
        redirect_uris: [REDIRECT_URI],
        response_types: ['code'],
        grant_types: ['authorization_code'],
      },
    ],
    cookies: {
      keys: ['test-cookie-secret-that-is-at-least-32-chars'],
      long: { signed: true, httpOnly: true, sameSite: 'lax', path: '/' },
      short: { signed: true, httpOnly: true, sameSite: 'lax' },
    },
    findAccount: (_ctx, sub) => ({ accountId: sub, claims: () => ({ sub }) }),
    scopes: ['openid', 'email', 'profile'],
    responseTypes: ['code'],
    pkce: { required: () => true },
    loadExistingGrant: loadFirstPartyGrant,
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
  });

  const app = express();
  app.use(cookieParser());
  app.use(interactionRouter(provider));
  app.use(provider.callback());

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  signup.mockReset();
  verifyEmail.mockReset();
});

/** A browser: one cookie jar, redirects followed by hand so each hop is visible. */
function browser() {
  const jar = new Map<string, string>();

  async function request(
    path: string,
    init: { method?: string; form?: Record<string, string> } = {},
  ) {
    const res = await fetch(new URL(path, base), {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair!.indexOf('=');
      jar.set(pair!.slice(0, i).trim(), pair!.slice(i + 1));
    }
    return res;
  }

  /** Start at the app's /auth with a login_hint, as jobwork does for an invitee. */
  async function startSignIn(): Promise<string> {
    const params = new URLSearchParams({
      client_id: 'app',
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: REDIRECT_URI,
      state: 'state-1',
      login_hint: INVITEE,
      code_challenge: createHash('sha256')
        .update(randomBytes(32).toString('base64url'))
        .digest('base64url'),
      code_challenge_method: 'S256',
    });
    const res = await request(`/auth?${params}`);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^\/interaction\//);
    return location; // /interaction/:uid
  }

  /** Follow redirects until one leaves for the app, and return that URL. */
  async function followToApp(res: Response): Promise<URL> {
    let current = res;
    for (let hop = 0; hop < 6; hop += 1) {
      const location = current.headers.get('location');
      if (!location) throw new Error(`stopped at ${current.status}: ${await current.text()}`);
      const next = new URL(location, base);
      if (next.href.startsWith(REDIRECT_URI)) return next;
      current = await request(next.pathname + next.search);
    }
    throw new Error('too many redirects');
  }

  return { request, startSignIn, followToApp, jar };
}

describe('an invitee with no account, signing up inside the sign-in', () => {
  it('the sign-in page links to signup INSIDE the interaction, not a standalone /signup', async () => {
    const b = browser();
    const interaction = await b.startSignIn();

    const html = await (await b.request(interaction)).text();

    expect(html).toContain(`href="${interaction}/signup"`);
    expect(html).not.toContain('href="/signup');
  });

  it('prefills the signup form with the invited address from login_hint', async () => {
    const b = browser();
    const interaction = await b.startSignIn();

    const html = await (await b.request(`${interaction}/signup`)).text();

    expect(html).toContain(`value="${INVITEE}"`);
    expect(html).toContain(`action="${interaction}/signup"`);
  });

  it('🔴 after the code is confirmed, lands on the APP callback with a code — signed in', async () => {
    const b = browser();
    const interaction = await b.startSignIn();

    const signed = await b.request(`${interaction}/signup`, {
      method: 'POST',
      form: {
        firstName: 'Riya',
        lastName: 'Shah',
        email: INVITEE,
        password: 'correct horse battery',
      },
    });
    expect(signed.status).toBe(200);
    const verifyPage = await signed.text();
    expect(verifyPage).toContain(`action="${interaction}/verify"`);

    // The code is bound to this browser: the stand-in accepts only its binding.
    const [, binding] = signup.mock.calls[0]!;
    expect(b.jar.get('verify_binding')).toBeTruthy();
    verifyEmail.mockImplementation(async (email: string, otp: string, presented?: string) =>
      email === INVITEE && otp === '123456' && presented === binding ? NEW_ACCOUNT_ID : null,
    );

    const verified = await b.request(`${interaction}/verify`, {
      method: 'POST',
      form: { email: INVITEE, otp: '123456' },
    });
    const landed = await b.followToApp(verified);

    expect(landed.searchParams.get('code')).toBeTruthy();
    expect(landed.searchParams.get('state')).toBe('state-1');
    expect(landed.searchParams.get('error')).toBeNull();
  });

  it('a wrong code stays on the code form and does not sign anyone in', async () => {
    const b = browser();
    const interaction = await b.startSignIn();
    verifyEmail.mockResolvedValue(null);

    const res = await b.request(`${interaction}/verify`, {
      method: 'POST',
      form: { email: INVITEE, otp: '000000' },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toContain('That code is invalid or expired.');
  });

  it.each([
    ['the login form', 'GET', '/interaction/does-not-exist'],
    ['the login submit', 'POST', '/interaction/does-not-exist/login'],
    ['the signup form', 'GET', '/interaction/does-not-exist/signup'],
    ['the code submit', 'POST', '/interaction/does-not-exist/verify'],
  ])('an expired sign-in on %s gets a readable page, not a 500', async (_label, method, path) => {
    const b = browser();

    const res = await b.request(path, {
      method,
      ...(method === 'POST' ? { form: { email: INVITEE, password: 'x', otp: '123456' } } : {}),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('This sign-in has expired');
  });
});
