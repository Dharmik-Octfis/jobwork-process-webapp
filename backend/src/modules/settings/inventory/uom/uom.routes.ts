import { Router } from 'express';
import { getUoms, createUom, getUom, updateUom, deleteUom } from './uom.controller.ts';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createUomSchema, updateUomSchema } from './uom.schemas.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('uom:read'), getUoms);
router.post('/', requirePermission('uom:create'), validateBody(createUomSchema), createUom);
router.get('/:id', requirePermission('uom:read'), getUom);
router.put('/:id', requirePermission('uom:update'), validateBody(updateUomSchema), updateUom);
router.delete('/:id', requirePermission('uom:delete'), deleteUom);

export { router as uomRouter };
