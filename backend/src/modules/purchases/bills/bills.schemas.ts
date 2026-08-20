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

export const billItemSchema = z.object({
  id: emptyToUndefinedUuid,
  itemId: z.string().uuid(),
  quantity: z.coerce.number().min(0.01),
  rate: z.coerce.number().min(0),
  discountPercentage: z.coerce.number().optional().nullable(),
  discountAmount: z.coerce.number().optional().nullable(),
  amount: z.coerce.number(),
  batches: z
    .array(
      z.object({
        batchId: emptyToUndefinedUuid,
        supplierBatchRef: z.string().optional(),
        manufacturerBatch: z.string().optional().nullable(),
        manufacturedDate: emptyToNullDate,
        expiryDate: emptyToNullDate,
        mrp: z.coerce.number().optional().nullable(),
        sellingPrice: z.coerce.number().optional().nullable(),
        quantity: z.coerce.number().min(0.01),
      }),
    )
    .optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const baseBillSchema = z.object({
  vendorId: z.string().uuid(),
  locationId: emptyToNullUuid,
  sourcePoId: emptyToNullUuid,
  billNumber: z.string().min(1),
  billDate: z.coerce.date(),
  dueDate: emptyToNullDate,
  paymentTerms: z.string().optional().nullable(),
  subTotal: z.coerce.number(),
  totalAmount: z.coerce.number(),
  termsAndConditions: z.string().optional().nullable(),
  attachments: z.array(z.any()).optional().nullable(),
  status: z.string().default('Draft'),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lineItems: z.array(billItemSchema).min(1),
});

// eslint-disable-next-line @typescript-eslint/naming-convention
const validateDueDate = (data: { billDate?: Date; dueDate?: Date | null }) => {
  if (data.billDate && data.dueDate) {
    const billTime = new Date(data.billDate).setHours(0, 0, 0, 0);
    const dueTime = new Date(data.dueDate).setHours(0, 0, 0, 0);
    return dueTime >= billTime;
  }
  return true;
};

export const createBillSchema = baseBillSchema.refine(validateDueDate, {
  message: 'Due date must be equal to or after Bill date',
  path: ['dueDate'],
});

export const updateBillSchema = baseBillSchema.partial().refine(validateDueDate, {
  message: 'Due date must be equal to or after Bill date',
  path: ['dueDate'],
});

export const billQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['billNumber', 'billDate', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

openApiRegistry.register('Bill', createBillSchema);
export type BillItemPayload = z.infer<typeof billItemSchema>;
export type CreateBillPayload = z.infer<typeof createBillSchema>;
export type UpdateBillPayload = z.infer<typeof updateBillSchema>;
