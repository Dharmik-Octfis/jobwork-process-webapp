import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import * as ctrl from './bills.controller.ts';

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
  },
});

export const billsRouter = Router({ mergeParams: true });

billsRouter.use(authenticate, tenantContext);

billsRouter.get('/', requirePermission('bill:read'), ctrl.getBills);
billsRouter.get('/count', requirePermission('bill:read'), ctrl.getBillCount);
billsRouter.get(
  '/preferences/number-sequence',
  requirePermission('bill:read'),
  ctrl.getNumberPreferenceRoute,
);
billsRouter.put(
  '/preferences/number-sequence',
  requirePermission('bill:create'),
  validateBody(ctrl.numberPreferenceSchema),
  ctrl.updateNumberPreferenceRoute,
);
billsRouter.post('/', requirePermission('bill:create'), ctrl.createBill);
billsRouter.post(
  '/attachments/upload',
  requirePermission('bill:create'),
  upload.array('files', 2),
  ctrl.uploadAttachments,
);
billsRouter.get('/attachments/signed-url', requirePermission('bill:read'), ctrl.getSignedUrl);
billsRouter.get('/:id', requirePermission('bill:read'), ctrl.getBill);
billsRouter.get('/:id/activities', requirePermission('bill:read'), ctrl.getBillActivitiesRoute);
billsRouter.get('/:id/comments', requirePermission('bill:read'), ctrl.getBillCommentsRoute);
billsRouter.post('/:id/comments', requirePermission('bill:update'), ctrl.createBillCommentRoute);
billsRouter.delete(
  '/:id/comments/:commentId',
  requirePermission('bill:update'),
  ctrl.deleteBillCommentRoute,
);
billsRouter.patch('/:id', requirePermission('bill:update'), ctrl.updateBill);
billsRouter.delete('/:id', requirePermission('bill:delete'), ctrl.deleteBill);
