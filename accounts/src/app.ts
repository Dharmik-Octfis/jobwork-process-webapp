import express, { type Express } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './db/prisma.ts';
import { createOidcProvider } from './oidc/provider.ts';

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

  app.use(
    helmet({
      /**
       * §11's cross-tab check will embed this origin in an iframe on an app's page,
       * and will need `frame-ancestors` relaxed on that ONE route when it is built.
       * Denying everywhere is the right default until then.
       */
      contentSecurityPolicy: { directives: { 'frame-ancestors': ["'none'"] } },
    }),
  );
  app.use(cookieParser());

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
    prisma
      .$queryRaw`SELECT 1`
      .then(() => res.json({ status: 'ready' }))
      .catch(next);
  });

  const provider = await createOidcProvider();

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
