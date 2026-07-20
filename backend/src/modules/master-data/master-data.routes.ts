import { Router } from 'express';
import { getMasterData } from './master-data.controller.ts';
import { itemsRouter } from './items/items.routes.ts';
import { authenticate } from '../../middlewares/authenticate.ts';
import { tenantContext } from '../../middlewares/tenantContext.ts';

const globalMasterDataRouter = Router();
globalMasterDataRouter.use(authenticate);
globalMasterDataRouter.get('/', getMasterData);

const tenantMasterDataRouter = Router({ mergeParams: true });
tenantMasterDataRouter.use(authenticate, tenantContext);
tenantMasterDataRouter.use('/items', itemsRouter);

export { globalMasterDataRouter, tenantMasterDataRouter };
