import { Router } from 'express';
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

authRouter.post('/signup', validateBody(signupSchema), authController.signup);
authRouter.post('/login', validateBody(loginSchema), authController.login);
authRouter.post('/refresh-token', authController.refresh);
authRouter.post('/logout', authController.logout);
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
authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);
