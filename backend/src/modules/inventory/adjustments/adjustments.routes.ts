import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.js';
import { tenantContext } from '../../../middlewares/tenantContext.js';
import { requirePermission } from '../../../middlewares/authorize.js';
import { validateBody } from '../../../middlewares/validate.js';
import { saveAdjustmentSchema } from './adjustments.schemas.js';
import {
  adjustAdjustment,
  createAdjustment,
  getAdjustmentById,
  getAdjustments,
  getCurrentValues,
  getFifoCost,
  removeAdjustment,
  updateAdjustment,
} from './adjustments.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('stock_adjustment:read'), getAdjustments);
// Before `/:id`, or "fifo-cost" is read as an adjustment id.
router.get('/fifo-cost', requirePermission('stock_adjustment:read'), getFifoCost);
router.get('/current-values', requirePermission('stock_adjustment:read'), getCurrentValues);
router.get('/:id', requirePermission('stock_adjustment:read'), getAdjustmentById);
router.post(
  '/',
  requirePermission('stock_adjustment:create'),
  validateBody(saveAdjustmentSchema),
  createAdjustment,
);
// Only an adjustment that has not posted can be replaced; a posted one is
// never edited.
router.put(
  '/:id',
  requirePermission('stock_adjustment:update'),
  validateBody(saveAdjustmentSchema),
  updateAdjustment,
);
// Posting is what `create` grants, whether it happens on save or later.
router.post('/:id/adjust', requirePermission('stock_adjustment:create'), adjustAdjustment);
// Cancels a posted adjustment (reversed, stays listed) or deletes an unposted one.
router.delete('/:id', requirePermission('stock_adjustment:delete'), removeAdjustment);

export const adjustmentsRouter = router;
