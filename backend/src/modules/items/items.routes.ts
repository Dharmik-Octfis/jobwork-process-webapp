import { Router } from 'express';
import { itemsController } from './items.controller.ts';
import { openApiRegistry } from '../../config/openapi.ts';
import { itemSchema, createItemSchema, updateItemSchema } from './items.schemas.ts';
import { z } from 'zod';
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/items',
  tags: ['Items'],
  summary: 'Get all items',
  request: {
    params: z.object({ orgId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'List of items',
      content: {
        'application/json': {
          schema: z.array(itemSchema),
        },
      },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/items',
  tags: ['Items'],
  summary: 'Create a new item',
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: createItemSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Item created successfully',
      content: {
        'application/json': {
          schema: itemSchema,
        },
      },
    },
    400: { description: 'Validation failed' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/items/{id}',
  tags: ['Items'],
  summary: 'Get item by ID',
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Item object',
      content: {
        'application/json': {
          schema: itemSchema,
        },
      },
    },
    404: { description: 'Item not found' },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/organizations/{orgId}/items/{id}',
  tags: ['Items'],
  summary: 'Update an existing item',
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: updateItemSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Item updated successfully',
      content: {
        'application/json': {
          schema: itemSchema,
        },
      },
    },
    400: { description: 'Validation failed' },
    404: { description: 'Item not found' },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/organizations/{orgId}/items/{id}',
  tags: ['Items'],
  summary: 'Delete an item',
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Item deleted successfully' },
    404: { description: 'Item not found' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/organizations/{orgId}/items/{id}/images',
  tags: ['Items'],
  summary: 'Upload images for an item',
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            frontImage: z.any().optional(),
            rearImage: z.any().optional(),
            images: z.array(z.any()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Images uploaded successfully',
      content: {
        'application/json': {
          schema: itemSchema,
        },
      },
    },
    404: { description: 'Item not found' },
  },
});

import { authenticate } from '../../middlewares/authenticate.ts';
import { tenantContext } from '../../middlewares/tenantContext.ts';
import { requirePermission } from '../../middlewares/authorize.ts';
import { validateBody } from '../../middlewares/validate.ts';

const router = Router({ mergeParams: true });
router.use(authenticate, tenantContext);
router.get('/', requirePermission('item:read'), itemsController.getItems);
router.post(
  '/',
  requirePermission('item:create'),
  validateBody(createItemSchema),
  itemsController.createItem,
);
// Before '/:id' — otherwise '/count' is captured as an item id.
router.get('/count', requirePermission('item:read'), itemsController.getItemCount);
router.get('/:id', requirePermission('item:read'), itemsController.getItem);
router.get('/:id/activities', requirePermission('item:read'), itemsController.getItemActivities);
router.get('/:id/signed-url', requirePermission('item:read'), itemsController.getSignedUrl);
router.put(
  '/:id',
  requirePermission('item:update'),
  validateBody(updateItemSchema),
  itemsController.updateItem,
);
router.delete('/:id', requirePermission('item:delete'), itemsController.deleteItem);

router.post(
  '/:id/images',
  requirePermission('item:update'),
  upload.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'rearImage', maxCount: 1 },
    { name: 'images', maxCount: 3 },
  ]),
  itemsController.uploadImages,
);

export const itemsRouter = router;
