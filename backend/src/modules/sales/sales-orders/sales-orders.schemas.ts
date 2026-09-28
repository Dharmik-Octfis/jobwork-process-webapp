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

export const salesOrderItemSchema = z.object({
  id: emptyToUndefinedUuid,
  itemId: z.string().uuid(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discountPercentage: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  itemTotal: z.coerce.number(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const baseSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  locationId: emptyToNullUuid,
  soNumber: z.string().min(1),
  date: z.coerce.date(),
  deliveryDate: emptyToNullDate,
  paymentTerms: z.string().optional().nullable(),
  subTotal: z.coerce.number(),
  totalAmount: z.coerce.number(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  documents: z.array(z.any()).optional().nullable(),
  status: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lineItems: z.array(salesOrderItemSchema).min(1),
});

const validateDeliveryDate = (data: { date?: Date; deliveryDate?: Date | null }) => {
  if (data.date && data.deliveryDate) {
    const soTime = new Date(data.date).setHours(0, 0, 0, 0);
    const delTime = new Date(data.deliveryDate).setHours(0, 0, 0, 0);
    return delTime >= soTime;
  }
  return true;
};

export const createSalesOrderSchema = baseSalesOrderSchema
  .extend({
    status: z.string().default('Draft'),
  })
  .refine(validateDeliveryDate, {
    message: 'Delivery date must be equal to or after SO date',
    path: ['deliveryDate'],
  });

export const updateSalesOrderSchema = baseSalesOrderSchema
  .partial()
  .refine(validateDeliveryDate, {
    message: 'Delivery date must be equal to or after SO date',
    path: ['deliveryDate'],
  });

export const salesOrderQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['soNumber', 'date', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('SalesOrder', createSalesOrderSchema);
export type SalesOrderItemPayload = z.infer<typeof salesOrderItemSchema>;
export type CreateSalesOrderPayload = z.infer<typeof createSalesOrderSchema>;
export type UpdateSalesOrderPayload = z.infer<typeof updateSalesOrderSchema>;
