import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.ts';
import { validateBody } from '../../middlewares/validate.ts';
import * as authController from './auth.controller.ts';
import { loginSchema, signupSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema } from './auth.schemas.ts';


export const authRouter = Router();

authRouter.post('/signup', validateBody(signupSchema), authController.signup);
authRouter.post('/login', validateBody(loginSchema), authController.login);
authRouter.post('/refresh-token', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authenticate, authController.me);
authRouter.put('/me', authenticate, validateBody(updateProfileSchema), authController.updateProfile);

authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), authController.forgotPassword);
authRouter.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);