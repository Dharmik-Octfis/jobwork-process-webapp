import { Router } from 'express';
import { getVendors, createVendor } from './vendors.controller.ts';
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

export { router as vendorsRouter };
