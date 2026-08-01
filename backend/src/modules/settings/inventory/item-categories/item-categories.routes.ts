import { Router } from 'express';
import { authenticate } from '../../../../middlewares/authenticate.ts';
import { tenantContext } from '../../../../middlewares/tenantContext.ts';
import { requirePermission } from '../../../../middlewares/authorize.ts';
import {
  createHandler,
  updateHandler,
  deleteHandler,
  listHandler,
} from './item-categories.controller.ts';
import { validateBody } from '../../../../middlewares/validate.ts';
import { createItemCategorySchema, updateItemCategorySchema } from './item-categories.schemas.ts';

const router = Router({ mergeParams: true });

router.use(authenticate, tenantContext);

router.post(
  '/',
  requirePermission('item:create'),
  validateBody(createItemCategorySchema),
  createHandler
);

router.put(
  '/:id',
  requirePermission('item:update'),
  validateBody(updateItemCategorySchema),
  updateHandler
);

router.delete(
  '/:id',
  requirePermission('item:delete'),
  deleteHandler
);

router.get(
  '/',
  requirePermission('item:read'),
  listHandler
);

export { router as itemCategoriesRouter };
