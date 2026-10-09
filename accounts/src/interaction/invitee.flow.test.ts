import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import express from 'express';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFirstPartyGrant } from '../oidc/firstPartyGrant.ts';

/**
 * The invitation sign-in — docs/SSO_INVITE_SIGNUP_PLAN.md — through a REAL
 * oidc-provider with PAR. What is pinned:
 *
 *   - a client that requires PAR cannot be driven with a typed `/auth?login_hint=`;
 *   - a vouched address picks the screen: Create Account (no account) or Sign In,
 *     both with the address read-only, and the server ignores a different posted one;
 *   - a hint from a client that does NOT require PAR changes nothing (no enumeration);
 *   - signed in as X with an invitation for Y → the mismatch screen, and both of its
 *     answers end back at the app with a code.
 */

vi.mock('../config/env.ts', () => ({
  env: { isProduction: false, productSiteUrl: 'https://www.octfis.example' },
}));

interface Row {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerified: boolean;
  isActive: boolean;
  isDeleted: boolean;
}
const users: Row[] = [];
const byEmail = (email: unknown) =>
  users.find((u) => typeof email === 'string' && u.email === email.toLowerCase());

vi.mock('../db/prisma.ts', () => ({
  prisma: {
    oidcClient: { findFirst: async () => ({ name: 'Jobwork' }) },
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        (where.id ? users.find((u) => u.id === where.id) : byEmail(where.email)) ?? null,
      findFirst: async ({ where }: { where: { email: string } }) => {
        const u = byEmail(where.email);
        return u && u.isActive && !u.isDeleted ? u : null;
      },
    },
  },
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
const { interactionPolicyWithInvitee } = await import('./invitee.ts');

const REDIRECT_URI = 'https://app.example/api/auth/sso/callback';
const PAR_CLIENT = { id: 'par-app', secret: 'par-secret' };
const PLAIN_CLIENT = { id: 'plain-app', secret: 'plain-secret' };

const EXISTING = 'existing@example.com';
const OTHER = 'other@example.com';
const NEWCOMER = 'newcomer@example.com';
const PASSWORD = 'correct horse battery';

let server: Server;
let base: string;

beforeAll(async () => {
  const hash = await argon2.hash(PASSWORD);
  users.push(
    {
      id: 'id-existing',
      email: EXISTING,
      passwordHash: hash,
      emailVerified: true,
      isActive: true,
      isDeleted: false,
    },
    {
      id: 'id-other',
      email: OTHER,
      passwordHash: hash,
      emailVerified: true,
      isActive: true,
      isDeleted: false,
    },
  );

  const client = (c: { id: string; secret: string }, requirePar: boolean) => ({
    client_id: c.id,
    client_secret: c.secret,
    redirect_uris: [REDIRECT_URI],
    response_types: ['code' as const],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'client_secret_basic' as const,
    require_pushed_authorization_requests: requirePar,
  });

  const provider = new Provider('http://localhost', {
    clients: [client(PAR_CLIENT, true), client(PLAIN_CLIENT, false)],
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
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
      policy: interactionPolicyWithInvitee(),
    },
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

function authParams(clientId: string, loginHint?: string): Record<string, string> {
  return {
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    state: 'state-1',
    ...(loginHint ? { login_hint: loginHint } : {}),
    code_challenge: createHash('sha256')
      .update(randomBytes(32).toString('base64url'))
      .digest('base64url'),
    code_challenge_method: 'S256',
  };
}

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
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }

  /** What jobwork does: push the parameters server-to-server, then send the browser. */
  async function startWithPar(loginHint: string): Promise<string> {
    const pushed = await fetch(new URL('/request', base), {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${PAR_CLIENT.id}:${PAR_CLIENT.secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(authParams(PAR_CLIENT.id, loginHint)).toString(),
    });
    expect(pushed.status).toBe(201);
    const { request_uri: requestUri } = (await pushed.json()) as { request_uri: string };

    const res = await request(
      `/auth?${new URLSearchParams({ client_id: PAR_CLIENT.id, request_uri: requestUri })}`,
    );
    return res.headers.get('location')!;
  }

  /**
   * Follow the chain until it leaves for the app. Includes the provider's
   * auto-submitting form (the logout step of a switch), which a browser posts itself.
   */
  async function followToApp(res: Response): Promise<URL> {
    let current = res;
    for (let hop = 0; hop < 10; hop += 1) {
      const location = current.headers.get('location');
      if (location) {
        const next = new URL(location, base);
        if (next.href.startsWith(REDIRECT_URI)) return next;
        current = await request(next.pathname + next.search);
        continue;
      }
      const html = await current.text();
      const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
      if (!action) throw new Error(`stopped at ${current.status}: ${html.slice(0, 300)}`);
      const form: Record<string, string> = {};
      for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/?>/g)) {
        form[m[1]!] = m[2]!;
      }
      current = await request(new URL(action, base).pathname, { method: 'POST', form });
    }
    throw new Error('too many redirects');
  }

  /** Sign in as EXISTING (or OTHER) through the locked Sign In — leaves a session. */
  async function signInAs(email: string): Promise<URL> {
    const interaction = await startWithPar(email);
    const res = await request(`${interaction}/login`, {
      method: 'POST',
      form: { email, password: PASSWORD },
    });
    return followToApp(res);
  }

  return { request, startWithPar, followToApp, signInAs };
}

describe('a client that requires PAR', () => {
  it('🔴 refuses a typed /auth?login_hint= — the hint can only arrive server-to-server', async () => {
    const b = browser();
    const res = await b.request(
      `/auth?${new URLSearchParams(authParams(PAR_CLIENT.id, NEWCOMER))}`,
    );

    expect(res.headers.get('location') ?? '').not.toMatch(/^\/interaction\//);
  });
});

describe('a vouched address with no account', () => {
  it('opens Create Account with the address read-only', async () => {
    const b = browser();
    const interaction = await b.startWithPar(NEWCOMER);

    const html = await (await b.request(interaction)).text();

    expect(html).toContain('<h1>Create an account</h1>');
    expect(html).toMatch(new RegExp(`value="${NEWCOMER}"[^>]*readonly`));
    expect(html).toContain(`href="${interaction}?switch=1"`);
    expect(html).not.toContain('Already have an account?');
  });

  it('🔴 registers the invited address even when the form posts a different one', async () => {
    const b = browser();
    const interaction = await b.startWithPar(NEWCOMER);

    const res = await b.request(`${interaction}/signup`, {
      method: 'POST',
      form: {
        firstName: 'Riya',
        lastName: 'Shah',
        email: 'attacker@evil.example',
        password: PASSWORD,
      },
    });

    expect(res.status).toBe(200);
    expect(signup).toHaveBeenCalledTimes(1);
    expect((signup.mock.calls[0]![0] as { email: string }).email).toBe(NEWCOMER);
    expect(await res.text()).toMatch(new RegExp(`value="${NEWCOMER}"[^>]*readonly`));
  });

  it('confirming the code lands on the app callback with a code', async () => {
    const b = browser();
    const interaction = await b.startWithPar(NEWCOMER);
    verifyEmail.mockImplementation(async (email: string) => (email === NEWCOMER ? 'id-new' : null));

    const res = await b.request(`${interaction}/verify`, {
      method: 'POST',
      form: { email: 'attacker@evil.example', otp: '123456' },
    });
    const landed = await b.followToApp(res);

    expect(verifyEmail.mock.calls[0]![0]).toBe(NEWCOMER);
    expect(landed.searchParams.get('code')).toBeTruthy();
  });
});

describe('a vouched address that already has an account', () => {
  it('opens Sign In with the address read-only and no Create Account link', async () => {
    const b = browser();
    const interaction = await b.startWithPar(EXISTING);

    const html = await (await b.request(interaction)).text();

    expect(html).toContain('<h1>Sign in</h1>');
    expect(html).toMatch(new RegExp(`value="${EXISTING}"[^>]*readonly`));
    expect(html).not.toContain('Create Account</a>');
    expect(html).toContain(`href="${interaction}?switch=1"`);
  });

  it('the signup URL redirects to Sign In — signing up again would replace the password', async () => {
    const b = browser();
    const interaction = await b.startWithPar(EXISTING);

    const res = await b.request(`${interaction}/signup`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${interaction}?invitee=1`);
  });

  it('🔴 checks the password against the invited address, not a posted one', async () => {
    const b = browser();
    const interaction = await b.startWithPar(EXISTING);

    // OTHER has the same password: posting OTHER must still sign in as EXISTING.
    const res = await b.request(`${interaction}/login`, {
      method: 'POST',
      form: { email: OTHER, password: PASSWORD },
    });
    const landed = await b.followToApp(res);

    expect(landed.searchParams.get('code')).toBeTruthy();
  });

  it('"Not you?" unlocks an empty field and keeps ?switch=1 on every link', async () => {
    const b = browser();
    const interaction = await b.startWithPar(EXISTING);

    const html = await (await b.request(`${interaction}?switch=1`)).text();

    expect(html).toContain('<h1>Sign in</h1>');
    expect(html).not.toContain(' readonly aria-readonly');
    expect(html).not.toContain(`value="${EXISTING}"`);
    expect(html).toContain(`action="${interaction}/login?switch=1"`);
    expect(html).toContain(`href="${interaction}/signup?switch=1"`);
  });
});

describe('🔴 a hint from a client that does NOT require PAR', () => {
  it('changes nothing: same Sign In page, editable, for an address with or without an account', async () => {
    for (const email of [NEWCOMER, EXISTING]) {
      const b = browser();
      const res = await b.request(
        `/auth?${new URLSearchParams(authParams(PLAIN_CLIENT.id, email))}`,
      );
      const interaction = res.headers.get('location')!;

      const html = await (await b.request(interaction)).text();

      expect(html).toContain('<h1>Sign in</h1>');
      expect(html).toContain(`value="${email}"`);
      expect(html).not.toContain(' readonly aria-readonly');
      expect(html).toContain('Create Account</a>');
    }
  });
});

describe('signed in as X, invited as Y', () => {
  it('shows the mismatch screen naming both addresses', async () => {
    const b = browser();
    await b.signInAs(OTHER);

    const interaction = await b.startWithPar(EXISTING);
    const html = await (await b.request(interaction)).text();

    expect(html).toContain(`This invitation is for ${EXISTING}`);
    expect(html).toContain(`signed in as ${OTHER}`);
    expect(html).toContain(`action="${interaction}/continue"`);
  });

  it('"Stay signed in as X" returns to the app with a code, without asking again', async () => {
    const b = browser();
    await b.signInAs(OTHER);
    const interaction = await b.startWithPar(EXISTING);

    const res = await b.request(`${interaction}/continue`, { method: 'POST' });
    const landed = await b.followToApp(res);

    expect(landed.searchParams.get('code')).toBeTruthy();
  });

  it('🔴 "Switch" signs in as Y — through the provider ending X — and returns with a code', async () => {
    const b = browser();
    await b.signInAs(OTHER);
    const interaction = await b.startWithPar(EXISTING);

    const locked = await (await b.request(`${interaction}?invitee=1`)).text();
    expect(locked).toContain('<h1>Sign in</h1>');
    expect(locked).toMatch(new RegExp(`value="${EXISTING}"[^>]*readonly`));

    const res = await b.request(`${interaction}/login`, {
      method: 'POST',
      form: { email: EXISTING, password: PASSWORD },
    });
    const landed = await b.followToApp(res);
    expect(landed.searchParams.get('code')).toBeTruthy();

    // The browser is now Y: the same invitation again needs no screen at all.
    const again = await b.startWithPar(EXISTING);
    expect(again.startsWith(REDIRECT_URI)).toBe(true);
  });

  it('signed in as the invited address already → no screen at all', async () => {
    const b = browser();
    await b.signInAs(EXISTING);

    const location = await b.startWithPar(EXISTING);

    expect(location.startsWith(REDIRECT_URI)).toBe(true);
  });
});
