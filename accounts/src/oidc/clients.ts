import type { ClientMetadata } from 'oidc-provider';
import { prisma } from '../db/prisma.ts';

/**
 * The client registry — §8. Every app allowed to use this IdP.
 *
 * Loaded once at boot into the provider's static `clients` array rather than served
 * through the adapter, deliberately: registering an app should be a reviewed
 * database change, not something the protocol layer can be talked into creating.
 * ⚠️ The cost is that adding or changing a client needs a restart. That is the right
 * trade at this size; revisit it when clients change more often than deploys do.
 *
 * 🔴 `client_secret` here holds the ARGON2 HASH, not the secret. `oidc-provider`
 * compares it through `Client.prototype.compareClientSecret`, which provider.ts
 * overrides to verify with argon2 — and asserts is in place at boot. If that
 * override ever fails to apply, the library's default compares the hash string
 * against the presented secret, which never matches, so every client fails to
 * authenticate. Loudly broken, never silently open.
 */
/**
 * Every origin a registered client can legitimately be redirected to.
 *
 * 🔴 This exists for `form-action`, and the reason is not obvious. A browser
 * enforces `form-action` across the WHOLE redirect chain a form submission causes,
 * not just its immediate target. Signing in posts to this origin, but the response
 * chain then hops to the app's callback and on to the app itself:
 *
 *     POST /interaction/:uid/login  →  /auth/:uid  →  app callback  →  app
 *     accounts.example                accounts       APP ORIGIN       APP ORIGIN
 *
 * With `form-action 'self'` the hop to the app origin violates the policy and the
 * browser blocks the SUBMISSION — reporting it against the form's own same-origin
 * action, which makes it look like the policy is contradicting itself.
 *
 * Deriving the list from the registry keeps it bounded and self-maintaining: the
 * origins allowed are exactly the ones an administrator already registered as
 * redirect targets. It is not a wildcard, and registering a client is still the
 * only way to add one.
 */
export async function clientOrigins(): Promise<string[]> {
  const rows = await prisma.oidcClient.findMany({
    where: { isActive: true, isDeleted: false },
    select: { redirectUris: true, postLogoutUris: true },
  });

  const origins = new Set<string>();

  for (const row of rows) {
    for (const uri of [...row.redirectUris, ...row.postLogoutUris]) {
      try {
        origins.add(new URL(uri).origin);
      } catch {
        // A malformed registry row must not take the service down at boot. It will
        // fail its own exact-match check at /authorize, which is where it belongs.
      }
    }
  }

  return [...origins];
}

export async function loadClients(): Promise<ClientMetadata[]> {
  const rows = await prisma.oidcClient.findMany({
    where: { isActive: true, isDeleted: false },
    orderBy: { id: 'asc' },
  });

  return rows.map((row): ClientMetadata => ({
    client_id: row.id,
    client_name: row.name,
    client_secret: row.secretHash,

    /**
     * 🔴 EXACT strings. §12 calls a loose `redirect_uri` the #1 hole in hand-rolled
     * IdPs, because it turns the authorization code into something an attacker can
     * have delivered to a host they control. `oidc-provider` matches these exactly
     * — never pre-process them into patterns here.
     */
    redirect_uris: row.redirectUris,
    post_logout_redirect_uris: row.postLogoutUris,

    ...(row.backchannelLogoutUri
      ? {
          backchannel_logout_uri: row.backchannelLogoutUri,
          // Include `sid` in the logout token so an app can end the ONE session
          // this is about, rather than every session the user has.
          backchannel_logout_session_required: true,
        }
      : {}),

    /**
     * Authorization Code only — no implicit, no hybrid (tokens in the URL), and
     * deliberately no `refresh_token`.
     *
     * 🔴 §3: an app refreshes against its OWN database, never against accounts. The
     * ID token is read once, at login, and then this service is out of the request
     * path entirely. Granting `refresh_token` here would put accounts back on the
     * critical path for every user of every app every 15 minutes — one bad deploy
     * logging out the entire customer base — and buy nothing.
     */
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
  }));
}
