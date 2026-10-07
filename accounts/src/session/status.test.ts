import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExactOrigin } from '../lib/exactOrigin.ts';

/**
 * `GET /session/status` — the website's "Sign In" / "Access Jobwork" label.
 *
 * Two things here fail SILENTLY in production, which is why they are pinned:
 * - the CORS allowlist: a wrong origin (bare `octfis.com` for `www.octfis.com`) makes
 *   every probe unreadable, and the website's `.catch()` turns that into a button that
 *   never flips — no error anywhere;
 * - the cookie read: if the library's signed-cookie lookup is wired wrong, the answer
 *   is `false` for everyone, which looks exactly like "nobody is signed in".
 */

const findFirst = vi.fn();
vi.mock('../db/prisma.ts', () => ({ prisma: { ssoSession: { findFirst } } }));
vi.mock('../config/env.ts', () => ({
  env: { sessionStatusOrigins: ['https://www.octfis.com'] },
}));

const { sessionStatusRouter } = await import('./status.routes.ts');

const WEBSITE = 'https://www.octfis.com';
const COOKIE_KEY = 'test-cookie-secret-that-is-at-least-32-chars';

/** Keygrip's signature, as `cookies` checks it: base64url HMAC-SHA1 of `name=value`. */
function sign(data: string): string {
  return createHmac('sha1', COOKIE_KEY)
    .update(data)
    .digest('base64')
    .replace(/\/|\+|=/g, (c) => ({ '/': '_', '+': '-', '=': '' })[c] ?? '');
}

function sessionCookie(jti: string, signature = sign(`_session=${jti}`)): string {
  return `_session=${jti}; _session.sig=${signature}`;
}

// A real provider on the library's in-memory adapter, so `Session.get` runs the
// genuine signed-cookie lookup rather than a stand-in for it.
const provider = new Provider('http://localhost:3100', {
  cookies: {
    keys: [COOKIE_KEY],
    long: { signed: true, httpOnly: true, sameSite: 'lax', path: '/' },
  },
});

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(sessionStatusRouter(provider));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  findFirst.mockReset();
});

function status(headers: Record<string, string> = {}) {
  return fetch(`${base}/session/status`, { headers });
}

async function signedInSession(accountId = 'user-1') {
  const session = new provider.Session();
  session.accountId = accountId;
  const jti = await session.save(3600);
  return { jti, uid: session.uid, accountId };
}

describe('GET /session/status — CORS', () => {
  it('echoes the allowed origin and allows credentials', async () => {
    const res = await status({ Origin: WEBSITE });

    expect(res.headers.get('access-control-allow-origin')).toBe(WEBSITE);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it.each([
    ['bare domain (no www)', 'https://octfis.com'],
    ['another site', 'https://evil.example'],
    ['a lookalike suffix', 'https://www.octfis.com.evil.example'],
    ['plain http', 'http://www.octfis.com'],
  ])('sends no CORS headers to %s', async (_label, origin) => {
    const res = await status({ Origin: origin });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('is never cached and varies on Origin', async () => {
    const res = await status({ Origin: WEBSITE });

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toMatch(/Origin/);
  });
});

describe('GET /session/status — the answer', () => {
  it('is false with no session cookie, without touching the database', async () => {
    const res = await status({ Origin: WEBSITE });

    await expect(res.json()).resolves.toEqual({ signedIn: false });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('is false for a cookie whose signature does not verify', async () => {
    const { jti } = await signedInSession();

    const res = await status({ Cookie: sessionCookie(jti, 'forged-signature') });

    await expect(res.json()).resolves.toEqual({ signedIn: false });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('is false for a signed cookie naming a session that no longer exists', async () => {
    const res = await status({ Cookie: sessionCookie('logged-out-session-jti') });

    await expect(res.json()).resolves.toEqual({ signedIn: false });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('is true for a live session, and checks revocation, expiry and the account', async () => {
    const { jti, uid, accountId } = await signedInSession();
    findFirst.mockResolvedValue({ id: uid });

    const res = await status({ Origin: WEBSITE, Cookie: sessionCookie(jti) });

    await expect(res.json()).resolves.toEqual({ signedIn: true });
    const { where } = findFirst.mock.calls[0]![0];
    expect(where).toMatchObject({
      id: uid,
      userId: accountId,
      revokedAt: null,
      user: { isActive: true, isDeleted: false },
    });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('is false when our record says revoked, expired or disabled', async () => {
    // The library's row is alive, but sso_sessions (the where clause above) found
    // nothing — password reset, an expired row, or a disabled account.
    const { jti } = await signedInSession();
    findFirst.mockResolvedValue(null);

    const res = await status({ Cookie: sessionCookie(jti) });

    await expect(res.json()).resolves.toEqual({ signedIn: false });
  });

  it('says nothing but the boolean', async () => {
    const { jti, uid } = await signedInSession();
    findFirst.mockResolvedValue({ id: uid });

    const res = await status({ Cookie: sessionCookie(jti) });

    expect(Object.keys((await res.json()) as object)).toEqual(['signedIn']);
  });
});

describe('isExactOrigin', () => {
  it.each(['https://www.octfis.com', 'https://accounts.octfis.com:8443', 'http://localhost:5173'])(
    'accepts %s',
    (origin) => {
      expect(isExactOrigin(origin)).toBe(true);
    },
  );

  it.each([
    'https://www.octfis.com/', // trailing slash — the browser never sends one
    'https://www.octfis.com/jobwork', // a page, not an origin
    'http://www.octfis.com', // plain http off localhost
    '*',
    'https://*.octfis.com',
    'www.octfis.com',
    '',
  ])('rejects %s', (origin) => {
    expect(isExactOrigin(origin)).toBe(false);
  });
});
