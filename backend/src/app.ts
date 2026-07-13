import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.ts';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.ts';
import { apiRouter } from './routes/index.ts';

/** Builds the Express app: middleware, then routes, then error handling. */
export function createApp(): express.Express {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: env.corsOrigins,
      // The frontend sends the access token in a header today, but §3.8's
      // refresh cookie will need this, and the client already sets
      // `withCredentials: true`.
      credentials: true,
    }),
  );

  // A signup body is a few hundred bytes. The default 100kb limit is already
  // generous; there's no route here that should accept more.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  // The Vite build (web/) is emitted into `public/` so it ships inside the same
  // AppSail bundle as the API. Same origin, so no CORS and no cross-site cookie.
  const publicDir = join(process.cwd(), 'public');

  app.use(express.static(publicDir));

  // React Router owns every non-API route, so a hard refresh on /login must get
  // index.html back rather than a 404 from the API's notFoundHandler.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(join(publicDir, 'index.html'));
  });

  // Order matters: 404 for unmatched routes, then the error handler last so it
  // sees everything the routers throw.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
