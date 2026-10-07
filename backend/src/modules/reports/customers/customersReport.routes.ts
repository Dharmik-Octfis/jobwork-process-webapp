import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getCustomersReportRoute } from './customersReport.controller.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// Requires reports:read permission to view reports
router.get('/', requirePermission('reports:read'), getCustomersReportRoute);

export { router as customersReportRouter };
