import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.ts';
import { organizationsRouter } from '../modules/organizations/organizations.routes.ts';
import { invitationsRouter } from '../modules/invitations/invitations.routes.ts';
import { masterDataRouter } from '../modules/master-data/master-data.routes.ts';

/** Mounts every module router under `/api` (architecture §4). */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/invitations', invitationsRouter);
apiRouter.use('/master-data', masterDataRouter);
