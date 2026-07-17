import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.ts';
import { organizationsRouter } from '../modules/organizations/organizations.routes.ts';
import { invitationsRouter } from '../modules/invitations/invitations.routes.ts';
import { masterDataRouter } from '../modules/master-data/master-data.routes.ts';
import { appModulesRouter } from '../modules/app-modules/app-modules.routes.ts';
import { vendorsRouter } from '../modules/purchases/vendors/vendors.routes.ts';

/** Mounts every module router under `/api` (architecture §4). */
export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);

// Tenant-scoped modules nest under `/organizations/:orgId/…` so the organization
// is part of the URL: explicit, bookmarkable, and shareable. `tenantContext`
// reads `:orgId` and verifies membership before any handler runs.
//
// Registered BEFORE `/organizations` deliberately. Express matches in mount
// order, and `use('/organizations', …)` also matches this longer path — it would
// hand the request to organizationsRouter, find no route, and fall through here
// anyway, but only after running that router's `authenticate` a second time.
// Specific before general keeps the path short and the middleware chain honest.
apiRouter.use('/organizations/:orgId/purchases/vendors', vendorsRouter);
apiRouter.use('/organizations/:orgId/master-data', masterDataRouter);

apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/invitations', invitationsRouter);
apiRouter.use('/modules', appModulesRouter);
