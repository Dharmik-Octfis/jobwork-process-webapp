import { z } from 'zod';

/** The server's fixed list (`ADJUSTMENT_REASONS`), with what each is called on screen. */
export const ADJUSTMENT_REASON_OPTIONS = [
  { value: 'damaged', label: 'Damaged goods' },
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'found', label: 'Stock found' },
  { value: 'count_correction', label: 'Stock count correction' },
  { value: 'other', label: 'Other' },
];

export const adjustmentReasonLabel = (reason: string) =>
  ADJUSTMENT_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? reason;

const decimal = z.union([z.string(), z.number()]);

export const stockAdjustmentSchema = z.object({
  id: z.string(),
  adjustmentNumber: z.string(),
  adjustmentDate: z.string(),
  itemId: z.string(),
  locationId: z.string(),
  quantityAdjusted: decimal,
  quantityBefore: decimal,
  costPrice: decimal.nullable(),
  value: decimal,
  reason: z.string(),
  referenceNumber: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
});

export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;

export interface AdjustmentBatchPayload {
  batchId?: string;
  batchUnitId?: string | null;
  supplierBatchRef?: string;
  manufacturerBatch?: string | null;
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  mrp?: number | null;
  sellingPrice?: number | null;
  quantity: number;
  units?: { batchUnitId?: string; label?: string; quantity: number }[];
}

export interface CreateAdjustmentPayload {
  itemId: string;
  locationId: string;
  /** `yyyy-MM-dd`, as every other document here sends its date. */
  adjustmentDate: string;
  /** Signed: positive adds stock, negative removes it. */
  quantityAdjusted: number;
  costPrice?: number | null;
  reason: string;
  referenceNumber?: string | null;
  description?: string | null;
  batches?: AdjustmentBatchPayload[];
}

/** A list row: the header plus the two names the table shows. */
export const stockAdjustmentRowSchema = stockAdjustmentSchema.extend({
  item: z.object({ id: z.string(), name: z.string(), sku: z.string().nullable() }),
  location: z.object({ id: z.string(), name: z.string() }),
});

export const stockAdjustmentDetailSchema = stockAdjustmentRowSchema.extend({
  createdAt: z.string(),
  createdByUser: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  batches: z.array(
    z.object({
      id: z.string(),
      batchId: z.string(),
      batchUnitId: z.string().nullable(),
      qty: decimal,
      batch: z.object({
        supplierBatchRef: z.string().nullable(),
        manufacturerBatch: z.string().nullable(),
        expiryDate: z.string().nullable(),
      }),
      batchUnit: z.object({ label: z.string() }).nullable(),
    }),
  ),
});

export type StockAdjustmentRow = z.infer<typeof stockAdjustmentRowSchema>;
export type StockAdjustmentDetail = z.infer<typeof stockAdjustmentDetailSchema>;

export const ADJUSTMENT_STATUS_META: Record<string, { label: string; color: string; bg: string }> =
  {
    adjusted: { label: 'Adjusted', color: '#166534', bg: '#dcfce7' },
    cancelled: { label: 'Cancelled', color: '#991b1b', bg: '#fee2e2' },
  };
