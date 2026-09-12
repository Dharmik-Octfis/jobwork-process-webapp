import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { getInventoryValuation, getItemLedger } from './inventoryValuation.controller.ts';

// We use mergeParams to get access to :orgId from the parent router
export const inventoryValuationRouter = Router({ mergeParams: true });

inventoryValuationRouter.use(authenticate, tenantContext);

// Use batch:read as the required permission for this report since it accesses stock ledger info
inventoryValuationRouter.get(
  '/',
  requirePermission('batch:read'),
  getInventoryValuation
);

inventoryValuationRouter.get(
  '/:itemId',
  requirePermission('batch:read'),
  getItemLedger
);

