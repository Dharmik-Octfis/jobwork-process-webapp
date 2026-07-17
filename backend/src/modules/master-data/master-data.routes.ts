import { Router } from 'express';
import { getMasterData } from './master-data.controller.ts';
import { itemsRouter } from './items/items.routes.ts';
import { authenticate } from '../../middlewares/authenticate.ts';
import { tenantContext } from '../../middlewares/tenantContext.ts';

const masterDataRouter = Router({ mergeParams: true });

masterDataRouter.use(authenticate, tenantContext);

masterDataRouter.get('/', getMasterData);
masterDataRouter.use('/items', itemsRouter);

export { masterDataRouter };
