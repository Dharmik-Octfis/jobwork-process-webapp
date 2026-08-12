import { z } from 'zod';
import { openApiRegistry } from '../../../../config/openapi.js';

export const createLocationSchema = z.object({
  type: z.enum(['Business', 'Warehouse']).default('Business'),
  name: z.string().min(1, 'Name is required').max(100),
  parentId: z.string().uuid().nullable().optional(),
  logo: z.string().nullable().optional(),
  street1: z.string().nullable().optional(),
  street2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  isPrimary: z.boolean().default(false).optional(),
});

export const updateLocationSchema = createLocationSchema.partial();

export const locationQuerySchema = z.object({
  search: z.string().optional(),
  sortBy: z.enum(['name', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('Location', createLocationSchema);
export type CreateLocationPayload = z.infer<typeof createLocationSchema>;
export type UpdateLocationPayload = z.infer<typeof updateLocationSchema>;
