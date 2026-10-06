import { Router } from 'express';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import * as ctrl from './invoices.controller.ts';

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per file
  },
});

export const invoiceRouter = Router({ mergeParams: true });

invoiceRouter.use(authenticate, tenantContext);

invoiceRouter.get('/', requirePermission('invoice:read'), ctrl.getInvoices);
invoiceRouter.get('/count', requirePermission('invoice:read'), ctrl.getInvoiceCount);
invoiceRouter.get(
  '/preferences/number-sequence',
  requirePermission('invoice:read'),
  ctrl.getNumberPreferenceRoute,
);
invoiceRouter.put(
  '/preferences/number-sequence',
  requirePermission('invoice:create'),
  validateBody(ctrl.numberPreferenceSchema),
  ctrl.updateNumberPreferenceRoute,
);
invoiceRouter.post('/', requirePermission('invoice:create'), ctrl.createInvoice);
invoiceRouter.post(
  '/attachments/upload',
  requirePermission('invoice:create'),
  upload.array('files', 2),
  ctrl.uploadAttachments,
);
invoiceRouter.get('/attachments/signed-url', requirePermission('invoice:read'), ctrl.getSignedUrl);
invoiceRouter.get('/:id', requirePermission('invoice:read'), ctrl.getInvoice);
invoiceRouter.get('/:id/activities', requirePermission('invoice:read'), ctrl.getInvoiceActivitiesRoute);
invoiceRouter.get('/:id/comments', requirePermission('invoice:read'), ctrl.getInvoiceCommentsRoute);
invoiceRouter.post('/:id/comments', requirePermission('invoice:update'), ctrl.createInvoiceCommentRoute);
invoiceRouter.delete(
  '/:id/comments/:commentId',
  requirePermission('invoice:update'),
  ctrl.deleteInvoiceCommentRoute,
);
invoiceRouter.patch('/:id', requirePermission('invoice:update'), ctrl.updateInvoice);
invoiceRouter.delete('/:id', requirePermission('invoice:delete'), ctrl.deleteInvoice);




