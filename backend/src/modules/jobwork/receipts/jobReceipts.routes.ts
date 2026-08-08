import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { cancelJobReceiptSchema, createJobReceiptSchema } from './jobReceipts.schemas.ts';
import {
  cancelReceipt,
  createJobReceipt,
  getJobReceipt,
  getJobReceiptCount,
  getJobReceipts,
  getPrefill,
} from './jobReceipts.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/receipts`.
 *
 * No PUT, for the same reason Issues has none: a posted receipt has created lots
 * and moved stock, and the only legal correction is a cancellation that posts the
 * opposite rows.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('job_receipt:read'), getJobReceipts);
router.post(
  '/',
  requirePermission('job_receipt:create'),
  validateBody(createJobReceiptSchema),
  createJobReceipt,
);

// Both before '/:id'.
router.get('/count', requirePermission('job_receipt:read'), getJobReceiptCount);
router.get('/prefill', requirePermission('job_receipt:create'), getPrefill);

router.get('/:id', requirePermission('job_receipt:read'), getJobReceipt);
router.post(
  '/:id/cancel',
  requirePermission('job_receipt:delete'),
  validateBody(cancelJobReceiptSchema),
  cancelReceipt,
);

export { router as jobReceiptsRouter };
