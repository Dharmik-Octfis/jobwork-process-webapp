import { z } from 'zod';

const baseOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  industryCode: z.string().min(1, 'Industry is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  dialCode: z.string().optional(),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits')
    .optional()
    .or(z.literal('')),
  orgAddress: z.string().optional(),
  stateCode: z.string().optional(),
  cityId: z.string().optional(),
  zip: z
    .string()
    .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits')
    .optional()
    .or(z.literal('')),
  taxIdValue: z
    .string()
    .length(15, 'GST Number must be exactly 15 characters')
    .optional()
    .or(z.literal('')),
});

const phoneRefinement = (_data: { phone?: string; dialCode?: string }, _ctx: z.RefinementCtx) => {
  // Unconditional 10 digit check is now handled by the base schema via regex
};

export const createOrganizationSchema = baseOrganizationSchema.superRefine(phoneRefinement);

export type CreateOrganizationData = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = baseOrganizationSchema
  .partial()
  .superRefine(phoneRefinement);
export type UpdateOrganizationData = z.infer<typeof updateOrganizationSchema>;

export interface Organization {
  id: string;
  name: string;
  portalName?: string;
  industryCode?: string;
  industry?: { name: string } | null;
  email?: string;
  dialCode?: string;
  phone?: string;
  orgAddress?: string;
  stateCode?: string;
  cityId?: string;
  zip?: string;
  taxIdValue?: string;
  createdAt: string;
  updatedAt: string;
}
