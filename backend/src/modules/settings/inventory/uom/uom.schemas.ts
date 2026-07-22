import { z } from 'zod';

export const createUomSchema = z.object({
  unitName: z.string().min(1, 'Unit name is required').max(100),
  symbol: z.string().min(1, 'Symbol is required').max(20),
  uqc: z.string().optional().default('OTH'),
  unitPrecision: z.number().int().min(0).max(6).default(2),
});

export const updateUomSchema = createUomSchema.partial();
