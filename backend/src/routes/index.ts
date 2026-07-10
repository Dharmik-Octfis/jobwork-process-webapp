import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.ts';

/** Mounts every module router under `/api` (architecture §4). */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
