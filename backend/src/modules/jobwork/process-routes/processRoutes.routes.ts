import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { createRouteSchema, updateRouteSchema } from './processRoutes.schemas.ts';
import {
  createRoute,
  deleteRoute,
  getRoute,
  getRouteCount,
  getRoutes,
  updateRoute,
} from './processRoutes.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/routes`.
 *
 * Named `processRoutes.*` rather than `routes.*` on purpose (plan §8.1): this
 * directory already has a `src/routes/` and a `*.routes.ts` per module, and a
 * file called `routes.routes.ts` is a coin flip every time someone opens it.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// 🔴 Every route carries a `requirePermission`. Missing one fails OPEN and
// silently — the route has no gate and every member of the org can use it.
router.get('/', requirePermission('process_route:read'), getRoutes);
router.post(
  '/',
  requirePermission('process_route:create'),
  validateBody(createRouteSchema),
  createRoute,
);

// Before '/:id', or '/count' is captured as a route id.
router.get('/count', requirePermission('process_route:read'), getRouteCount);

router.get('/:id', requirePermission('process_route:read'), getRoute);
router.put(
  '/:id',
  requirePermission('process_route:update'),
  validateBody(updateRouteSchema),
  updateRoute,
);
router.delete('/:id', requirePermission('process_route:delete'), deleteRoute);

export { router as processRoutesRouter };
