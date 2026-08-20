import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createItemSchema } from '../../items/items.schemas.ts';

extendZodWithOpenApi(z);

export const compositeComponentSchema = z.object({
  id: z.string().uuid(),
  compositeItemId: z.string().uuid(),
  componentItemId: z.string().uuid(),
  qtyPerUnit: z.number(),
  uomId: z.string().uuid().nullable().optional(),
  seq: z.number().int().min(0).default(0),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  isDeleted: z.boolean(),
});

export const createCompositeComponentSchema = z.object({
  componentItemId: z.string().uuid(),
  qtyPerUnit: z.number().min(0.000001),
  uomId: z.string().uuid().nullable().optional(),
  seq: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateCompositeComponentSchema = createCompositeComponentSchema.partial();

export const createCompositeItemSchema = createItemSchema.omit({ itemType: true }).extend({
  components: z.array(createCompositeComponentSchema).optional(),
});

export const updateCompositeItemSchema = createCompositeItemSchema.partial();

export type CreateCompositeComponentDto = z.infer<typeof createCompositeComponentSchema>;
export type UpdateCompositeComponentDto = z.infer<typeof updateCompositeComponentSchema>;
export type CreateCompositeItemDto = z.infer<typeof createCompositeItemSchema>;
export type UpdateCompositeItemDto = z.infer<typeof updateCompositeItemSchema>;
