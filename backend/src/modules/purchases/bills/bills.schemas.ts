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
      z
        .object({
          batchId: emptyToUndefinedUuid,
          supplierBatchRef: z.string().optional(),
          manufacturerBatch: z.string().optional().nullable(),
          manufacturedDate: emptyToNullDate,
          expiryDate: emptyToNullDate,
          mrp: z.coerce.number().optional().nullable(),
          sellingPrice: z.coerce.number().optional().nullable(),
          quantity: z.coerce.number().min(0.01),
          /**
           * The packages inside this batch — a taka, roll, bale — when the org runs
           * a unit level.
           *
           * 🔴 Naming them is optional; naming SOME of them is not (2026-09-02).
           * Name none and the whole batch is received untagged, exactly as before
           * the level existed. Name one and they must add up to the batch.
           *
           * 🔴 The shape check lives here; the BUSINESS rule (the total must equal
           * the batch) lives beside the write in the service, because this schema
           * runs on the HTTP route alone and an import or a test must not be able to
           * post an unbalanced document.
           */
          units: z
            .array(
              z
                .object({
                  /**
                   * Set to TOP UP a package that already exists, instead of naming
                   * a new one. Mutually exclusive with `label`, exactly as
                   * `batchId` and `supplierBatchRef` are one level up — and for the
                   * same reason: a label is a physical tag, so re-typing an
                   * existing one is a duplicate, never an addition to that roll.
                   */
                  batchUnitId: emptyToUndefinedUuid,
                  /** 🔴 Optional since 2026-09-03 — a roll with no tag on it is
                   * auto-named `#seq` by `createBatchUnits`. Only the quantity is
                   * required. */
                  label: z.string().trim().max(60).optional(),
                  quantity: z.coerce.number().min(0.0001),
                })
                /* 🔴 "Not BOTH", no longer "exactly one". A row with NEITHER used to
                 be a mistake; it is now the ordinary case — a new package the user
                 did not name. Only naming a label AND pointing at an existing
                 package is still contradictory. */
                .refine((unit) => !(unit.batchUnitId && unit.label?.trim()), {
                  message: 'A unit row is either an existing unit or a new one, not both.',
                  path: ['label'],
                }),
            )
            .optional(),
        })
        .refine((row) => row.batchId || !(row.units ?? []).some((unit) => unit.batchUnitId), {
          message: 'A batch being created has no existing units to add to.',
          path: ['units'],
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
