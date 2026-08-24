import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../../config/env.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { ssoConfig } from './sso.service.ts';

/**
 * Verification of an OIDC back-channel logout token — §10.2.
 *
 * 🔴 This endpoint's whole job is to end sessions on the say-so of an unauthenticated
 * POST. Every check below is what stops anyone on the network from logging out any
 * user they can name, so none of them is optional and none is a formality.
 *
 * The rules are from the OpenID Connect Back-Channel Logout spec, §2.6 "Logout Token
 * Validation", not invented here.
 */

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/** JWKS is fetched once and cached by `jose`, with its own rotation handling. */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (jwks) return jwks;

  const config = await ssoConfig();
  const uri = config.serverMetadata().jwks_uri;
  if (!uri) throw new ApiError(500, 'The identity provider publishes no jwks_uri.');

  jwks = createRemoteJWKSet(new URL(uri));
  return jwks;
}

export interface LogoutTokenClaims {
  /** Present when one browser session is being ended. */
  sid?: string | undefined;
  /** Present when the whole account is being ended everywhere. */
  sub?: string | undefined;
}

export async function verifyLogoutToken(token: unknown): Promise<LogoutTokenClaims> {
  if (typeof token !== 'string' || token.length === 0) {
    throw ApiError.badRequest('logout_token is required.');
  }

  let payload: JWTPayload;
  try {
    // Signature, `iss` and `aud` are checked here. `aud` matters as much as the
    // signature: without it, a logout token the IdP legitimately minted for a
    // DIFFERENT app would be replayable against this one.
    ({ payload } = await jwtVerify(token, await getJwks(), {
      issuer: env.sso.issuer!,
      audience: env.sso.clientId!,
      // The spec requires a recent `iat`; this bounds replay of a captured token.
      maxTokenAge: '2 minutes',
    }));
  } catch {
    // Never echo the underlying reason. The caller is a machine, and the detail
    // would only help someone probing which part of their forgery was wrong.
    throw ApiError.badRequest('Invalid logout token.');
  }

  // The `events` claim is what makes this a LOGOUT token rather than an ID token.
  // Without this check an ordinary ID token — which any client can obtain simply by
  // signing in — would be accepted here and could log its own owner out anywhere.
  const events = payload['events'];
  if (
    typeof events !== 'object' ||
    events === null ||
    !Object.prototype.hasOwnProperty.call(events, LOGOUT_EVENT)
  ) {
    throw ApiError.badRequest('Invalid logout token.');
  }

  /**
   * 🔴 A `nonce` is FORBIDDEN here, and the spec says so explicitly. Its presence is
   * the tell that this is an ID token being passed off as a logout token — exactly
   * the confusion the `events` check above also guards. Two checks, because this one
   * costs nothing and the attack is a total account-logout primitive.
   */
  if ('nonce' in payload) throw ApiError.badRequest('Invalid logout token.');

  const sid = typeof payload['sid'] === 'string' ? payload['sid'] : undefined;
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;

  // At least one must be present, or there is nothing to act on and a blind
  // `updateMany` with an undefined filter would revoke every session in the table.
  if (!sid && !sub) throw ApiError.badRequest('Invalid logout token.');

  return { sid, sub };
}
