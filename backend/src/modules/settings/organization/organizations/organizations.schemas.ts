import { z } from 'zod';
import { openApiRegistry } from '../../../../config/openapi.ts';

export const createOrganizationSchema = openApiRegistry.register(
  'CreateOrganizationRequest',
  z.object({
  name: z
    .string()
    .min(1, 'Organization name is required')
    .max(100)
    .openapi({ example: 'Acme Corp' }),
  industryType: z.string().min(1, 'Industry is required').openapi({ example: 'technology' }),
  baseCurrency: z.string().optional().openapi({ example: 'INR' }),
  tax_id_value: z.string().optional().openapi({ example: '22AAAAA0000A1Z5' }),

  dial_code: z.string().optional().openapi({ example: '+91' }),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits')
    .optional()
    .or(z.literal(''))
    .openapi({ example: '9876543210' }),
  email: z
    .string()
    .email('Invalid email address')
    .optional()
    .or(z.literal(''))
    .openapi({ example: 'contact@acmecorp.in' }),

  address: z.object({
    country: z.string().nullable().optional().openapi({ example: 'IN' }),
    state_code: z.string().nullable().optional().openapi({ example: 'IN-GJ' }),
    city: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: '3f2a1c4e-8b7d-4e2a-9c11-2b6f0a5d9e88' }),
    zip: z
      .string()
      .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits')
      .optional()
      .or(z.literal(''))
      .openapi({ example: '380015' }),
    street_address1: z.string().optional().openapi({ example: '101, Titanium City Center, Satellite' }),
  }).optional(),

  website: z
    .string()
    .regex(/^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})([/\w .-]*)*\/?$/i, 'Invalid website URL')
    .optional()
    .or(z.literal(''))
    .openapi({ example: 'https://acmecorp.in' }),
}),
);

export const updateOrganizationSchema = openApiRegistry.register(
  'UpdateOrganizationRequest',
  createOrganizationSchema.partial(),
);
