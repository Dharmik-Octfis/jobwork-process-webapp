import { Router } from 'express';
import {
  getCurrencies,
  createCurrency,
  getCurrency,
  updateCurrency,
  deleteCurrency,
} from './currencies.controller.ts';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createCurrencySchema, updateCurrencySchema } from './currencies.schemas.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

// `validateBody` parses and normalizes the body BEFORE the handler, so a bad
// payload becomes a 400 with field errors and the controller never needs a
// try/catch around `schema.parse()`.
router.get('/', requirePermission('currency:read'), getCurrencies);
router.post(
  '/',
  requirePermission('currency:create'),
  validateBody(createCurrencySchema),
  createCurrency,
);
router.get('/:id', requirePermission('currency:read'), getCurrency);
router.put(
  '/:id',
  requirePermission('currency:update'),
  validateBody(updateCurrencySchema),
  updateCurrency,
);
router.delete('/:id', requirePermission('currency:delete'), deleteCurrency);

export { router as currenciesRouter };
