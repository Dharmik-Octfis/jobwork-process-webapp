import { Router } from 'express';
import { getStockSummary } from './stockSummary.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('reports:read'), getStockSummary);

export const stockSummaryRouter = router;
