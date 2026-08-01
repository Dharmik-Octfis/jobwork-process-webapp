import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { openApiRegistry } from '../../../../config/openapi.ts';

extendZodWithOpenApi(z);

export const itemCategorySchema = openApiRegistry.register(
  'ItemCategory',
  z.object({
    id: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    organizationId: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
    name: z.string().min(1, 'Name is required').max(200).openapi({ example: 'Electronics' }),
    parentId: z.string().uuid().nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().default(true).openapi({ example: true }),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    createdBy: z.string().nullable().optional(),
    updatedBy: z.string().nullable().optional(),
  }),
);

export const createItemCategorySchema = openApiRegistry.register(
  'CreateItemCategoryRequest',
  itemCategorySchema.omit({
    id: true,
    organizationId: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    updatedBy: true,
  }),
);

export const updateItemCategorySchema = openApiRegistry.register(
  'UpdateItemCategoryRequest',
  createItemCategorySchema.partial(),
);

export type ItemCategory = z.infer<typeof itemCategorySchema>;
export type CreateItemCategoryDto = z.infer<typeof createItemCategorySchema>;
export type UpdateItemCategoryDto = z.infer<typeof updateItemCategorySchema>;
