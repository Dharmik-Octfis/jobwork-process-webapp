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
  item_id: z.string().uuid(),
  item_po_status: z.string().optional().nullable(),
  linked_sales_order_id: emptyToNullUuid,
  total_weight: z.coerce.number().optional().nullable(),
  cost_price: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discount_percentage: z.coerce.number().optional().nullable(),
  discount: z.coerce.number().optional().nullable(),
  item_total: z.coerce.number(),
  project_id: emptyToNullUuid,
  reporting_tags: z.any().optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

const basePurchaseOrderSchema = z.object({
  vendor_id: z.string().uuid(),
  delivery_type: z.enum(['Location', 'Customer']).default('Location'),
  delivery_location_id: emptyToNullUuid,
  delivery_customer_id: emptyToNullUuid,
  purchaseorder_number: z.string().min(1),
  date: z.coerce.date(),
  delivery_date: emptyToNullDate,
  payment_terms: z.string().optional().nullable(),
  sub_total: z.coerce.number(),
  total: z.coerce.number(),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  documents: z.array(z.any()).optional().nullable(),
  status: z.string().default('Draft'),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  line_items: z.array(purchaseOrderItemSchema).min(1),
});

// eslint-disable-next-line @typescript-eslint/naming-convention
const validateDeliveryDate = (data: { date?: Date; delivery_date?: Date | null }) => {
  if (data.date && data.delivery_date) {
    const poTime = new Date(data.date).setHours(0, 0, 0, 0);
    const delTime = new Date(data.delivery_date).setHours(0, 0, 0, 0);
    return delTime >= poTime;
  }
  return true;
};

export const createPurchaseOrderSchema = basePurchaseOrderSchema.refine(validateDeliveryDate, {
  message: 'Delivery date must be equal to or after PO date',
  path: ['delivery_date'],
});

export const updatePurchaseOrderSchema = basePurchaseOrderSchema.partial().refine(validateDeliveryDate, {
  message: 'Delivery date must be equal to or after PO date',
  path: ['delivery_date'],
});

export const purchaseOrderQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['purchaseorder_number', 'date', 'created_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('PurchaseOrder', createPurchaseOrderSchema);
export type PurchaseOrderItemPayload = z.infer<typeof purchaseOrderItemSchema>;
export type CreatePurchaseOrderPayload = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderPayload = z.infer<typeof updatePurchaseOrderSchema>;

