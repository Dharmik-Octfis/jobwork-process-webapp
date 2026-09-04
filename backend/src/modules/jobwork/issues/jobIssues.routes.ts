import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  cancelJobIssueSchema,
  createJobIssueSchema,
  updateJobIssueSchema,
} from './jobIssues.schemas.ts';
import {
  cancelIssue,
  createJobIssue,
  deleteJobIssue,
  getJobIssue,
  getJobIssueCount,
  getJobIssues,
  postJobIssue,
  updateJobIssue,
} from './jobIssues.controller.ts';

/**
 * Mounted at `/organizations/:orgId/jobwork/issues`.
 *
 * 🔴 PUT AND DELETE EXIST ONLY FOR A DRAFT, and the old rule is unchanged
 * underneath them. A POSTED challan has moved stock; the only legal correction is
 * a cancellation that posts the opposite rows (inventory.prisma). Editing one
 * would leave the document saying a quantity its ledger rows contradict, with
 * nothing to reconcile the two.
 *
 * A draft is the state BEFORE that rule applies: no ledger row has been written,
 * so there is nothing for an edit to contradict. Both handlers re-check the
 * status inside the transaction and refuse anything past `draft` — the routes are
 * open, the service is the gate, exactly as with every other rule here.
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

// Editing a parked draft — `update`, the permission the catalog has always
// granted and nothing enforced until now.
router.put(
  '/:id',
  requirePermission('job_issue:update'),
  validateBody(updateJobIssueSchema),
  updateJobIssue,
);

// Posting is gated on `create`, not `update`: it is the act that brings a real
// challan into existence and moves stock. Someone trusted to correct a draft is
// not automatically trusted to send goods out of the godown.
router.post('/:id/post', requirePermission('job_issue:create'), postJobIssue);

// Only ever a draft — the service refuses anything else. A posted challan is
// cancelled below, which posts reversing rows rather than removing anything.
router.delete('/:id', requirePermission('job_issue:delete'), deleteJobIssue);

// Cancelling is gated on `delete`: it is the closest thing to removing a
// document this module has, and it un-does a stock movement.
router.post(
  '/:id/cancel',
  requirePermission('job_issue:delete'),
  validateBody(cancelJobIssueSchema),
  cancelIssue,
);

export { router as jobIssuesRouter };
