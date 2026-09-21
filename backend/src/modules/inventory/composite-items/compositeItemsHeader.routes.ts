import { Router } from 'express';
import { compositeItemsHeaderController } from './compositeItemsHeader.controller.ts';
import { createCompositeItemSchema, updateCompositeItemSchema } from './compositeItems.schemas.ts';
import { requirePermission } from '../../../middlewares/authorize.ts';
import { validateBody } from '../../../middlewares/validate.ts';
import { authenticate } from '../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../middlewares/tenantContext.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.get('/', requirePermission('composite_item:read'), compositeItemsHeaderController.getItems);
router.get('/count', requirePermission('composite_item:read'), compositeItemsHeaderController.getItemCount);

router.post(
  '/',
  requirePermission('composite_item:create'),
  validateBody(createCompositeItemSchema),
  compositeItemsHeaderController.createItem,
);

router.get('/:id', requirePermission('composite_item:read'), compositeItemsHeaderController.getItem);

router.put(
  '/:id',
  requirePermission('composite_item:update'),
  validateBody(updateCompositeItemSchema),
  compositeItemsHeaderController.updateItem,
);

router.delete('/:id', requirePermission('composite_item:delete'), compositeItemsHeaderController.deleteItem);

export const compositeItemsHeaderRouter = router;
