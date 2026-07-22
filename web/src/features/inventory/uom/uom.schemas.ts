import { z } from 'zod';

export const uomSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  unitName: z.string(),
  symbol: z.string(),
  uqc: z.string(),
  unitPrecision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Uom = z.infer<typeof uomSchema>;

export const createUomSchema = z.object({
  unitName: z.string().min(1, 'Unit name is required').max(100),
  symbol: z.string().min(1, 'Symbol is required').max(20),
  uqc: z.string().optional().default('OTH'),
  unitPrecision: z.coerce.number().int().min(0).max(6).default(2),
});

export type CreateUomData = z.output<typeof createUomSchema>;
export type CreateUomFormData = z.input<typeof createUomSchema>;

export const updateUomSchema = createUomSchema.partial();

export type UpdateUomData = z.infer<typeof updateUomSchema>;
