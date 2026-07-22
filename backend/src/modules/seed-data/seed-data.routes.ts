import { Router } from 'express';
import { getSeedData } from './seed-data.controller.ts';
import { authenticate } from '../../middlewares/authenticate.ts';
import { tenantContext } from '../../middlewares/tenantContext.ts';

const globalSeedDataRouter = Router();
globalSeedDataRouter.use(authenticate);
globalSeedDataRouter.get('/', getSeedData);

const tenantSeedDataRouter = Router({ mergeParams: true });
tenantSeedDataRouter.use(authenticate, tenantContext);

export { globalSeedDataRouter, tenantSeedDataRouter };
