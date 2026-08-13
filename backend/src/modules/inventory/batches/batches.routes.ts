import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import {
  getAvailable,
  getLocations,
  getBatch,
  getBatchCount,
  getBatches,
} from './batches.controller.ts';

/**
 * Mounted at `/organizations/:orgId/inventory/batches`.
 *
 * 🔴 GET ONLY. There is no POST, PUT or DELETE here and there must not be — a batch
 * is created by the document that physically brought the material in, never by a
 * form (batches.service.ts). That is also why `batch` is registered in
 * `permissions.catalog.ts` with `read` alone: a `batch:create` checkbox would
 * describe a screen that does not exist.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('batch:read'), getBatches);
// Both before '/:id', or each is captured as a batch id.
router.get('/count', requirePermission('batch:read'), getBatchCount);
router.get('/available', requirePermission('batch:read'), getAvailable);
router.get('/locations', requirePermission('batch:read'), getLocations);
router.get('/:id', requirePermission('batch:read'), getBatch);

export { router as batchesRouter };
