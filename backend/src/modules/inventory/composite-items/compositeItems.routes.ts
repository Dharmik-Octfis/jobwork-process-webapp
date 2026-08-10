import { Router } from 'express';
import { compositeItemsController } from './compositeItems.controller.ts';
import { createCompositeComponentSchema, updateCompositeComponentSchema } from './compositeItems.schemas.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';

const router = Router({ mergeParams: true });

router.get('/', requirePermission('composite_item:read'), compositeItemsController.getComponents);
router.post(
  '/',
  requirePermission('composite_item:create'),
  validateBody(createCompositeComponentSchema),
  compositeItemsController.createComponent,
);
router.get('/:id', requirePermission('composite_item:read'), compositeItemsController.getComponent);
router.put(
  '/:id',
  requirePermission('composite_item:update'),
  validateBody(updateCompositeComponentSchema),
  compositeItemsController.updateComponent,
);
router.delete('/:id', requirePermission('composite_item:delete'), compositeItemsController.deleteComponent);

export const compositeItemsRouter = router;
