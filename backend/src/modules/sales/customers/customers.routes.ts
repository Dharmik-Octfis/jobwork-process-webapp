import { Router } from 'express';
import {
  getCustomers,
  getCustomerCount,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerActivitiesRoute,
  getCustomerCommentsRoute,
  createCustomerCommentRoute,
  deleteCustomerCommentRoute,
  getNumberPreferenceRoute,
  updateNumberPreferenceRoute,
} from './customers.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { createCustomerSchema, numberPreferenceSchema } from './customers.controller.ts';

/**
 * Mounted at `/organizations/:orgId/sales/customers` (routes/index.ts).
 *
 * `mergeParams: true` is load-bearing: without it a nested router cannot see the
 * parent's `:orgId`, `req.params.orgId` is undefined, and `tenantContext` 400s
 * every request. It fails loudly rather than silently, but it is not obvious.
 */
const router = Router({ mergeParams: true });

// Order matters: `authenticate` establishes who you are; `tenantContext` then
// proves you belong to the organization named in the URL before any handler runs.
router.use(authenticate, tenantContext);

// Every route carries a permission. Without these the module has NO gate and any
// member can do anything — it fails open and silently (CLAUDE.md "Module
// conventions"). Comments/activities belong to a customer, so they ride on
// customer:read (view) / customer:update (annotate).
router.get('/', requirePermission('customer:read'), getCustomers);
router.post(
  '/',
  requirePermission('customer:create'),
  validateBody(createCustomerSchema),
  createCustomer,
);

// Before '/:id' — otherwise '/count' is captured as a customer id.
router.get('/count', requirePermission('customer:read'), getCustomerCount);

router.get(
  '/preferences/number-sequence',
  requirePermission('customer:read'),
  getNumberPreferenceRoute,
);
router.put(
  '/preferences/number-sequence',
  requirePermission('customer:update'),
  validateBody(numberPreferenceSchema),
  updateNumberPreferenceRoute,
);

router.get('/:id', requirePermission('customer:read'), getCustomer);
router.get('/:id/activities', requirePermission('customer:read'), getCustomerActivitiesRoute);
router.get('/:id/comments', requirePermission('customer:read'), getCustomerCommentsRoute);
router.post('/:id/comments', requirePermission('customer:update'), createCustomerCommentRoute);
router.delete(
  '/:id/comments/:commentId',
  requirePermission('customer:update'),
  deleteCustomerCommentRoute,
);
router.put(
  '/:id',
  requirePermission('customer:update'),
  validateBody(createCustomerSchema),
  updateCustomer,
);
router.delete('/:id', requirePermission('customer:delete'), deleteCustomer);

export { router as customersRouter };
