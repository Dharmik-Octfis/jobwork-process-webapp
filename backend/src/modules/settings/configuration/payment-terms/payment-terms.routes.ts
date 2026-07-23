import { Router } from 'express';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createPaymentTermSchema } from './payment-terms.schemas.js';
import { getPaymentTerms, createPaymentTerm } from './payment-terms.controller.ts';

export const paymentTermsRouter = Router({ mergeParams: true });

paymentTermsRouter.use(authenticate);
paymentTermsRouter.use(tenantContext);

paymentTermsRouter.get('/', requirePermission('payment_term:read'), getPaymentTerms);
paymentTermsRouter.post(
  '/',
  requirePermission('payment_term:create'),
  validateBody(createPaymentTermSchema),
  createPaymentTerm,
);
