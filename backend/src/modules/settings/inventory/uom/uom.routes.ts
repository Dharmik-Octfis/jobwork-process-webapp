import { Router } from 'express';
import { getUoms, createUom, getUom, updateUom, deleteUom } from './uom.controller.ts';

import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', getUoms);
router.post('/', createUom);
router.get('/:id', getUom);
router.put('/:id', updateUom);
router.delete('/:id', deleteUom);

export { router as uomRouter };
