import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.ts';
import { tenantContext } from '../../middlewares/tenantContext.ts';
import { requirePermission } from '../../middlewares/authorize.ts';
import { validateBody } from '../../middlewares/validate.ts';
import {
  listReportsRoute,
  recordVisitRoute,
  setFavoriteRoute,
  setFavoriteSchema,
} from './reports.controller.ts';

/**
 * Mounted at `/organizations/:orgId/reports`, AFTER the individual report
 * routers (routes/index.ts). Every route acts on the caller's own rows only —
 * the user comes from `req.user`, never from the request.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('reports:read'), listReportsRoute);
router.post('/:reportKey/visit', requirePermission('reports:read'), recordVisitRoute);
router.put(
  '/:reportKey/favorite',
  requirePermission('reports:read'),
  validateBody(setFavoriteSchema),
  setFavoriteRoute,
);

export { router as reportsRouter };
