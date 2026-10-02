import { z } from 'zod';

export const ADJUSTMENT_REASONS = [
  'damaged',
  'lost',
  'found',
  'count_correction',
  'other',
] as const;

const emptyToUndefinedUuid = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().uuid().optional(),
);

const emptyToNullDate = z.preprocess(
  (val) => (val === '' ? null : val),
  z.coerce.date().optional().nullable(),
);

const adjustmentBatchUnitSchema = z
  .object({
    /** Set to top up a package that already exists; omitted for a new one. */
    batchUnitId: emptyToUndefinedUuid,
    label: z.string().trim().max(60).optional(),
    quantity: z.coerce.number().min(0.0001),
  })
  .refine((unit) => !(unit.batchUnitId && unit.label?.trim()), {
    message: 'A unit row is either an existing unit or a new one, not both.',
    path: ['label'],
  });

/**
 * One batch row. The two directions read it differently:
 *
 *   · increase — the bill's shape: no `batchId` creates a batch from the details,
 *     a `batchId` adds to that batch, and `units` break the quantity into packages.
 *   · decrease — `batchId` (required), optionally the one `batchUnitId` it comes
 *     off, and `quantity`.
 */
const adjustmentBatchSchema = z.object({
  batchId: emptyToUndefinedUuid,
  batchUnitId: emptyToUndefinedUuid,
  supplierBatchRef: z.string().optional(),
  manufacturerBatch: z.string().optional().nullable(),
  manufacturedDate: emptyToNullDate,
  expiryDate: emptyToNullDate,
  mrp: z.coerce.number().optional().nullable(),
  sellingPrice: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().min(0.0001),
  units: z.array(adjustmentBatchUnitSchema).optional(),
});

export const createAdjustmentSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  adjustmentDate: z.string().datetime({ offset: true }).or(z.string().min(1)),
  /** Signed: positive adds stock, negative removes it. The server never takes a
   * "new quantity on hand" — it re-reads the balance itself. */
  quantityAdjusted: z.coerce.number().refine((value) => value !== 0, 'Enter a quantity to adjust.'),
  /** Increase only; ignored on a decrease, which FIFO costs. */
  costPrice: z.coerce.number().min(0, 'Cost price cannot be negative.').optional().nullable(),
  reason: z.enum(ADJUSTMENT_REASONS),
  referenceNumber: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  batches: z.array(adjustmentBatchSchema).max(100).optional(),
});

export type CreateAdjustmentDto = z.infer<typeof createAdjustmentSchema>;
export type AdjustmentBatchDto = z.infer<typeof adjustmentBatchSchema>;
