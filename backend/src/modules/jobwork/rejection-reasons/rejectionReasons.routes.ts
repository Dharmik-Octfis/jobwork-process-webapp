import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  createRejectionReasonSchema,
  updateRejectionReasonSchema,
} from './rejectionReasons.schemas.ts';
import {
  createRejectionReason,
  deleteRejectionReason,
  getRejectionReason,
  getRejectionReasonCount,
  getRejectionReasons,
  updateRejectionReason,
} from './rejectionReasons.controller.ts';

/** Mounted at `/organizations/:orgId/jobwork/rejection-reasons`. */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('rejection_reason:read'), getRejectionReasons);
router.post(
  '/',
  requirePermission('rejection_reason:create'),
  validateBody(createRejectionReasonSchema),
  createRejectionReason,
);

router.get('/count', requirePermission('rejection_reason:read'), getRejectionReasonCount);
router.get('/:id', requirePermission('rejection_reason:read'), getRejectionReason);
router.put(
  '/:id',
  requirePermission('rejection_reason:update'),
  validateBody(updateRejectionReasonSchema),
  updateRejectionReason,
);
router.delete('/:id', requirePermission('rejection_reason:delete'), deleteRejectionReason);

export { router as rejectionReasonsRouter };
