import type { RequestHandler } from 'express';

/**
 * 🔴 The public origin comes from `OIDC_ISSUER`, never from the request.
 *
 * AppSail terminates TLS, forwards the original `Host` (with `:443`) and sets no
 * `X-Forwarded-Proto`, so Koa falls back to the plain socket and every URL the
 * provider advertises came out `http://accounts.octfis.com:443/...` while `issuer`
 * — read from config — stayed correct. A discovery document that disagrees with
 * itself: `openid-client` refuses plain HTTP outside localhost
 * (backend `sso.service.ts`), so the flow dies AFTER discovery succeeds, which
 * reads as "SSO is broken" rather than "one header is missing".
 *
 * Deriving from config rather than trusting the header also closes a Host-header
 * poisoning vector: with `trust proxy` on, a forged `X-Forwarded-Host` would
 * otherwise put an attacker's origin into the authorization URLs we hand a browser.
 */
export function pinPublicOrigin(issuer: string): RequestHandler {
  const { protocol, host } = new URL(issuer);
  const proto = protocol.slice(0, -1); // "https:" -> "https"

  return (req, _res, next) => {
    req.headers['x-forwarded-proto'] = proto;
    req.headers['x-forwarded-host'] = host;
    next();
  };
}
