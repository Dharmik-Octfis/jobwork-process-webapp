import * as client from 'openid-client';
import { env } from '../../../config/env.ts';
import { prisma } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { isUsableAccount } from '../../../lib/authGuards.ts';

/**
 * jobwork as an OIDC client. docs/SSO_AND_IDENTITY.md §9.
 *
 * 🔴 This is the ONLY place in the app that reads a token from the identity
 * provider. Everything downstream — `authenticate`, `tenantContext`,
 * `requirePermission`, `refresh` — is unchanged and never talks to accounts. That
 * is the two-layer design of §3: the ID token is read once, here, at login.
 *
 * The protocol is handled by `openid-client` rather than by hand. Discovery, PKCE,
 * the `state` and `nonce` checks, and ID token validation (signature, `iss`, `aud`,
 * `exp`, `nonce`) are exactly the steps that go quietly wrong when hand-rolled, and
 * a mistake in any of them is an authentication bypass rather than a bug.
 */

let configuration: client.Configuration | undefined;

/**
 * Discovery result, cached for the process.
 *
 * 🔴 Cached deliberately: without it every login round-trips
 * `/.well-known/openid-configuration` first, putting accounts on the critical path
 * of each sign-in — a milder version of the dependency §3 refuses. A key rotation
 * is still picked up, because JWKS is fetched and cached separately by the library.
 */
export async function ssoConfig(): Promise<client.Configuration> {
  if (configuration) return configuration;

  if (!env.sso.enabled || !env.sso.issuer || !env.sso.clientId || !env.sso.clientSecret) {
    throw new ApiError(500, 'SSO is not configured.');
  }

  const issuer = new URL(env.sso.issuer);

  /**
   * 🔴 `openid-client` refuses plain HTTP, and that default must survive to
   * production. Over HTTP the authorization code, the client secret and the ID
   * token all cross the network in clear — the flow still "works", which is what
   * makes it dangerous.
   *
   * The exception is narrow on purpose, and narrowed twice: only when NODE_ENV is
   * not production AND the issuer is literally localhost. A staging issuer on a
   * real hostname therefore cannot slip through by having the flag left on, and
   * production cannot enable it at all.
   */
  const isLocalDev =
    !env.isProduction && (issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1');

  configuration = await client.discovery(
    issuer,
    env.sso.clientId,
    env.sso.clientSecret,
    undefined,
    isLocalDev ? { execute: [client.allowInsecureRequests] } : undefined,
  );

  return configuration;
}

/** Everything the callback needs to carry across the redirect, in one cookie. */
export interface SsoFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string | undefined;
}

export interface IdTokenClaims {
  sub: string;
  email?: string | undefined;
  emailVerified: boolean;
  name?: string | undefined;
  picture?: string | undefined;
  sid?: string | undefined;
}

/**
 * 🔴 Per-app entitlement — §9.3, the one genuinely new problem.
 *
 * Before SSO, holding a jobwork account MEANT being a jobwork user. After it,
 * everyone in the estate can reach this app's login and obtain a perfectly valid
 * token, so this app has to decide for itself whether that person gets in.
 *
 * jobwork's policy is INVITE-ONLY, and this is the ONE way to say yes: a pending
 * invitation, addressed to an email the identity provider has verified. Everything
 * else refuses. An app that auto-provisions here silently turns every identity in
 * the estate into one of its users — the same failure shape as a route with no
 * `requirePermission`, and just as quiet.
 *
 * 🔴 `emailVerified` is the whole security of this check. The invitation is
 * addressed to an ADDRESS, so anyone able to register that address at accounts
 * without proving they own it could walk into the organization it was meant for.
 * Refuse rather than trust an unverified claim.
 *
 * What this deliberately does NOT do is accept the invitation. It creates the local
 * user — password-less, stamped with `identityUserId` — and stops. Joining the
 * organization stays in `invitations.service.ts`, which already owns the membership
 * name, the role and the permission template; duplicating that here would be a
 * second implementation of the one thing that grants access.
 */
async function provisionOrRefuse(claims: IdTokenClaims) {
  const refuse = (): never => {
    throw new ApiError(
      403,
      "You don't have access to this app. Ask your administrator to invite you.",
    );
  };

  if (!claims.emailVerified || !claims.email) return refuse();

  const invitation = await prisma.invitation.findFirst({
    where: {
      email: claims.email,
      status: 'pending',
      isDeleted: false,
      acceptedAt: null,
      declinedAt: null,
      expiresAt: { gt: new Date() },
      // An invitation into a deleted organization is not an invitation.
      organization: { isDeleted: false },
    },
    select: { id: true },
  });

  if (!invitation) return refuse();

  // No `passwordHash`: this account exists only through the identity provider, and
  // giving it a local password would quietly reopen the login this cutover closes.
  return prisma.user.create({
    data: {
      email: claims.email,
      identityUserId: claims.sub,
      firstName: claims.name?.split(' ')[0] ?? '',
      lastName: claims.name?.split(' ').slice(1).join(' ') ?? '',
      fullName: claims.name ?? '',
      userAgent: 'unknown',
    },
  });
}

/**
 * Find the local user this identity belongs to, or refuse.
 *
 * Returns the app's own `users` row. 🔴 `users.id` stays the FK target for every
 * membership, `createdBy` and `updatedBy` in this database — the identity id is
 * recorded beside it, never substituted for it.
 */
export async function linkOrCreateLocalUser(claims: IdTokenClaims) {
  const linked = await prisma.user.findUnique({ where: { identityUserId: claims.sub } });

  if (linked) {
    // The account can be disabled locally even though the identity is fine — one
    // app revoking access must not require touching the central account.
    if (!isUsableAccount(linked)) throw new ApiError(403, 'This account has been disabled.');
    return linked;
  }

  /**
   * 🔴 ONE-TIME MIGRATION AFFORDANCE. Match a pre-existing row by email exactly
   * once, stamp `identityUserId`, and never look a user up by email again — people
   * change email addresses; `sub` is forever.
   *
   * `email_verified` is load-bearing, not a formality: without it, anyone who
   * registers at accounts with someone else's unverified address takes over that
   * person's jobwork account. Delete this whole branch once §13 step 6 is done, and
   * not before step 5 — until every active user is linked it is the only thing
   * letting them in.
   */
  if (claims.emailVerified && claims.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });

    if (byEmail) {
      if (!isUsableAccount(byEmail)) throw new ApiError(403, 'This account has been disabled.');
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { identityUserId: claims.sub },
      });
    }
  }

  return provisionOrRefuse(claims);
}

/**
 * Where to send the browser after a successful sign-in — §9.4, and the only place
 * tenancy appears in the login path.
 *
 * 🔴 Never auto-create an organization here. A user with no membership has
 * authenticated but is not entitled to anything yet, and inventing a tenant to give
 * them somewhere to land would hand every new identity its own empty company.
 */
export async function landingPathFor(userId: string, returnTo?: string): Promise<string> {
  const memberships = await prisma.membership.findMany({
    where: { userId, isDeleted: false, organization: { isDeleted: false } },
    select: { organizationId: true },
  });

  if (memberships.length === 0) return '/no-access';
  if (returnTo) return returnTo;
  if (memberships.length === 1) return `/organizations/${memberships[0]!.organizationId}`;
  return '/organizations';
}

/**
 * Only allow `returnTo` to be a path on this app.
 *
 * 🔴 An absolute URL here is an open redirect: sign-in succeeds and then hands the
 * browser to whatever host the link named, which is the classic way a phishing page
 * borrows a real login. Protocol-relative `//evil.test` counts as absolute.
 */
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  return value;
}
