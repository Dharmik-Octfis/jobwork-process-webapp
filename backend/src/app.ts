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

  // Order matters: 404 for unmatched routes, then the error handler last so it
  // sees everything the routers throw.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
