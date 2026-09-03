import { z } from 'zod';

const baseOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  industryType: z.string().min(1, 'Industry is required'),
  baseCurrency: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  dialCode: z.string().optional(),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits')
    .optional()
    .or(z.literal('')),
  address: z
    .object({
      streetAddress1: z.string().optional(),
      city: z.string().optional(),
      stateCode: z.string().optional(),
      country: z.string().optional(),
      zip: z
        .string()
        .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits')
        .optional()
        .or(z.literal('')),
    })
    .optional(),
  website: z
    .string()
    .regex(/^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})([/\w .-]*)*\/?$/i, 'Invalid website URL')
    .optional()
    .or(z.literal('')),
  settings: z
    .object({
      itemTrackingLabel: z
        .object({
          singular: z.string().max(30).optional(),
          plural: z.string().max(30).optional(),
        })
        .optional(),
      /** The optional level below a batch — see the backend schema for why it
       * lives in `settings` and why there is no per-item gate. */
      batchUnit: z
        .object({
          enabled: z.boolean().optional(),
          singular: z.string().max(30).optional(),
          plural: z.string().max(30).optional(),
        })
        .optional(),
    })
    .optional(),
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
  organizationId: string;
  /**
   * Ten-digit support code the customer reads out to support. Display only —
   * `organizationId` is still the value every request and route key uses.
   * Optional here because a client holding a cached organization from before
   * this field shipped will not have it; render defensively.
   */
  orgCode?: string;
  name: string;
  portalName?: string;
  industryType?: string;
  industry?: { name: string } | null;
  email?: string;
  dialCode?: string;
  phone?: string;
  address?: {
    streetAddress1?: string;
    country?: string;
    stateCode?: string;
    city?: string;
    zip?: string;
  };
  website?: string;

  logo_url?: string | null;
  accountCreatedDate: string;
  settings?: {
    itemTrackingLabel?: {
      singular?: string;
      plural?: string;
    };
    batchUnit?: {
      enabled?: boolean;
      singular?: string;
      plural?: string;
    };
  } | null;
}
