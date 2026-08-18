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

export const billItemSchema = z.object({
  id: emptyToUndefinedUuid,
  item_id: z.string().uuid(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discount_percentage: z.coerce.number().optional().nullable(),
  discount_amount: z.coerce.number().optional().nullable(),
  amount: z.coerce.number(),
  batches: z.array(z.object({
    supplierBatchRef: z.string().optional(),
    manufacturerBatch: z.string().optional().nullable(),
    manufacturedDate: emptyToNullDate,
    expiryDate: emptyToNullDate,
    mrp: z.coerce.number().optional().nullable(),
    sellingPrice: z.coerce.number().optional().nullable(),
    quantity: z.coerce.number().min(0.01),
  })).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

const baseBillSchema = z.object({
  vendor_id: z.string().uuid(),
  location_id: emptyToNullUuid,
  bill_number: z.string().min(1),
  bill_date: z.coerce.date(),
  due_date: emptyToNullDate,
  payment_terms: z.string().optional().nullable(),
  sub_total: z.coerce.number(),
  total_amount: z.coerce.number(),
  terms_and_conditions: z.string().optional().nullable(),
  attachments: z.array(z.any()).optional().nullable(),
  status: z.string().default('Draft'),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  line_items: z.array(billItemSchema).min(1),
});

// eslint-disable-next-line @typescript-eslint/naming-convention
const validateDueDate = (data: { bill_date?: Date; due_date?: Date | null }) => {
  if (data.bill_date && data.due_date) {
    const billTime = new Date(data.bill_date).setHours(0, 0, 0, 0);
    const dueTime = new Date(data.due_date).setHours(0, 0, 0, 0);
    return dueTime >= billTime;
  }
  return true;
};

export const createBillSchema = baseBillSchema.refine(validateDueDate, {
  message: 'Due date must be equal to or after Bill date',
  path: ['due_date'],
});

export const updateBillSchema = baseBillSchema.partial().refine(validateDueDate, {
  message: 'Due date must be equal to or after Bill date',
  path: ['due_date'],
});

export const billQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['bill_number', 'bill_date', 'created_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('Bill', createBillSchema);
export type BillItemPayload = z.infer<typeof billItemSchema>;
export type CreateBillPayload = z.infer<typeof createBillSchema>;
export type UpdateBillPayload = z.infer<typeof updateBillSchema>;
