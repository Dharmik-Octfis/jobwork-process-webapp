import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Silent sign-in (`prompt=none`) — docs/SSO_WEBSITE_ENTRY_PLAN.md §5.2.
 *
 * Every case here fails in a way that only shows against real hostnames, which is why
 * it is pinned: an unhandled `login_required` is a 500 page for every signed-out
 * visitor; a missing loop guard is a browser bouncing between jobwork and accounts
 * forever; a silent attempt that swallows a deep link loses an invitation.
 */

const env = vi.hoisted(() => ({
  isProduction: false,
  appUrl: 'https://jobwork.example',
  sso: {
    enabled: true,
    clientId: 'jobwork',
    redirectUri: 'https://jobwork.example/api/auth/sso/callback',
    postLogoutRedirectUri: undefined as string | undefined,
    websiteUrl: 'https://www.octfis.example/job-work-1' as string | undefined,
  },
}));
vi.mock('../../../config/env.ts', () => ({ env }));

const authorizationCodeGrant = vi.fn();
vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: () => 'verifier',
  randomState: () => 'state-1',
  randomNonce: () => 'nonce-1',
  calculatePKCECodeChallenge: async () => 'challenge',
  buildAuthorizationUrl: (_config: unknown, params: Record<string, string>) =>
    new URL(`https://accounts.example/auth?${new URLSearchParams(params)}`),
  authorizationCodeGrant: (...args: unknown[]) => authorizationCodeGrant(...args),
}));

vi.mock('./sso.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sso.service.ts')>()),
  ssoConfig: async () => ({}),
}));
vi.mock('../../../db/prisma.ts', () => ({ prisma: {} }));
vi.mock('../auth.service.ts', () => ({}));

const { startLogin, callback } = await import('./sso.controller.ts');

function fakeRes() {
  const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {};
  const res = {
    cookie: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
      cookies[name] = { value, options };
    }),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
  };
  return { res: res as unknown as Response, cookies, redirect: res.redirect };
}

function fakeReq(query: Record<string, string>, cookies: Record<string, string> = {}) {
  return { query, cookies, get: () => undefined } as unknown as Request;
}

function flowCookie(flow: Record<string, unknown>) {
  return JSON.stringify({ state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier', ...flow });
}

beforeEach(() => {
  authorizationCodeGrant.mockReset();
  authorizationCodeGrant.mockRejectedValue(new Error('exchange attempted'));
  env.sso.websiteUrl = 'https://www.octfis.example/job-work-1';
});

describe('startLogin', () => {
  it('asks accounts for prompt=none, marks the flow silent and sets the loop guard', async () => {
    const { res, cookies, redirect } = fakeRes();

    await startLogin(fakeReq({ prompt: 'none', returnTo: '/home' }), res);

    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(JSON.parse(cookies['sso_flow']!.value)).toMatchObject({
      silent: true,
      returnTo: '/home',
    });
    expect(cookies['sso_silent']).toBeDefined();
  });

  it('refuses a second silent attempt inside the guard window and shows the button instead', async () => {
    const { res, cookies, redirect } = fakeRes();

    await startLogin(fakeReq({ prompt: 'none' }, { sso_silent: '1' }), res);

    expect(redirect).toHaveBeenCalledWith('https://jobwork.example/login?sso=manual');
    expect(cookies['sso_flow']).toBeUndefined();
  });

  it('leaves an interactive sign-in exactly as it was — no prompt, no guard', async () => {
    const { res, cookies, redirect } = fakeRes();

    // The invitation path: a deep link and a login hint, even with a guard present.
    await startLogin(
      fakeReq(
        { returnTo: '/invite/accept?token=abc', email: 'new@example.com' },
        { sso_silent: '1' },
      ),
      res,
    );

    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.searchParams.get('prompt')).toBeNull();
    expect(url.searchParams.get('login_hint')).toBe('new@example.com');
    expect(JSON.parse(cookies['sso_flow']!.value)).not.toHaveProperty('silent');
    expect(cookies['sso_silent']).toBeUndefined();
  });
});

describe('callback after a silent attempt', () => {
  it.each(['login_required', 'consent_required', 'interaction_required'])(
    'sends %s to the website without attempting the exchange',
    async (error) => {
      const { res, redirect } = fakeRes();

      await callback(
        fakeReq({ error, state: 'state-1' }, { sso_flow: flowCookie({ silent: true }) }),
        res,
      );

      expect(redirect).toHaveBeenCalledWith('https://www.octfis.example/job-work-1');
      expect(authorizationCodeGrant).not.toHaveBeenCalled();
    },
  );

  it("falls back to the app's own sign-in button when no website is configured", async () => {
    env.sso.websiteUrl = undefined;
    const { res, redirect } = fakeRes();

    await callback(
      fakeReq(
        { error: 'login_required', state: 'state-1' },
        { sso_flow: flowCookie({ silent: true }) },
      ),
      res,
    );

    expect(redirect).toHaveBeenCalledWith('https://jobwork.example/login?sso=manual');
  });

  it('does NOT trust an error whose state does not match the flow', async () => {
    const { res, redirect } = fakeRes();

    await expect(
      callback(
        fakeReq(
          { error: 'login_required', state: 'forged' },
          { sso_flow: flowCookie({ silent: true }) },
        ),
        res,
      ),
    ).rejects.toThrow('exchange attempted');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('treats an error on an INTERACTIVE sign-in as before — no silent redirect', async () => {
    const { res, redirect } = fakeRes();

    await expect(
      callback(
        fakeReq({ error: 'access_denied', state: 'state-1' }, { sso_flow: flowCookie({}) }),
        res,
      ),
    ).rejects.toThrow('exchange attempted');
    expect(redirect).not.toHaveBeenCalled();
  });
});
