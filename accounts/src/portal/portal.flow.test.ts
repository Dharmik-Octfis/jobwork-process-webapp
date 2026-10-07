import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import express from 'express';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadFirstPartyGrant } from '../oidc/firstPartyGrant.ts';
import { portalClient } from '../oidc/portal.ts';

/**
 * Typing accounts.octfis.com: signed out → the login form; signed in → the account
 * page. Through a REAL oidc-provider, because the portal only works if the library
 * accepts it as a client and finishing its login sets the session the page reads.
 */

const ISSUER = 'http://localhost';
const EMAIL = 'riya@example.com';
const PASSWORD = 'correct horse battery';

vi.mock('../config/env.ts', () => ({
  env: {
    isProduction: false,
    oidcIssuer: 'http://localhost',
    productSiteUrl: 'https://www.octfis.example',
  },
}));
vi.mock('../lib/mailer.ts', () => ({ sendOtpEmail: vi.fn() }));

const user = vi.hoisted(() => ({
  id: 'user-riya',
  email: 'riya@example.com',
  firstName: 'Riya',
  lastName: 'Shah',
  emailVerified: true,
  passwordHash: '',
}));
vi.mock('../db/prisma.ts', () => ({
  prisma: {
    oidcClient: { findFirst: async () => null },
    // verifyCredentials reads the user; the account page reads it through its session row.
    user: { findFirst: async () => user },
    ssoSession: { findFirst: async () => ({ user }) },
  },
}));

const { interactionRouter } = await import('../interaction/routes.ts');
const { portalRouter } = await import('./portal.routes.ts');

let server: Server;
let base: string;

beforeAll(async () => {
  user.passwordHash = await argon2.hash(PASSWORD);

  const provider = new Provider(ISSUER, {
    clients: [portalClient(ISSUER)],
    cookies: {
      keys: ['test-cookie-secret-that-is-at-least-32-chars'],
      long: { signed: true, httpOnly: true, sameSite: 'lax', path: '/' },
      // No `path` — must match provider.ts, see the two-tabs test below.
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
  app.use(portalRouter(provider));
  app.use(provider.callback());

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

/**
 * A cookie jar that honours `Path` the way a browser does — the most specific path is
 * sent first — because the interaction cookie is only correct if it is path-scoped.
 */
function browser() {
  const jar = new Map<string, { name: string; value: string; path: string }>();

  async function request(
    path: string,
    init: { method?: string; form?: Record<string, string> } = {},
  ) {
    const pathname = new URL(path, base).pathname;
    const sent = [...jar.values()]
      .filter((c) => pathname === c.path || pathname.startsWith(c.path.replace(/\/?$/, '/')))
      .sort((a, b) => b.path.length - a.path.length);
    const res = await fetch(new URL(path, base), {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: sent.map((c) => `${c.name}=${c.value}`).join('; '),
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1);
      const cookiePath =
        attrs
          .map((a) => a.trim())
          .find((a) => /^path=/i.test(a))
          ?.slice(5) ?? '/';
      const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a));
      if (expired) jar.delete(`${name};${cookiePath}`);
      else jar.set(`${name};${cookiePath}`, { name, value, path: cookiePath });
    }
    return res;
  }

  /** Follow redirects (the issuer host counts as this server) until a page answers. */
  async function follow(res: Response): Promise<{ res: Response; path: string }> {
    let current = res;
    let path = '';
    for (let hop = 0; hop < 8; hop += 1) {
      const location = current.headers.get('location');
      if (!location) return { res: current, path };
      const next = new URL(location, base);
      path = next.pathname + next.search;
      current = await request(path);
    }
    throw new Error('too many redirects');
  }

  return { request, follow };
}

describe('accounts.octfis.com — the My Account portal', () => {
  it('signed out: / opens the login form, for "Octfis Accounts"', async () => {
    const b = browser();

    const { res, path } = await b.follow(await b.request('/'));

    expect(path).toMatch(/^\/interaction\//);
    const html = await res.text();
    expect(html).toContain('to continue to Octfis Accounts');
    expect(html).toContain('Create Account');
  });

  it('signing in on that form lands on the account page', async () => {
    const b = browser();
    const { path: interaction } = await b.follow(await b.request('/'));

    const signedIn = await b.request(`${interaction}/login`, {
      method: 'POST',
      form: { email: EMAIL, password: PASSWORD },
    });
    const { res, path } = await b.follow(signedIn);

    expect(path).toBe('/account');
    const html = await res.text();
    expect(html).toContain('Riya Shah');
    expect(html).toContain(`Signed in as ${EMAIL}`);
    expect(html).toContain('/session/end?client_id=accounts-portal');
  });

  it('signed in: / goes straight to the account page, no form', async () => {
    const b = browser();
    const { path: interaction } = await b.follow(await b.request('/'));
    await b.follow(
      await b.request(`${interaction}/login`, {
        method: 'POST',
        form: { email: EMAIL, password: PASSWORD },
      }),
    );

    const again = await b.request('/');

    expect(again.headers.get('location')).toBe('/account');
  });

  /**
   * 🔴 Two sign-ins open in one browser — two tabs, or an app starting its own
   * sign-in while the portal's form is on screen. With `path: '/'` on the short
   * cookies there was ONE `_interaction` cookie, so each form finished whichever
   * sign-in started last: the portal's form landed on jobwork's callback with a
   * code for a flow jobwork no longer held (500), and the other tab's form said
   * "This sign-in has expired".
   */
  it('two sign-ins in one browser: each form finishes its own', async () => {
    const b = browser();
    const { path: first } = await b.follow(await b.request('/'));
    const { path: second } = await b.follow(await b.request('/'));
    expect(first).not.toBe(second);

    const firstUid = first.split('/').pop();
    const submitFirst = await b.request(`${first}/login`, {
      method: 'POST',
      form: { email: EMAIL, password: PASSWORD },
    });
    expect(submitFirst.headers.get('location')).toMatch(new RegExp(`/auth/${firstUid}$`));
    expect((await b.follow(submitFirst)).path).toBe('/account');

    const submitSecond = await b.request(`${second}/login`, {
      method: 'POST',
      form: { email: EMAIL, password: PASSWORD },
    });
    expect(submitSecond.status).toBe(303);
    expect((await b.follow(submitSecond)).path).toBe('/account');
  });

  it('the account page without a session sends you back to /', async () => {
    const b = browser();

    const res = await b.request('/account');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });
});
