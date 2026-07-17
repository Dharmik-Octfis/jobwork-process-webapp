import { Router } from 'express';
import { itemsController } from './items.controller.ts';
import { openApiRegistry } from '../../../config/openapi.ts';
import { itemSchema, createItemSchema, updateItemSchema } from './items.schemas.ts';
import { z } from 'zod';

openApiRegistry.registerPath({
  method: 'get',
  path: '/organizations/{orgId}/master-data/items',
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
  path: '/organizations/{orgId}/master-data/items',
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
  path: '/organizations/{orgId}/master-data/items/{id}',
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
  path: '/organizations/{orgId}/master-data/items/{id}',
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
  path: '/organizations/{orgId}/master-data/items/{id}',
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

const router = Router({ mergeParams: true });

router.get('/', itemsController.getItems);
router.post('/', itemsController.createItem);
router.get('/:id', itemsController.getItem);
router.put('/:id', itemsController.updateItem);
router.delete('/:id', itemsController.deleteItem);

export const itemsRouter = router;
