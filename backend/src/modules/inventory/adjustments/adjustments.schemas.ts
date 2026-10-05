import { z } from 'zod';

export const ADJUSTMENT_TYPES = ['quantity', 'value'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const createReasonSchema = z.object({
  name: z.string().trim().min(1, 'Enter a reason.').max(100),
});

export const setReasonActiveSchema = z.object({ isActive: z.boolean() });

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

const optionalNumber = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.coerce.number().optional(),
);

const adjustmentLineSchema = z
  .object({
    itemId: z.string().uuid(),
    /** Quantity adjustment. Signed: positive adds stock, negative removes it. The
     * server never takes a "new quantity on hand" — it re-reads the balance itself. */
    quantityAdjusted: optionalNumber,
    /** Increase only; ignored on a decrease, which FIFO costs. */
    costPrice: z.coerce.number().min(0, 'Cost price cannot be negative.').optional().nullable(),
    batches: z.array(adjustmentBatchSchema).max(100).optional(),
    /** Value adjustment. Signed change in what the stock here is worth. */
    valueAdjusted: optionalNumber,
  })
  // Here, not on the document: Zod skips the document's refine whenever another
  // field already failed, and this detail is what highlights the row.
  .superRefine((line, ctx) => {
    if (line.quantityAdjusted || line.valueAdjusted) return;
    const isValue = line.valueAdjusted !== undefined;
    ctx.addIssue({
      code: 'custom',
      path: [isValue ? 'valueAdjusted' : 'quantityAdjusted'],
      message: isValue ? 'Enter a value to adjust.' : 'Enter a quantity to adjust.',
    });
  });

export const saveAdjustmentSchema = z
  .object({
    adjustmentType: z.enum(ADJUSTMENT_TYPES).default('quantity'),
    locationId: z.string().uuid(),
    adjustmentDate: z.string().datetime({ offset: true }).or(z.string().min(1)),
    reasonId: z.string({ error: 'Select a reason.' }).uuid('Select a reason.'),
    referenceNumber: z.string().trim().max(100).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
    lines: z.array(adjustmentLineSchema).min(1, 'Add at least one item.').max(200),
    customFields: z.record(z.string(), z.unknown()).optional(),
    /**
     * `draft` only saves. `adjust` saves and then posts the stock — or, when an
     * approval process applies, sends it for approval instead.
     */
    saveAs: z.enum(['draft', 'adjust']).default('adjust'),
  })
  .superRefine((data, ctx) => {
    // One kind per document (value plan V1).
    for (const [index, line] of data.lines.entries()) {
      const isValue = data.adjustmentType === 'value';
      if (isValue ? !line.valueAdjusted : !line.quantityAdjusted) {
        const field = isValue ? 'valueAdjusted' : 'quantityAdjusted';
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, field],
          message: isValue ? 'Enter a value to adjust.' : 'Enter a quantity to adjust.',
        });
      }
      if (isValue && (line.quantityAdjusted || line.batches?.length)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantityAdjusted'],
          message: 'A value adjustment moves no stock.',
        });
      }
      if (!isValue && line.valueAdjusted) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'valueAdjusted'],
          message: 'A quantity adjustment changes no value by itself.',
        });
      }
    }
  });

/** The type defaults to `quantity` for callers that predate value adjustments. */
export type SaveAdjustmentDto = Omit<z.infer<typeof saveAdjustmentSchema>, 'adjustmentType'> & {
  adjustmentType?: AdjustmentType;
};
/** What a caller passes: `saveAs` may be left to its default. */
export type SaveAdjustmentInput = z.input<typeof saveAdjustmentSchema>;
export type AdjustmentLineDto = z.infer<typeof adjustmentLineSchema>;
export type AdjustmentBatchDto = z.infer<typeof adjustmentBatchSchema>;
