import { describe, expect, it } from 'vitest';
import { pinPublicOrigin } from './publicOrigin.ts';

/**
 * The URLs `oidc-provider` advertises are derived per request, so they are only as
 * trustworthy as the headers behind them. This pins both halves: that a deployed
 * environment advertises https, and that a forged header cannot change what it says.
 */
const run = (issuer: string, headers: Record<string, string> = {}) => {
  const req = { headers } as { headers: Record<string, string> };
  pinPublicOrigin(issuer)(req as never, {} as never, () => {});
  return req.headers;
};

describe('pinPublicOrigin', () => {
  it('advertises https for a real issuer, with no default port', () => {
    expect(run('https://accounts.octfis.com')).toMatchObject({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'accounts.octfis.com',
    });
  });

  // A no-op in dev is the point: the bug only ever appeared once deployed.
  it('leaves local development on http, port included', () => {
    expect(run('http://localhost:3100')).toMatchObject({
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'localhost:3100',
    });
  });

  it('overwrites a forged forwarded host', () => {
    expect(run('https://accounts.octfis.com', { 'x-forwarded-host': 'evil.test' })).toMatchObject({
      'x-forwarded-host': 'accounts.octfis.com',
    });
  });

  it('overwrites a forged forwarded proto', () => {
    expect(run('https://accounts.octfis.com', { 'x-forwarded-proto': 'http' })).toMatchObject({
      'x-forwarded-proto': 'https',
    });
  });
});
