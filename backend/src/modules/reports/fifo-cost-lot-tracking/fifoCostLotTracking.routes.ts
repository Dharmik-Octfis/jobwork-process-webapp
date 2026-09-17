import { Router } from 'express';
import { getFifoCostLotTrackingController } from './fifoCostLotTracking.controller.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get(
  '/',
  requirePermission('reports:read'),
  getFifoCostLotTrackingController
);

export default router;
