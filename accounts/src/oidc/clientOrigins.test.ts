import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The `form-action` origin list — the directive that decides whether signing in
 * works at all.
 *
 * 🔴 This is here because losing it costs a day. A browser enforces `form-action`
 * across the WHOLE redirect chain a submission causes, and signing in redirects off
 * this origin and onto the app's:
 *
 *     POST /interaction/:uid/login → /auth/:uid → app callback → app
 *
 * With `form-action 'self'` the browser blocks the submission and reports it against
 * the form's own SAME-ORIGIN action, which reads as the policy contradicting itself
 * and sends you looking anywhere but here.
 *
 * ⚠️ No server-side test can catch a regression in this: CSP is enforced only by
 * browsers, and `fetch`/`curl`/supertest ignore the header entirely — a flow that is
 * completely broken in a browser passes an HTTP-level test with every assertion
 * green. That is exactly how this shipped. So what is pinned here is the ONE thing a
 * test can check: that the origins reach the policy at all.
 */

const findMany = vi.fn();
vi.mock('../db/prisma.ts', () => ({ prisma: { oidcClient: { findMany } } }));

const { clientOrigins } = await import('./clients.ts');

beforeEach(() => {
  findMany.mockReset();
});

describe('clientOrigins', () => {
  it('collects the origin of every redirect and post-logout URI', async () => {
    findMany.mockResolvedValue([
      {
        redirectUris: ['https://app.example.com/api/auth/sso/callback'],
        postLogoutUris: ['https://app.example.com/'],
      },
    ]);

    // Both URIs share an origin — the list is origins, not URLs.
    await expect(clientOrigins()).resolves.toEqual(['https://app.example.com']);
  });

  it('includes the post-logout origin even when it differs from the callback origin', async () => {
    // The local shape, and the one that actually broke: the callback lands on the
    // API's port and the browser is then sent on to the dev server's.
    findMany.mockResolvedValue([
      {
        redirectUris: ['http://localhost:3000/api/auth/sso/callback'],
        postLogoutUris: ['http://localhost:5173/'],
      },
    ]);

    const origins = await clientOrigins();

    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:5173');
  });

  it('de-duplicates origins across clients', async () => {
    findMany.mockResolvedValue([
      { redirectUris: ['https://a.example.com/cb'], postLogoutUris: [] },
      { redirectUris: ['https://a.example.com/other'], postLogoutUris: [] },
    ]);

    await expect(clientOrigins()).resolves.toEqual(['https://a.example.com']);
  });

  it('skips a malformed URI instead of failing the boot', async () => {
    // A bad registry row must not take the service down at startup; it fails its own
    // exact-match check at /authorize, which is where that belongs.
    findMany.mockResolvedValue([
      { redirectUris: ['not-a-url', 'https://good.example.com/cb'], postLogoutUris: [] },
    ]);

    await expect(clientOrigins()).resolves.toEqual(['https://good.example.com']);
  });

  it('returns nothing when no clients are registered', async () => {
    // Spreads to nothing, leaving `form-action 'self'` — the safe direction.
    findMany.mockResolvedValue([]);

    await expect(clientOrigins()).resolves.toEqual([]);
  });

  it('reads only active, non-deleted clients', async () => {
    findMany.mockResolvedValue([]);
    await clientOrigins();

    // A revoked client's origin must not stay in the policy.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, isDeleted: false } }),
    );
  });
});
