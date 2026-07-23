import { Router } from 'express';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import {
  getPaymentTerms,
  createPaymentTerm,
} from './payment-terms.controller.ts';

export const paymentTermsRouter = Router({ mergeParams: true });

paymentTermsRouter.use(authenticate);
paymentTermsRouter.use(tenantContext);

paymentTermsRouter.get('/', getPaymentTerms);
paymentTermsRouter.post('/', createPaymentTerm);
