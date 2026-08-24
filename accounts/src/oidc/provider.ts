import Provider, { type Configuration, type Account } from 'oidc-provider';
import argon2 from 'argon2';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { createPrismaAdapter } from './adapter.ts';
import { loadClients } from './clients.ts';
import { ensureSigningKey, loadSigningJwks } from './keys.ts';

/**
 * The OIDC provider. docs/SSO_AND_IDENTITY.md §7.1, §12.
 *
 * The library supplies the protocol — /authorize, /token, /jwks, /userinfo,
 * discovery, PKCE, code handling. We supply the storage, the keys, the client
 * registry and the user store.
 */

/**
 * The ID token stays IDENTITY ONLY — §5.
 *
 * 🔴 No organizations, no roles, no permissions, ever. Each app resolves those
 * itself on every request (`tenantContext`, `requirePermission`), and a token that
 * carried them would be a snapshot: remove someone from an organization and their
 * token still says they belong, for as long as it lives. Membership changes have to
 * take effect immediately, which means they cannot be in a token.
 */
async function findAccount(_ctx: unknown, sub: string): Promise<Account | undefined> {
  const user = await prisma.user.findFirst({
    where: { id: sub, isActive: true, isDeleted: false },
  });
  if (!user) return undefined;

  return {
    accountId: user.id,
    claims: () => ({
      sub: user.id,
      email: user.email,
      email_verified: user.emailVerified,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      picture: user.avatarUrl ?? undefined,
    }),
  };
}

function baseConfiguration(): Omit<Configuration, 'clients' | 'jwks'> {
  return {
    adapter: createPrismaAdapter(),
    findAccount,

    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'picture'],
    },

    /**
     * 🔴 Authorization Code ONLY. The library's defaults also advertise implicit and
     * the hybrid `code id_token`, both of which return tokens in the URL fragment,
     * where they reach browser history, server logs and `Referer` headers.
     *
     * Restricting the CLIENTS is not enough: whatever discovery advertises is what a
     * future client will be written against. Narrow it at the provider, so the flow
     * is not merely unused but unavailable.
     */
    responseTypes: ['code'],

    /**
     * 🔴 No `offline_access` — §3. Granting it makes accounts issue an OIDC refresh
     * token to each app, and the whole point of the two-layer design is that apps
     * refresh against their OWN database and never call accounts on that path. A
     * refresh token we never use is one more long-lived credential to store, rotate
     * and leak.
     */
    scopes: ['openid', 'email', 'profile'],

    /**
     * 🔴 PKCE on every client, including confidential ones. It costs nothing and it
     * closes code interception even when a client secret has leaked — §12.
     */
    pkce: { required: () => true },

    cookies: {
      keys: env.cookieSecrets,
      /**
       * The SSO cookie. §4: `SameSite=Lax`, not Strict (Strict drops the cookie on
       * arrival from another host and forces a login every time — a failure that
       * looks like "SSO doesn't work"), and not None.
       *
       * `__Host-` is not set here: the library manages the cookie name, and the
       * prefix requires no Domain attribute, which is already the default below.
       */
      long: { signed: true, httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/' },
      short: { signed: true, httpOnly: true, sameSite: 'lax', secure: env.isProduction, path: '/' },
    },

    features: {
      /** 🔴 Off. These are the library's built-in fake login screens. */
      devInteractions: { enabled: false },
      /** §10 — how a logout reaches the apps that have a live session. */
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      revocation: { enabled: true },
      userinfo: { enabled: true },
    },

    /**
     * Short-lived by design. The ID token is read once, at login (§3) — after that
     * the app runs on its own session, so a long-lived one buys nothing and widens
     * the replay window.
     */
    ttl: {
      AuthorizationCode: 60,
      IdToken: 300,
      AccessToken: 3600,
      Interaction: 600,
      Session: 14 * 24 * 3600,
      Grant: 14 * 24 * 3600,
    },

    /** Where an unauthenticated /authorize sends the browser. Built next. */
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
  };
}

/**
 * 🔴 Teach the provider to verify an argon2-hashed client secret.
 *
 * §7.3 stores `oidc_clients.secret_hash` as argon2 and never plaintext. The library
 * compares `client_secret` with a constant-time string equality, which cannot work
 * against a hash — so `Client.prototype.compareClientSecret` is replaced here.
 *
 * `provider.Client` is a runtime property the type definitions do not describe, so
 * this is reaching past the public API and an upgrade could move it. That is
 * tolerable ONLY because the failure direction is safe: if the override stops
 * applying, the default compares the stored argon2 hash against the presented
 * secret, which never matches, and every client fails to authenticate. Loudly
 * broken, never silently open.
 *
 * The assertion below turns "an upgrade quietly changed this" into a boot failure
 * rather than something discovered in production.
 */
function installArgon2ClientSecrets(provider: Provider): void {
  const clientClass = (provider as unknown as { Client?: { prototype?: Record<string, unknown> } })
    .Client;

  if (typeof clientClass?.prototype?.['compareClientSecret'] !== 'function') {
    throw new Error(
      'oidc-provider: Client.prototype.compareClientSecret not found. The library moved it, ' +
        'so client secrets would be compared as plaintext against an argon2 hash and every ' +
        'client would fail to authenticate. Re-point this override before deploying.',
    );
  }

  clientClass.prototype['compareClientSecret'] = async function (
    this: { clientSecret?: string },
    actual: string,
  ): Promise<boolean> {
    if (!this.clientSecret) return false;
    try {
      return await argon2.verify(this.clientSecret, actual);
    } catch {
      // A malformed hash must not throw past the auth layer into a 500 — it is an
      // authentication failure, and it is the operator's registry that is wrong.
      return false;
    }
  };
}

export async function createOidcProvider(): Promise<Provider> {
  await ensureSigningKey();

  const [jwks, clients] = await Promise.all([loadSigningJwks(), loadClients()]);

  if (clients.length === 0) {
    // Not fatal — a provider with no clients still serves discovery and JWKS, which
    // is exactly the state §13 step 1 describes ("nothing points at it yet").
    console.warn('oidc: no active clients registered — /authorize will reject every request');
  }

  const provider = new Provider(env.oidcIssuer, {
    ...baseConfiguration(),
    jwks: { keys: jwks },
    clients,
  });

  installArgon2ClientSecrets(provider);

  /**
   * AppSail terminates TLS in front of us, so without this the library sees `http`,
   * refuses to set a Secure cookie, and rejects its own https issuer as a mismatch.
   */
  provider.proxy = true;

  return provider;
}
