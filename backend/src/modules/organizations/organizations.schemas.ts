import { z } from 'zod';
import { openApiRegistry } from '../../config/openapi.ts';

export const createOrganizationSchema = openApiRegistry.register(
  'CreateOrganizationRequest',
  z.object({
  name: z.string().min(1, 'Organization name is required').max(100).openapi({ example: 'Acme Corp' }),
  industryType: z.string().min(1, 'Industry is required').openapi({ example: 'IT Services' }),
  
  countryCode: z.string().optional().openapi({ example: '+91' }),
  phone: z.string().regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits').optional().or(z.literal('')).openapi({ example: '9876543210' }),
  email: z.string().email('Invalid email address').optional().or(z.literal('')).openapi({ example: 'contact@acmecorp.in' }),

  city: z.string().optional().openapi({ example: 'Ahmedabad' }),
  state: z.string().optional().openapi({ example: 'Gujarat' }),
  zip: z.string().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits').optional().or(z.literal('')).openapi({ example: '380015' }),
  orgAddress: z.string().optional().openapi({ example: '101, Titanium City Center, Satellite' }),

  taxIdValue: z.string().length(15, 'GST Number must be exactly 15 characters').optional().or(z.literal('')).openapi({ example: '24AAAAA0000A1Z5' }),
}));

export const updateOrganizationSchema = openApiRegistry.register(
  'UpdateOrganizationRequest',
  createOrganizationSchema.partial()
);
