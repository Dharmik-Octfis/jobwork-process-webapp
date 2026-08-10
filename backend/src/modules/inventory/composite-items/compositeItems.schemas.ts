import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createItemSchema } from '../../items/items.schemas.ts';

extendZodWithOpenApi(z);

export const compositeComponentSchema = z.object({
  id: z.string().uuid(),
  composite_item_id: z.string().uuid(),
  component_item_id: z.string().uuid(),
  qty_per_unit: z.number(),
  uom_id: z.string().uuid().nullable().optional(),
  seq: z.number().int().min(0).default(0),
  notes: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
  created_at: z.date(),
  updated_at: z.date(),
  created_by: z.string().uuid().nullable(),
  updated_by: z.string().uuid().nullable(),
  is_deleted: z.boolean(),
});

export const createCompositeComponentSchema = z.object({
  component_item_id: z.string().uuid(),
  qty_per_unit: z.number().min(0.000001),
  uom_id: z.string().uuid().nullable().optional(),
  seq: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
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
