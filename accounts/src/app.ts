import express, { type Express } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './db/prisma.ts';

/**
 * The accounts service's HTTP surface.
 *
 * 🔴 No CORS, deliberately. Every exchange with this service is either a top-level
 * browser redirect (`/authorize`, `/login`, logout) or a server-to-server call
 * from an app's backend (`/token`, `/jwks`). Nothing legitimate makes a
 * cross-origin XHR here, so an `Access-Control-Allow-Origin` header would only
 * ever widen what a hostile page can do with a logged-in user's cookie. If a
 * discovery endpoint ever genuinely needs it, allow it on that route alone.
 */
export function createApp(): Express {
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
       * §11's cross-tab check embeds this origin in an iframe on an app's page.
       * helmet's default `frame-ancestors: 'none'` would block exactly that, so
       * the policy has to be set per route when that endpoint is built — not
       * loosened globally here.
       */
      contentSecurityPolicy: { directives: { 'frame-ancestors': ["'none'"] } },
    }),
  );
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

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

  return app;
}
