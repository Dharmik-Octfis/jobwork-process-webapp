import { Router } from 'express';
import { getVendors, createVendor, updateVendor, deleteVendor, getVendor, getVendorActivitiesRoute, getVendorCommentsRoute, createVendorCommentRoute, deleteVendorCommentRoute, getNumberPreferenceRoute, updateNumberPreferenceRoute } from './vendors.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';

/**
 * Mounted at `/organizations/:orgId/purchases/vendors` (routes/index.ts).
 *
 * `mergeParams: true` is load-bearing: without it a nested router cannot see the
 * parent's `:orgId`, `req.params.orgId` is undefined, and `tenantContext` 400s
 * every request. It fails loudly rather than silently, but it is not obvious.
 */
const router = Router({ mergeParams: true });

// Order matters: `authenticate` establishes who you are; `tenantContext` then
// proves you belong to the organization named in the URL before any handler runs.
router.use(authenticate, tenantContext);

router.get('/', getVendors);
router.post('/', createVendor);

router.get('/preferences/number-sequence', getNumberPreferenceRoute);
router.put('/preferences/number-sequence', updateNumberPreferenceRoute);

router.get('/:id', getVendor);
router.get('/:id/activities', getVendorActivitiesRoute);
router.get('/:id/comments', getVendorCommentsRoute);
router.post('/:id/comments', createVendorCommentRoute);
router.delete('/:id/comments/:commentId', deleteVendorCommentRoute);
router.put('/:id', updateVendor);
router.delete('/:id', deleteVendor);

export { router as vendorsRouter };
