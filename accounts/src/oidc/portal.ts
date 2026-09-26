import { createHash, randomBytes } from 'node:crypto';
import type { ClientMetadata } from 'oidc-provider';

/**
 * The "My Account" portal — accounts.octfis.com itself, as a client of itself.
 *
 * 🔴 Why a client at all: this service can only show its login form inside an
 * interaction, and only `/auth` starts one. A bare visit to `/` has no app behind it,
 * so to open the login form there — the way `accounts.zoho.com` does — the portal is
 * the app that asks. Keycloak's "account console" is built the same way.
 *
 * Defined in code, not in `oidc_clients`: it is part of this service, not something an
 * administrator registers, and deriving its URLs from the issuer makes it correct in
 * every environment with no registry row per environment.
 *
 * `token_endpoint_auth_method: 'none'` because it never redeems a code. It does not
 * need one: finishing the interaction is what sets this service's own session cookie,
 * and the account page reads that session directly. The unused code expires in 60 s.
 * PKCE is still required by the provider, so the request carries a throwaway challenge.
 */
export const PORTAL_CLIENT_ID = 'accounts-portal';
export const PORTAL_NAME = 'Octfis Accounts';

export function portalClient(issuer: string): ClientMetadata {
  return {
    client_id: PORTAL_CLIENT_ID,
    client_name: PORTAL_NAME,
    redirect_uris: [`${issuer}/account/callback`],
    post_logout_redirect_uris: [`${issuer}/`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** `/auth` for the portal: opens the login form when nobody is signed in. */
export function portalSignInUrl(issuer: string): string {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: PORTAL_CLIENT_ID,
    redirect_uri: `${issuer}/account/callback`,
    response_type: 'code',
    scope: 'openid',
    state: randomBytes(16).toString('base64url'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return `/auth?${params}`;
}

/** Sign out of the central session and come back to the login form. */
export function portalSignOutUrl(issuer: string): string {
  const params = new URLSearchParams({
    client_id: PORTAL_CLIENT_ID,
    post_logout_redirect_uri: `${issuer}/`,
  });
  return `/session/end?${params}`;
}
