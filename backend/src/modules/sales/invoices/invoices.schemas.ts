import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.js';

const emptyToNullUuid = z.preprocess(
  (val) => (val === '' ? null : val),
  z.string().uuid().optional().nullable(),
);

const emptyToUndefinedUuid = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().uuid().optional(),
);

const emptyToNullDate = z.preprocess(
  (val) => (val === '' ? null : val),
  z.coerce.date().optional().nullable(),
);

export const invoiceItemSchema = z.object({
  id: emptyToUndefinedUuid,
  itemId: z.string().uuid(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discountPercentage: z.coerce
    .number()
    .min(0, 'Discount cannot be negative.')
    .max(100, 'Discount cannot exceed 100%.')
    .optional()
    .nullable(),
  discount: z.coerce.number().min(0, 'Discount cannot be negative.').optional().nullable(),
  // accepted for compatibility, but recomputed by the service â€” see `priceLines`
  itemTotal: z.coerce.number().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const baseInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  locationId: emptyToNullUuid,
  invoiceNumber: z.string().min(1),
  salesOrderId: emptyToNullUuid,
  date: z.coerce.date(),
  deliveryDate: emptyToNullDate,
  paymentTerms: z.string().optional().nullable(),
  subTotal: z.coerce.number().optional(),
  totalAmount: z.coerce.number().optional(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  documents: z.array(z.any()).optional().nullable(),
  status: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lineItems: z.array(invoiceItemSchema).min(1),
});

const validateDeliveryDate = (data: { date?: Date; deliveryDate?: Date | null }) => {
  if (data.date && data.deliveryDate) {
    const soTime = new Date(data.date).setHours(0, 0, 0, 0);
    const delTime = new Date(data.deliveryDate).setHours(0, 0, 0, 0);
    return delTime >= soTime;
  }
  return true;
};

export const createInvoiceSchema = baseInvoiceSchema
  .extend({
    status: z.string().default('Draft'),
  })
  .refine(validateDeliveryDate, {
    message: 'Delivery date must be equal to or after SO date',
    path: ['deliveryDate'],
  });

export const updateInvoiceSchema = baseInvoiceSchema.partial().refine(validateDeliveryDate, {
  message: 'Delivery date must be equal to or after SO date',
  path: ['deliveryDate'],
});

export const invoiceQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['invoiceNumber', 'date', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('Invoice', createInvoiceSchema);
export type InvoiceItemPayload = z.infer<typeof invoiceItemSchema>;
export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoicePayload = z.infer<typeof updateInvoiceSchema>;



