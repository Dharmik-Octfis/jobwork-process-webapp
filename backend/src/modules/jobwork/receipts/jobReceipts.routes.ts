import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  cancelJobReceiptSchema,
  createJobReceiptSchema,
  updateJobReceiptSchema,
} from './jobReceipts.schemas.ts';
import {
  cancelReceipt,
  createJobReceipt,
  deleteJobReceipt,
  getBatchOptions,
  getJobReceipt,
  getJobReceiptCount,
  getJobReceipts,
  getPrefill,
  postJobReceipt,
  updateJobReceipt,
} from './jobReceipts.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/receipts`.
 *
 * 🔴 PUT AND DELETE REACH A DRAFT ONLY, and the old rule holds underneath them
 * exactly as on the issue side: a POSTED receipt has created batches and moved
 * stock, and its only legal correction is a cancellation that posts the opposite
 * rows. A draft created nothing, so there is nothing for an edit to contradict.
 * Both handlers re-check the status inside the transaction.
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
// Gated on `create`, like the prefill beside it: it exists only to fill in a
// receipt being written, and it reads batch data that `batch:read` also covers.
router.get('/batch-options', requirePermission('job_receipt:create'), getBatchOptions);

router.get('/:id', requirePermission('job_receipt:read'), getJobReceipt);

// Editing a parked draft — `update`, granted by the catalog since the module
// landed and enforced by nothing until now.
router.put(
  '/:id',
  requirePermission('job_receipt:update'),
  validateBody(updateJobReceiptSchema),
  updateJobReceipt,
);

// Posting is gated on `create`, not `update`: it is what brings the goods into
// stock and creates their batches. Correcting a draft is not that.
router.post('/:id/post', requirePermission('job_receipt:create'), postJobReceipt);

// Only ever a draft — the service refuses anything else.
router.delete('/:id', requirePermission('job_receipt:delete'), deleteJobReceipt);

router.post(
  '/:id/cancel',
  requirePermission('job_receipt:delete'),
  validateBody(cancelJobReceiptSchema),
  cancelReceipt,
);

export { router as jobReceiptsRouter };
