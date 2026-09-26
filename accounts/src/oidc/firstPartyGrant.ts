import type { Grant, KoaContextWithOIDC } from 'oidc-provider';

/**
 * `loadExistingGrant` — issue the consent Grant without an interaction hop.
 * docs/SSO_WEBSITE_ENTRY_PLAN.md §4.4.
 *
 * 🔴 This changes WHEN consent is granted, and it fails toward granting. It is only
 * correct because every client in `oidc_clients` is first-party — the same decision
 * the consent branch in interaction/routes.ts already made, where consent is
 * auto-approved and no screen is ever shown. This grants exactly what that branch
 * grants (the requested OIDC scopes), just before the prompt is evaluated instead of
 * after a redirect to it. The moment a third-party client is registered, BOTH places
 * must learn to tell it apart and ask.
 *
 * Why it matters: without it, a first sign-in to an app (and the first after the
 * Grant's 14-day expiry) always takes a consent interaction. A normal login absorbs
 * that as one more invisible redirect, but `prompt=none` cannot interact at all, so
 * silent sign-in answered `consent_required` for exactly the users arriving for the
 * first time — which reads as "silent SSO works for some people".
 *
 * The library calls this only once an account is established, and then checks the
 * returned grant's account and client itself (load_grant.js).
 */
export async function loadFirstPartyGrant(ctx: KoaContextWithOIDC): Promise<Grant | undefined> {
  const { oidc } = ctx;
  const clientId = oidc.client?.clientId;
  const accountId = oidc.account?.accountId;
  if (!clientId || !accountId) return undefined;

  // The library default's lookup, unchanged: a consent result from this request,
  // else the grant this session already holds for the client.
  const grantId = oidc.result?.consent?.grantId ?? oidc.session?.grantIdFor(clientId);
  const existing = grantId ? await oidc.provider.Grant.find(grantId) : undefined;

  const encountered = new Set(existing?.getOIDCScopeEncountered().split(' ') ?? []);
  const missing = [...oidc.requestParamOIDCScopes].filter((scope) => !encountered.has(scope));
  if (existing && missing.length === 0) return existing;

  // Widen the existing grant rather than starting a second one, as approveConsent does.
  const grant = existing ?? new oidc.provider.Grant({ accountId, clientId });
  grant.addOIDCScope(missing);
  await grant.save();
  return grant;
}
