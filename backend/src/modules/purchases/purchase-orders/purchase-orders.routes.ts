import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import * as ctrl from './purchase-orders.controller.ts';

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
  },
});

export const purchaseOrdersRouter = Router({ mergeParams: true });

purchaseOrdersRouter.use(authenticate, tenantContext);

purchaseOrdersRouter.get('/', requirePermission('purchase_order:read'), ctrl.getPurchaseOrders);
purchaseOrdersRouter.get('/count', requirePermission('purchase_order:read'), ctrl.getPurchaseOrderCount);
purchaseOrdersRouter.get(
  '/preferences/number-sequence',
  requirePermission('purchase_order:read'),
  ctrl.getNumberPreferenceRoute,
);
purchaseOrdersRouter.put(
  '/preferences/number-sequence',
  requirePermission('purchase_order:create'),
  validateBody(ctrl.numberPreferenceSchema),
  ctrl.updateNumberPreferenceRoute,
);
purchaseOrdersRouter.post('/', requirePermission('purchase_order:create'), ctrl.createPurchaseOrder);
purchaseOrdersRouter.post(
  '/attachments/upload',
  requirePermission('purchase_order:create'),
  upload.array('files', 2),
  ctrl.uploadAttachments,
);
purchaseOrdersRouter.get('/attachments/signed-url', requirePermission('purchase_order:read'), ctrl.getSignedUrl);
purchaseOrdersRouter.get('/:id', requirePermission('purchase_order:read'), ctrl.getPurchaseOrder);
purchaseOrdersRouter.get('/:id/activities', requirePermission('purchase_order:read'), ctrl.getPurchaseOrderActivitiesRoute);
purchaseOrdersRouter.get('/:id/comments', requirePermission('purchase_order:read'), ctrl.getPurchaseOrderCommentsRoute);
purchaseOrdersRouter.post('/:id/comments', requirePermission('purchase_order:update'), ctrl.createPurchaseOrderCommentRoute);
purchaseOrdersRouter.delete(
  '/:id/comments/:commentId',
  requirePermission('purchase_order:update'),
  ctrl.deletePurchaseOrderCommentRoute,
);
purchaseOrdersRouter.patch('/:id', requirePermission('purchase_order:update'), ctrl.updatePurchaseOrder);
purchaseOrdersRouter.delete('/:id', requirePermission('purchase_order:delete'), ctrl.deletePurchaseOrder);
