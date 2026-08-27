import { Router } from 'express';
import { env } from '../../config/env.ts';
import { authenticate } from '../../middlewares/authenticate.ts';
import { validateBody } from '../../middlewares/validate.ts';
import * as authController from './auth.controller.ts';
import {
  loginSchema,
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  updateLocationSchema,
  changePasswordSchema,
} from './auth.schemas.ts';

import { openApiRegistry } from '../../config/openapi.ts';

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/signup',
  tags: ['Auth'],
  summary: 'Sign up a new user',
  request: {
    body: {
      content: { 'application/json': { schema: signupSchema } },
    },
  },
  responses: {
    201: { description: 'User created successfully' },
    400: { description: 'Validation failed' },
    409: { description: 'User with this email already exists' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Log in a user',
  request: {
    body: {
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: { description: 'User logged in successfully' },
    400: { description: 'Validation failed' },
    401: { description: 'Invalid credentials' },
  },
});

import multer from 'multer';

const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

export const authRouter = Router();

authRouter.get('/config', authController.authConfig);

/**
 * 🔴 The four ways a local password can be created or used, and therefore the four
 * routes that must NOT exist once SSO is on.
 *
 * Hiding the forms in the web app is not enforcement — it is a suggestion. Left
 * mounted, `POST /auth/signup` still answers 201 to anything that asks, so anyone
 * with curl could keep minting local accounts with local passwords, each one a way
 * into this app that the identity provider knows nothing about and cannot disable.
 * Verified: before this guard, that request created an account.
 *
 * `forgot-password` and `reset-password` belong here for the same reason and are
 * easy to miss — a password reset SETS a password, so leaving them is leaving a way
 * to give any existing account a local credential and sign in with it.
 *
 * Not mounted at all rather than returning 403: an absent route cannot be reached
 * by a stale client, and the 404 says plainly that this app no longer does this.
 *
 * ⚠️ `change-password` below is deliberately left alone. It needs a live session AND
 * the current password, so it is not a way IN — and an account that predates the
 * cutover may still legitimately have a local password to change.
 */
if (!env.sso.enabled) {
  authRouter.post('/signup', validateBody(signupSchema), authController.signup);
  authRouter.post('/login', validateBody(loginSchema), authController.login);
  authRouter.post(
    '/forgot-password',
    validateBody(forgotPasswordSchema),
    authController.forgotPassword,
  );
  authRouter.post(
    '/reset-password',
    validateBody(resetPasswordSchema),
    authController.resetPassword,
  );
}
authRouter.post('/refresh-token', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/session', authenticate, authController.sessionStatus);
authRouter.get('/me', authenticate, authController.me);
authRouter.get('/me/sessions', authenticate, authController.mySessions);
authRouter.put(
  '/me',
  authenticate,
  validateBody(updateProfileSchema),
  authController.updateProfile,
);
authRouter.post(
  '/me/location',
  authenticate,
  validateBody(updateLocationSchema),
  authController.updateLocation,
);
authRouter.post('/me/avatar', authenticate, upload.single('avatar'), authController.uploadAvatar);
authRouter.delete('/me/avatar', authenticate, authController.deleteAvatar);

authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  authController.changePassword,
);
// `/forgot-password` and `/reset-password` are registered above, inside the
// `!env.sso.enabled` guard — both SET a local password, so both are ways in.
