import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getSalesOrdersReportRoute } from './salesOrdersReport.controller.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('reports:read'), getSalesOrdersReportRoute);

export default router;
