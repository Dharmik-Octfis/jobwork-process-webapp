import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  appendJobOrderStepsSchema,
  createJobOrderSchema,
  shortCloseSchema,
  updateJobOrderSchema,
} from './jobOrders.schemas.ts';
import {
  appendSteps,
  createJobOrder,
  deleteJobOrder,
  getJobOrder,
  getJobOrderWithSteps,
  getJobOrderCount,
  getJobOrders,
  getNumberPreferenceRoute,
  getOverview,
  getOverviewActivity,
  numberPreferenceSchema,
  shortClose,
  updateJobOrder,
  updateNumberPreferenceRoute,
  completeStep,
} from './jobOrders.controller.ts';

/** Mounted at `/organizations/:orgId/jobwork/job-orders`. */
const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('job_order:read'), getJobOrders);
router.post(
  '/',
  requirePermission('job_order:create'),
  validateBody(createJobOrderSchema),
  createJobOrder,
);

// Before '/:id', or '/count' is captured as a job order id.
router.get('/count', requirePermission('job_order:read'), getJobOrderCount);

// Also before '/:id'. Reading the series is part of opening the form, so it rides
// on `read`; changing it renumbers every future order, so it takes `update`.
router.get(
  '/preferences/number-sequence',
  requirePermission('job_order:read'),
  getNumberPreferenceRoute,
);
router.put(
  '/preferences/number-sequence',
  requirePermission('job_order:update'),
  validateBody(numberPreferenceSchema),
  updateNumberPreferenceRoute,
);

router.get('/:id', requirePermission('job_order:read'), getJobOrder);
router.get('/:id/with-steps', requirePermission('job_order:read'), getJobOrderWithSteps);
// The stepper page. A read, so it is gated on `read` — the Issue and Receive
// buttons it renders are gated separately by their own modules' routes.
router.get('/:id/overview', requirePermission('job_order:read'), getOverview);
// Same page, same authority — the feed is only the rest of the Overview, split
// off because it is the part whose size grows with the order's age.
router.get('/:id/overview/activity', requirePermission('job_order:read'), getOverviewActivity);
router.put(
  '/:id',
  requirePermission('job_order:update'),
  validateBody(updateJobOrderSchema),
  updateJobOrder,
);
/**
 * Appending a step is an `update` on the order, not a `create` of its own: it is
 * the same authority as editing the grid while the order is still a draft, just
 * narrowed to the one change a released order can take safely.
 */
router.post(
  '/:id/steps',
  requirePermission('job_order:update'),
  validateBody(appendJobOrderStepsSchema),
  appendSteps,
);
/**
 * Closing short is an `update`, not a `delete`. It ends the order but destroys
 * nothing, and the people allowed to run the shop floor are the ones who decide
 * that 4,850 m is close enough to 5,000.
 */
router.post(
  '/:id/short-close',
  requirePermission('job_order:update'),
  validateBody(shortCloseSchema),
  shortClose,
);

router.post('/:id/steps/:stepId/complete', requirePermission('job_order:update'), completeStep);

router.delete('/:id', requirePermission('job_order:delete'), deleteJobOrder);

export { router as jobOrdersRouter };
