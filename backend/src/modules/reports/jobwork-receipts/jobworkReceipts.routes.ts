import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getJobworkReceiptsHandler } from './jobworkReceipts.controller.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('reports:read'), getJobworkReceiptsHandler);

export { router as jobworkReceiptsRouter };
