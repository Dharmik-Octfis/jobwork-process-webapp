import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.js';

const emptyToNullUuid = z.preprocess(
  (val) => (val === '' ? null : val),
  z.string().uuid().optional().nullable()
);

const emptyToUndefinedUuid = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().uuid().optional()
);

const emptyToNullDate = z.preprocess(
  (val) => (val === '' ? null : val),
  z.coerce.date().optional().nullable()
);

export const purchaseOrderItemSchema = z.object({
  id: emptyToUndefinedUuid,
  itemId: z.string().uuid(),
  itemPoStatus: z.string().optional().nullable(),
  linkedSalesOrderId: emptyToNullUuid,
  totalWeight: z.coerce.number().optional().nullable(),
  costPrice: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discountPercentage: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  itemTotal: z.coerce.number(),
  projectId: emptyToNullUuid,
  reportingTags: z.any().optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const basePurchaseOrderSchema = z.object({
  vendorId: z.string().uuid(),
  deliveryType: z.enum(['Location', 'Customer']).default('Location'),
  deliveryLocationId: emptyToNullUuid,
  deliveryCustomerId: emptyToNullUuid,
  poNumber: z.string().min(1),
  date: z.coerce.date(),
  deliveryDate: emptyToNullDate,
  paymentTerms: z.string().optional().nullable(),
  subTotal: z.coerce.number(),
  totalAmount: z.coerce.number(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  documents: z.array(z.any()).optional().nullable(),
  status: z.string().default('Draft'),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lineItems: z.array(purchaseOrderItemSchema).min(1),
});

// eslint-disable-next-line @typescript-eslint/naming-convention
const validateDeliveryDate = (data: { date?: Date; deliveryDate?: Date | null }) => {
  if (data.date && data.deliveryDate) {
    const poTime = new Date(data.date).setHours(0, 0, 0, 0);
    const delTime = new Date(data.deliveryDate).setHours(0, 0, 0, 0);
    return delTime >= poTime;
  }
  return true;
};

export const createPurchaseOrderSchema = basePurchaseOrderSchema.refine(validateDeliveryDate, {
  message: 'Delivery date must be equal to or after PO date',
  path: ['deliveryDate'],
});

export const updatePurchaseOrderSchema = basePurchaseOrderSchema.partial().refine(validateDeliveryDate, {
  message: 'Delivery date must be equal to or after PO date',
  path: ['deliveryDate'],
});

export const purchaseOrderQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['poNumber', 'date', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('PurchaseOrder', createPurchaseOrderSchema);
export type PurchaseOrderItemPayload = z.infer<typeof purchaseOrderItemSchema>;
export type CreatePurchaseOrderPayload = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderPayload = z.infer<typeof updatePurchaseOrderSchema>;

