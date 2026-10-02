import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.js';
import { tenantContext } from '../../../middlewares/tenantContext.js';
import { requirePermission } from '../../../middlewares/authorize.js';
import { validateBody } from '../../../middlewares/validate.js';
import { createAdjustmentSchema } from './adjustments.schemas.js';
import {
  cancelAdjustment,
  createAdjustment,
  getAdjustmentById,
  getAdjustments,
} from './adjustments.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('stock_adjustment:read'), getAdjustments);
router.get('/:id', requirePermission('stock_adjustment:read'), getAdjustmentById);
router.post(
  '/',
  requirePermission('stock_adjustment:create'),
  validateBody(createAdjustmentSchema),
  createAdjustment,
);
// No PATCH: a posted adjustment is never edited. DELETE cancels it — the rows
// are reversed and the document stays listed as cancelled.
router.delete('/:id', requirePermission('stock_adjustment:delete'), cancelAdjustment);

export const adjustmentsRouter = router;
