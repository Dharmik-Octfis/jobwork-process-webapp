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
    taxIdValue: z.string().optional().openapi({ example: '22AAAAA0000A1Z5' }),

    dialCode: z.string().optional().openapi({ example: '+91' }),
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

    address: z
      .object({
        country: z.string().nullable().optional().openapi({ example: 'IN' }),
        stateCode: z.string().nullable().optional().openapi({ example: 'IN-GJ' }),
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
        street_address1: z
          .string()
          .optional()
          .openapi({ example: '101, Titanium City Center, Satellite' }),
      })
      .optional(),

    website: z
      .string()
      .regex(/^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})([/\w .-]*)*\/?$/i, 'Invalid website URL')
      .optional()
      .or(z.literal(''))
      .openapi({ example: 'https://acmecorp.in' }),

    settings: z
      .object({
        itemTrackingLabel: z
          .object({
            singular: z.string().max(30).default('Batch'),
            plural: z.string().max(30).default('Batches'),
          })
          .optional(),
        /**
         * The optional level BELOW a batch — a taka, roll, bale, coil, plate. Lives
         * here rather than in a column because it is exactly what `settings` is for
         * and because the level costs zero DDL to switch on.
         *
         * `enabled` is the master switch: off, and no screen shows the level at all.
         * The two labels are the same per-org terminology `itemTrackingLabel` is, so
         * an org that calls a batch a "Lot" can call its packages "Takas".
         *
         * 🔴 A per-ITEM gate is deliberately absent. The level is visible exactly
         * where a batch is visible — `Item.inventoryTracking = 'batch'` — so thread,
         * buttons and packing tape never grow a unit grid, because they never grow a
         * batch grid.
         */
        batchUnit: z
          .object({
            enabled: z.boolean().default(false),
            singular: z.string().max(30).default('Taka'),
            plural: z.string().max(30).default('Takas'),
          })
          .optional(),
      })
      .optional(),
  }),
);

export const updateOrganizationSchema = openApiRegistry.register(
  'UpdateOrganizationRequest',
  createOrganizationSchema.partial(),
);
