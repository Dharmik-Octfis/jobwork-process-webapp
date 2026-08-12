import { z } from 'zod';

export const itemAssemblyLineSchema = z.object({
  id: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  qtyRequired: z.number().min(0),
  lotId: z.string().uuid().optional(), // In case lot-tracking is required
});

export const createAssemblySchema = z.object({
  compositeItemId: z.string().uuid(),
  assemblyNumber: z.string().optional(),
  remarks: z.string().optional(),
  assemblyDate: z.string().datetime({ offset: true }).or(z.string()),
  qty: z.number().min(1),
  locationId: z.string().uuid(),
  projectId: z.string().uuid().optional().or(z.literal('')),
  lines: z.array(itemAssemblyLineSchema).min(1),
});

export type CreateAssemblyDto = z.infer<typeof createAssemblySchema>;
