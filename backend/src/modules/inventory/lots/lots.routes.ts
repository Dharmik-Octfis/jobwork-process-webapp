import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getAvailable, getLocations, getLot, getLotCount, getLots } from './lots.controller.ts';

/**
 * Mounted at `/organizations/:orgId/inventory/lots`.
 *
 * 🔴 GET ONLY. There is no POST, PUT or DELETE here and there must not be — a lot
 * is created by the document that physically brought the material in, never by a
 * form (lots.service.ts). That is also why `lot` is registered in
 * `permissions.catalog.ts` with `read` alone: a `lot:create` checkbox would
 * describe a screen that does not exist.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('lot:read'), getLots);
// Both before '/:id', or each is captured as a lot id.
router.get('/count', requirePermission('lot:read'), getLotCount);
router.get('/available', requirePermission('lot:read'), getAvailable);
router.get('/locations', requirePermission('lot:read'), getLocations);
router.get('/:id', requirePermission('lot:read'), getLot);

export { router as lotsRouter };
