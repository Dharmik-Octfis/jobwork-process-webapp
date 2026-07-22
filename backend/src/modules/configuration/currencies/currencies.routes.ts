import { Router } from 'express';
import { getCurrencies, createCurrency, getCurrency, updateCurrency, deleteCurrency } from './currencies.controller.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', getCurrencies);
router.post('/', createCurrency);
router.get('/:id', getCurrency);
router.put('/:id', updateCurrency);
router.delete('/:id', deleteCurrency);

export { router as currenciesRouter };
