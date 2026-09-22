import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Provider, { type Configuration } from 'oidc-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFirstPartyGrant } from './firstPartyGrant.ts';

/**
 * `loadExistingGrant` — what makes `prompt=none` actually silent.
 *
 * 🔴 The failure this pins is invisible in a normal login: without the hook a
 * first-time sign-in takes one extra consent redirect that nobody notices. It only
 * shows under `prompt=none`, which cannot interact and answers `consent_required` —
 * for first-time users only, so silent SSO "works for some people". The control case
 * below proves the test can see the difference.
 */

const COOKIE_KEY = 'test-cookie-secret-that-is-at-least-32-chars';
const REDIRECT_URI = 'https://app.example/api/auth/sso/callback';
const SCOPE = 'openid email profile';

/** Keygrip's signature, as `cookies` checks it: base64url HMAC-SHA1 of `name=value`. */
function sign(data: string): string {
  return createHmac('sha1', COOKIE_KEY)
    .update(data)
    .digest('base64')
    .replace(/\/|\+|=/g, (c) => ({ '/': '_', '+': '-', '=': '' })[c] ?? '');
}

async function startProvider(extra: Partial<Configuration>) {
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
      keys: [COOKIE_KEY],
      long: { signed: true, httpOnly: true, sameSite: 'lax', path: '/' },
      short: { signed: true, httpOnly: true, sameSite: 'lax' },
    },
    findAccount: (_ctx, sub) => ({ accountId: sub, claims: () => ({ sub }) }),
    claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name', 'picture'] },
    scopes: ['openid', 'email', 'profile'],
    responseTypes: ['code'],
    pkce: { required: () => true },
    features: { devInteractions: { enabled: false } },
    ...extra,
  });

  const server = provider.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { provider, server, base };
}

/** A signed-in browser: a saved Session and the signed `_session` cookie naming it. */
async function signedInCookie(provider: Provider, accountId: string): Promise<string> {
  const session = new provider.Session();
  session.accountId = accountId;
  session.loginTs = Math.floor(Date.now() / 1000);
  const jti = await session.save(3600);
  return `_session=${jti}; _session.sig=${sign(`_session=${jti}`)}`;
}

/** `GET /auth?prompt=none` and return where the provider sent the browser. */
async function silentAuth(base: string, cookie: string): Promise<URL> {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: 'app',
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    state: 'state-1',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'none',
  });

  // Follow the provider's own same-origin hops (it resumes itself), stop at the app.
  let url = `${base}/auth?${params}`;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await fetch(url, { headers: { cookie }, redirect: 'manual' });
    const location = res.headers.get('location');
    if (!location) throw new Error(`no redirect (status ${res.status}): ${await res.text()}`);
    const next = new URL(location, url);
    if (next.href.startsWith(REDIRECT_URI)) return next;
    url = next.href;
  }
  throw new Error('too many redirects');
}

describe('prompt=none for a signed-in user signing in to an app for the FIRST time', () => {
  let withHook: Awaited<ReturnType<typeof startProvider>>;
  let withoutHook: Awaited<ReturnType<typeof startProvider>>;

  beforeAll(async () => {
    withHook = await startProvider({ loadExistingGrant: loadFirstPartyGrant });
    withoutHook = await startProvider({});
  });

  afterAll(() => {
    (withHook.server as Server).close();
    (withoutHook.server as Server).close();
  });

  it('control — without the hook, the library answers consent_required', async () => {
    const cookie = await signedInCookie(withoutHook.provider, 'user-without-hook');
    const landed = await silentAuth(withoutHook.base, cookie);

    expect(landed.searchParams.get('error')).toBe('consent_required');
    expect(landed.searchParams.get('code')).toBeNull();
  });

  it('with the hook, it answers with a code and no interaction', async () => {
    const cookie = await signedInCookie(withHook.provider, 'user-with-hook');
    const landed = await silentAuth(withHook.base, cookie);

    expect(landed.searchParams.get('error')).toBeNull();
    expect(landed.searchParams.get('code')).toBeTruthy();
    expect(landed.searchParams.get('state')).toBe('state-1');
  });

  it('a second silent sign-in reuses the same grant rather than minting another', async () => {
    const { provider, base } = withHook;
    const cookie = await signedInCookie(provider, 'user-repeat');

    await silentAuth(base, cookie);
    const jti = cookie.match(/_session=([^;]+)/)![1]!;
    const firstGrant = (await provider.Session.find(jti))?.grantIdFor('app');

    await silentAuth(base, cookie);
    const secondGrant = (await provider.Session.find(jti))?.grantIdFor('app');

    expect(firstGrant).toBeTruthy();
    expect(secondGrant).toBe(firstGrant);
    const grant = await provider.Grant.find(firstGrant!);
    const granted = grant?.getOIDCScopeEncountered().split(' ').filter(Boolean).sort();
    expect(granted).toEqual(SCOPE.split(' ').sort());
  });

  it('with no session at all, it still answers login_required — the hook grants consent, not login', async () => {
    const landed = await silentAuth(withHook.base, '');

    expect(landed.searchParams.get('error')).toBe('login_required');
    expect(landed.searchParams.get('code')).toBeNull();
  });
});
