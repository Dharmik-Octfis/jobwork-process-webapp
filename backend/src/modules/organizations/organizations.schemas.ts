import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  industryType: z.string().min(1, 'Industry is required'),
  
  phone: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),

  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  orgAddress: z.string().optional(),

  taxIdValue: z.string().optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();
