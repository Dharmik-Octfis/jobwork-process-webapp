import { join, sep } from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.ts';
import swaggerUi from 'swagger-ui-express';
import { generateOpenApiDocument } from './config/openapi.ts';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.ts';
import { apiRouter } from './routes/index.ts';

/** Builds the Express app: middleware, then routes, then error handling. */
export function createApp(): express.Express {
  const app = express();

  // Gzip everything compressible — the JS bundle is ~1 MB raw and ~250 KB gzipped,
  // and AppSail does not compress for us. Mounted FIRST so it wraps `res.write`
  // before any route or static handler gets hold of it; mounted after them it
  // silently does nothing. Images and fonts are already compressed formats, and
  // `compression` skips them by content-type on its own.
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable CSP for now so frontend assets load without issues
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // API Routes
  app.use('/api', apiRouter);

  // Swagger UI Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(generateOpenApiDocument()));

  // The Vite build (web/) is emitted into `public/` so it ships inside the same
  // AppSail bundle as the API. Same origin, so no CORS and no cross-site cookie.
  const publicDir = join(process.cwd(), 'public');

  /**
   * 🔴 Two cache policies, and mixing them up breaks a deploy in one of two ways.
   *
   * Vite content-hashes everything it emits into `assets/` (`index-B3K6vjQH.js`),
   * so a given URL's bytes can never change — a new build produces a new name.
   * Those are safe to cache for a year, and `immutable` additionally tells the
   * browser not to even revalidate on reload.
   *
   * `index.html` is the opposite: its URL is fixed and its contents change on
   * every deploy, because it carries the <script src> pointing at the new hashed
   * bundle. Cache it and browsers keep requesting the PREVIOUS build's assets,
   * which no longer exist — the app 404s until someone hard-refreshes. So it gets
   * `no-cache`, meaning "revalidate every time" (not "never store"): the usual
   * 304 costs one round trip and is what makes a deploy land immediately.
   */
  function setStaticHeaders(res: express.Response, filePath: string): void {
    const isHashedAsset = filePath.includes(`${sep}assets${sep}`);
    res.setHeader(
      'Cache-Control',
      isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  }

  app.use(express.static(publicDir, { setHeaders: setStaticHeaders }));

  // React Router owns every non-API route, so a hard refresh on /login must get
  // index.html back rather than a 404 from the API's notFoundHandler.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    // Same reasoning as above — this is the un-hashed entry point, so it must
    // revalidate or a deploy never reaches an already-open browser.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(publicDir, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
