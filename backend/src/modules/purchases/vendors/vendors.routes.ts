import { Router } from 'express';
import {
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendor,
  getVendorActivitiesRoute,
  getVendorCommentsRoute,
  createVendorCommentRoute,
  deleteVendorCommentRoute,
  getNumberPreferenceRoute,
  updateNumberPreferenceRoute,
} from './vendors.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { createVendorSchema, numberPreferenceSchema } from './vendors.controller.ts';

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

// Each mutating/reading route is gated on the matching permission. Reads need
// `vendor:read`; writes need the specific action. Comments/activities are part of
// a vendor, so they ride on vendor:read (view) / vendor:update (annotate).
router.get('/', requirePermission('vendor:read'), getVendors);
router.post(
  '/',
  requirePermission('vendor:create'),
  validateBody(createVendorSchema),
  createVendor,
);

router.get(
  '/preferences/number-sequence',
  requirePermission('vendor:read'),
  getNumberPreferenceRoute,
);
router.put(
  '/preferences/number-sequence',
  requirePermission('vendor:update'),
  validateBody(numberPreferenceSchema),
  updateNumberPreferenceRoute,
);

router.get('/:id', requirePermission('vendor:read'), getVendor);
router.get('/:id/activities', requirePermission('vendor:read'), getVendorActivitiesRoute);
router.get('/:id/comments', requirePermission('vendor:read'), getVendorCommentsRoute);
router.post('/:id/comments', requirePermission('vendor:update'), createVendorCommentRoute);
router.delete(
  '/:id/comments/:commentId',
  requirePermission('vendor:update'),
  deleteVendorCommentRoute,
);
router.put(
  '/:id',
  requirePermission('vendor:update'),
  validateBody(createVendorSchema),
  updateVendor,
);
router.delete('/:id', requirePermission('vendor:delete'), deleteVendor);

export { router as vendorsRouter };
