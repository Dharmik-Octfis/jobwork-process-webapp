import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  industryType: z.string().min(1, 'Industry is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional(),
  orgAddress: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  taxIdValue: z.string().optional(),
});

export type CreateOrganizationData = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial();
export type UpdateOrganizationData = z.infer<typeof updateOrganizationSchema>;

export interface Organization {
  id: string;
  name: string;
  portalName?: string;
  industryType?: string;
  email?: string;
  phone?: string;
  orgAddress?: string;
  state?: string;
  city?: string;
  zip?: string;
  taxIdValue?: string;
  createdAt: string;
  updatedAt: string;
}
