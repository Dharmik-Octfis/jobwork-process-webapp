import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import * as ctrl from './sales-orders.controller.ts';

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
  },
});

export const salesOrderRouter = Router({ mergeParams: true });

salesOrderRouter.use(authenticate, tenantContext);

salesOrderRouter.get('/', requirePermission('sales_order:read'), ctrl.getSalesOrders);
salesOrderRouter.get('/count', requirePermission('sales_order:read'), ctrl.getSalesOrderCount);
salesOrderRouter.get(
  '/preferences/number-sequence',
  requirePermission('sales_order:read'),
  ctrl.getNumberPreferenceRoute,
);
salesOrderRouter.put(
  '/preferences/number-sequence',
  requirePermission('sales_order:create'),
  validateBody(ctrl.numberPreferenceSchema),
  ctrl.updateNumberPreferenceRoute,
);
salesOrderRouter.post('/', requirePermission('sales_order:create'), ctrl.createSalesOrder);
salesOrderRouter.post(
  '/attachments/upload',
  requirePermission('sales_order:create'),
  upload.array('files', 2),
  ctrl.uploadAttachments,
);
salesOrderRouter.get('/attachments/signed-url', requirePermission('sales_order:read'), ctrl.getSignedUrl);
salesOrderRouter.get('/:id', requirePermission('sales_order:read'), ctrl.getSalesOrder);
salesOrderRouter.get('/:id/activities', requirePermission('sales_order:read'), ctrl.getSalesOrderActivitiesRoute);
salesOrderRouter.get('/:id/comments', requirePermission('sales_order:read'), ctrl.getSalesOrderCommentsRoute);
salesOrderRouter.post('/:id/comments', requirePermission('sales_order:update'), ctrl.createSalesOrderCommentRoute);
salesOrderRouter.delete(
  '/:id/comments/:commentId',
  requirePermission('sales_order:update'),
  ctrl.deleteSalesOrderCommentRoute,
);
salesOrderRouter.patch('/:id', requirePermission('sales_order:update'), ctrl.updateSalesOrder);
salesOrderRouter.delete('/:id', requirePermission('sales_order:delete'), ctrl.deleteSalesOrder);
