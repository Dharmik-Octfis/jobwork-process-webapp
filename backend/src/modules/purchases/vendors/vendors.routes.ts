import { Router } from 'express';
import { getVendors, createVendor } from './vendors.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { requireOrganization } from '../../../middlewares/require-organization.ts';

const router = Router();

router.use(authenticate, requireOrganization);

router.get('/', getVendors);
router.post('/', createVendor);

export { router as vendorsRouter };
