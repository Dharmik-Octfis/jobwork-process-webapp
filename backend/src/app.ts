import { join } from 'node:path';
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
