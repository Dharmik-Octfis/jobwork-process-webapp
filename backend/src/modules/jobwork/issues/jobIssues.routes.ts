import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { cancelJobIssueSchema, createJobIssueSchema } from './jobIssues.schemas.ts';
import {
  cancelIssue,
  createJobIssue,
  getJobIssue,
  getJobIssueCount,
  getJobIssues,
} from './jobIssues.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/issues`.
 *
 * 🔴 There is no PUT and no DELETE, and that is not an omission. A posted challan
 * has moved stock; the only legal correction is a cancellation that posts the
 * opposite rows (inventory.prisma). An `update` route would let someone edit the
 * quantity on a document whose ledger rows say something else, and nothing would
 * ever reconcile the two.
 */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('job_issue:read'), getJobIssues);
router.post(
  '/',
  requirePermission('job_issue:create'),
  validateBody(createJobIssueSchema),
  createJobIssue,
);

router.get('/count', requirePermission('job_issue:read'), getJobIssueCount);
router.get('/:id', requirePermission('job_issue:read'), getJobIssue);

// Cancelling is gated on `delete`: it is the closest thing to removing a
// document this module has, and it un-does a stock movement.
router.post(
  '/:id/cancel',
  requirePermission('job_issue:delete'),
  validateBody(cancelJobIssueSchema),
  cancelIssue,
);

export { router as jobIssuesRouter };
