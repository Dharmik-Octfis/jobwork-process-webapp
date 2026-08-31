import { resolve } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';
import { pinPublicOrigin } from './lib/publicOrigin.ts';
import { createOidcProvider } from './oidc/provider.ts';
import { clientOrigins } from './oidc/clients.ts';
import { interactionRouter } from './interaction/routes.ts';
import { accountRouter } from './login/account.routes.ts';

/**
 * The accounts service's HTTP surface.
 *
 * 🔴 No CORS, deliberately. Every exchange with this service is either a top-level
 * browser redirect (`/authorize`, `/login`, logout) or a server-to-server call from
 * an app's backend (`/token`, `/jwks`). Nothing legitimate makes a cross-origin XHR
 * here, so an `Access-Control-Allow-Origin` header would only ever widen what a
 * hostile page can do with a logged-in user's cookie.
 */
export async function createApp(): Promise<Express> {
  const app = express();

  /**
   * `trust proxy` matters more here than in the app. AppSail terminates TLS in
   * front of us, so without it Express sees `http` and would refuse to set the
   * `Secure` SSO cookie — an outage that looks like "login silently does nothing".
   */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // `trust proxy` above is what makes Express read the header this sets. AppSail
  // sends no `X-Forwarded-Proto` of its own, so without this every URL the provider
  // advertises is `http://` — see the note on `pinPublicOrigin`.
  app.use(pinPublicOrigin(env.oidcIssuer));

  /**
   * Read once at boot, like the client registry itself — see the note on
   * `form-action` below for what these are for and why `'self'` alone is not enough.
   * ⚠️ Same restart-to-pick-up-a-new-client caveat as `loadClients()`.
   */
  const redirectOrigins = await clientOrigins();

  app.use(
    helmet({
      /**
       * No HSTS outside production. Chrome treats `localhost` as a secure origin, so
       * it accepts an HSTS header sent over plain HTTP and caches it for a year — for
       * `localhost` as a whole, `includeSubDomains` and all, which covers every port
       * and so every service on this machine. Nothing here is reachable over HTTPS,
       * so that is pure breakage, and it OUTLIVES the fix: removing the header does
       * not clear what a browser already stored (chrome://net-internals/#hsts does).
       *
       * It stays on in production, where the service is genuinely HTTPS.
       */
      strictTransportSecurity: env.isProduction,
      contentSecurityPolicy: {
        directives: {
          /**
           * §11's cross-tab check will embed this origin in an iframe on an app's
           * page, and will need `frame-ancestors` relaxed on that ONE route when it
           * is built. Denying everywhere is the right default until then.
           */
          'frame-ancestors': ["'none'"],

          /**
           * 🔴 `'self'` is NOT enough, and this is the directive that decides
           * whether signing in works at all.
           *
           * A browser enforces `form-action` across the entire REDIRECT CHAIN a
           * submission causes, not just its immediate target. The sign-in form
           * posts same-origin, but the response chain then hops to the app:
           *
           *     POST /interaction/:uid/login → /auth/:uid → app callback → app
           *
           * so with `'self'` alone the browser blocks the submission — and reports
           * it against the form's own same-origin action, which reads as the policy
           * contradicting itself. Diagnosed 2026-08-25 after two wrong guesses.
           *
           * ⚠️ Nothing about this is specific to localhost. In production the chain
           * is accounts.octfis.com → jobwork.octfis.com, still cross-origin, so this
           * would have failed there in exactly the same way.
           *
           * The allowed origins come from the client registry, so they are exactly
           * the redirect targets an administrator already approved — bounded, and
           * self-maintaining as clients are added.
           */
          'form-action': ["'self'", ...redirectOrigins],

          /**
           * Dropped outside production: it rewrites every same-origin request from
           * `http://` to `https://`, and there is no HTTPS listener on localhost, so
           * over plain HTTP it turns working requests into failed ones.
           *
           * It stays ON in production, where the service is HTTPS and the directive
           * is doing real work.
           */
          ...(env.isProduction ? {} : { 'upgrade-insecure-requests': null }),
        },
      },
    }),
  );
  app.use(cookieParser());

  /**
   * The only two static paths: the show/hide password toggle, and the brand images.
   *
   * Same origin, so helmet's defaults (`script-src 'self'`, `img-src 'self' data:`)
   * already allow both and no CSP is relaxed to make them work — which is the whole
   * reason the logo is a copy here rather than the app's `cliq.zoho.com` URL.
   *
   * `immutable` is deliberately NOT set: these sit on a page with a password field,
   * and being unable to ship a fix without a cache-busting rename is not a trade
   * worth making for three small files.
   *
   * Mounted at their own prefixes, never `public/` at the root — a static mount at
   * `/` would shadow whatever protocol path the library adds next.
   */
  for (const dir of ['js', 'assets']) {
    app.use(
      `/${dir}`,
      express.static(resolve(process.cwd(), `public/${dir}`), {
        maxAge: '1h',
        // Never fall through to the OIDC catch-all with a directory listing or an
        // index.html; a miss here is a miss.
        index: false,
        redirect: false,
      }),
    );
  }

  /**
   * The root — see the note on `DEFAULT_APP_SIGNIN_URL`.
   *
   * 🔴 Not a landing page, because this service cannot host one: a session is only
   * ever created by finishing an interaction, and only `/authorize` starts one. So
   * `/` hands the visitor to the default app's sign-in entry point, which starts a
   * real authorization request and comes straight back — to the app if they already
   * have a session here, to this service's own sign-in page if they do not.
   *
   * 302, not 301: the default app is configuration and will change. A 301 is cached
   * by the browser more or less forever, so getting this wrong once would outlive
   * the fix.
   */
  app.get('/', (_req, res) => {
    res.set('X-Robots-Tag', 'noindex').redirect(302, env.defaultAppSigninUrl);
  });

  /**
   * Liveness only — no database. A health check that queries the database turns a
   * brief database blip into a rolling restart of every instance, which is how a
   * recoverable incident becomes an outage.
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'accounts' });
  });

  /** Readiness — this one does check the database, because that is its job. */
  app.get('/health/ready', (_req, res, next) => {
    prisma.$queryRaw`SELECT 1`.then(() => res.json({ status: 'ready' })).catch(next);
  });

  const provider = await createOidcProvider();

  /**
   * The login screens, mounted BEFORE the provider so `/interaction/:uid` reaches
   * them rather than the catch-all below. They bring their own body parser, per
   * route — see the note in interaction/routes.ts.
   */
  app.use(interactionRouter(provider));

  /** Signup, email verification and password reset — also before the catch-all. */
  app.use(accountRouter());

  /**
   * 🔴 Mounted LAST, at the root, and with no body parser in front of it.
   *
   * `oidc-provider` is a Koa app that parses its own request bodies. An
   * `express.json()` or `urlencoded()` above it consumes the stream first, and the
   * token endpoint then sees an empty body and rejects every exchange — with an
   * error that points at the client rather than at the middleware that ate it.
   * Routes needing a parsed body must add it per-route, above this line.
   */
  app.use('/', provider.callback());

  return app;
}
