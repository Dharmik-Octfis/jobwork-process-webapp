import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getInventoryValuation, getItemLedger } from './inventoryValuation.controller.ts';

// We use mergeParams to get access to :orgId from the parent router
export const inventoryValuationRouter = Router({ mergeParams: true });

inventoryValuationRouter.use(authenticate, tenantContext);

// Use reports:read as the required permission for all reports
inventoryValuationRouter.get(
  '/',
  requirePermission('reports:read'),
  getInventoryValuation
);

inventoryValuationRouter.get(
  '/:itemId',
  requirePermission('reports:read'),
  getItemLedger
);

