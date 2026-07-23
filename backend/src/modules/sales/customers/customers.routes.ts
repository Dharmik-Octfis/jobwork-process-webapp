import { Router } from 'express';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, getCustomer, getCustomerActivitiesRoute, getCustomerCommentsRoute, createCustomerCommentRoute, deleteCustomerCommentRoute, getNumberPreferenceRoute, updateNumberPreferenceRoute } from './customers.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';

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

router.get('/', getCustomers);
router.post('/', createCustomer);

router.get('/preferences/number-sequence', getNumberPreferenceRoute);
router.put('/preferences/number-sequence', updateNumberPreferenceRoute);

router.get('/:id', getCustomer);
router.get('/:id/activities', getCustomerActivitiesRoute);
router.get('/:id/comments', getCustomerCommentsRoute);
router.post('/:id/comments', createCustomerCommentRoute);
router.delete('/:id/comments/:commentId', deleteCustomerCommentRoute);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);

export { router as customersRouter };
