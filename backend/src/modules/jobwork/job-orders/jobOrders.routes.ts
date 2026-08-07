import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import {
  createJobOrderSchema,
  shortCloseSchema,
  updateJobOrderSchema,
} from './jobOrders.schemas.ts';
import {
  createJobOrder,
  deleteJobOrder,
  getJobOrder,
  getJobOrderCount,
  getJobOrders,
  getNumberPreferenceRoute,
  getOverview,
  numberPreferenceSchema,
  shortClose,
  updateJobOrder,
  updateNumberPreferenceRoute,
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
// The stepper page. A read, so it is gated on `read` — the Issue and Receive
// buttons it renders are gated separately by their own modules' routes.
router.get('/:id/overview', requirePermission('job_order:read'), getOverview);
router.put(
  '/:id',
  requirePermission('job_order:update'),
  validateBody(updateJobOrderSchema),
  updateJobOrder,
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
router.delete('/:id', requirePermission('job_order:delete'), deleteJobOrder);

export { router as jobOrdersRouter };
