import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.ts';
import { validateBody } from '../../middlewares/validate.ts';
import * as authController from './auth.controller.ts';
import { loginSchema, signupSchema } from './auth.schemas.ts';

/**
 * URL wiring only — no logic (architecture §4).
 *
 * DEFERRED: `POST /auth/logout` and `POST /auth/refresh`. Both need the
 * rotating refresh-token cookie from §3.8, which needs a `refresh_tokens`
 * table that doesn't exist yet. Today logout is purely client-side: drop the
 * in-memory access token. `web/src/api/endpoints.ts` already names the logout
 * path; nothing calls it.
 */
export const authRouter = Router();

authRouter.post('/signup', validateBody(signupSchema), authController.signup);
authRouter.post('/login', validateBody(loginSchema), authController.login);
authRouter.get('/me', authenticate, authController.me);
