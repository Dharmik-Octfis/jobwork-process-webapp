import { z } from 'zod';

export type AdjustmentType = 'quantity' | 'value';

export const ADJUSTMENT_TYPE_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: 'quantity', label: 'Quantity Adjustment' },
  { value: 'value', label: 'Value Adjustment' },
];

/** The server's fixed lists (`QUANTITY_REASONS`, `VALUE_REASONS`), as named on screen. */
export const ADJUSTMENT_REASON_OPTIONS = [
  { value: 'damaged', label: 'Damaged goods' },
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'found', label: 'Stock found' },
  { value: 'count_correction', label: 'Stock count correction' },
  { value: 'other', label: 'Other' },
];

export const VALUE_REASON_OPTIONS = [
  { value: 'write_down', label: 'Write-down to realisable value' },
  { value: 'cost_correction', label: 'Cost correction' },
  { value: 'other', label: 'Other' },
];

export const reasonOptionsFor = (type: AdjustmentType) =>
  type === 'value' ? VALUE_REASON_OPTIONS : ADJUSTMENT_REASON_OPTIONS;

export const adjustmentReasonLabel = (reason: string) =>
  [...ADJUSTMENT_REASON_OPTIONS, ...VALUE_REASON_OPTIONS].find((option) => option.value === reason)
    ?.label ?? reason;

export const adjustmentTypeLabel = (type: string) => (type === 'value' ? 'Value' : 'Quantity');

/**
 * draft | pending_approval | approved | rejected | adjusted | cancelled.
 * Only `adjusted` — and a `cancelled` that was once adjusted — ever moved stock.
 */
export const ADJUSTMENT_STATUS_META: Record<string, { label: string; color: string; bg: string }> =
  {
    draft: { label: 'Draft', color: '#475569', bg: '#f1f5f9' },
    // The server's own spelling of the status.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    pending_approval: { label: 'Pending Approval', color: '#92400e', bg: '#fef3c7' },
    approved: { label: 'Approved', color: '#1e40af', bg: '#dbeafe' },
    rejected: { label: 'Rejected', color: '#991b1b', bg: '#fee2e2' },
    adjusted: { label: 'Adjusted', color: '#166534', bg: '#dcfce7' },
    cancelled: { label: 'Cancelled', color: '#991b1b', bg: '#fee2e2' },
  };

export const adjustmentStatusMeta = (status: string) =>
  ADJUSTMENT_STATUS_META[status] ?? { label: status, color: '#475569', bg: '#f1f5f9' };

/** Saved, holding no stock, and free to edit, Adjust or delete. */
export const isUnposted = (status: string) =>
  status === 'draft' || status === 'rejected' || status === 'approved';

/** What the approval screens know this module as. */
export const ADJUSTMENT_APPROVAL_MODULE = 'stock_adjustments';

const decimal = z.union([z.string(), z.number()]);

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

export interface AdjustmentLinePayload {
  itemId: string;
  /** Quantity adjustment. Signed: positive adds stock, negative removes it. */
  quantityAdjusted?: number;
  costPrice?: number | null;
  batches?: AdjustmentBatchPayload[];
  /** Value adjustment. Signed change in what the stock here is worth. */
  valueAdjusted?: number;
}

export interface SaveAdjustmentPayload {
  adjustmentType: AdjustmentType;
  locationId: string;
  /** `yyyy-MM-dd`, as every other document here sends its date. */
  adjustmentDate: string;
  reason: string;
  referenceNumber?: string | null;
  description?: string | null;
  lines: AdjustmentLinePayload[];
  /** `adjust` posts the stock, or sends it for approval when a process applies. */
  saveAs: 'draft' | 'adjust';
}

const lineItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
});

/** The header, as every response carries it. */
const headerSchema = z.object({
  id: z.string(),
  adjustmentNumber: z.string(),
  adjustmentType: z.enum(['quantity', 'value']),
  adjustmentDate: z.string(),
  locationId: z.string(),
  value: decimal,
  reason: z.string(),
  referenceNumber: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  location: z.object({ id: z.string(), name: z.string() }),
});

export const stockAdjustmentRowSchema = headerSchema.extend({
  lines: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      quantityAdjusted: decimal,
      valueAdjusted: decimal.nullable(),
      item: lineItemSchema,
    }),
  ),
});

/** The batches an unposted line names — exactly what the form sent. */
const draftBatchSchema = z.object({
  batchId: z.string().optional(),
  batchUnitId: z.string().nullable().optional(),
  supplierBatchRef: z.string().optional(),
  manufacturerBatch: z.string().nullable().optional(),
  manufacturedDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  mrp: z.number().nullable().optional(),
  sellingPrice: z.number().nullable().optional(),
  quantity: z.number(),
  units: z
    .array(
      z.object({
        batchUnitId: z.string().optional(),
        label: z.string().optional(),
        quantity: z.number(),
      }),
    )
    .optional(),
});

const detailLineSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  quantityAdjusted: decimal,
  /** Null until the adjustment posts. */
  quantityBefore: decimal.nullable(),
  costPrice: decimal.nullable(),
  value: decimal,
  /** Value line: the change asked for, and what the stock was worth when it posted. */
  valueAdjusted: decimal.nullable(),
  valueBefore: decimal.nullable(),
  draftBatches: z.array(draftBatchSchema).nullable(),
  item: lineItemSchema.extend({
    unit: z.string().nullable().optional(),
    inventoryTracking: z.string().nullable().optional(),
    costPrice: decimal.nullable().optional(),
    sellingPrice: decimal.nullable().optional(),
    stockingUom: z.object({ symbol: z.string() }).nullable().optional(),
  }),
  batches: z.array(
    z.object({
      id: z.string(),
      batchId: z.string(),
      batchUnitId: z.string().nullable(),
      qty: decimal,
      batch: z.object({ supplierBatchRef: z.string().nullable() }),
      batchUnit: z.object({ label: z.string() }).nullable(),
    }),
  ),
});

export const stockAdjustmentDetailSchema = headerSchema.extend({
  createdAt: z.string(),
  createdByUser: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  lines: z.array(detailLineSchema),
  /** A posted value adjustment: what it did, per line per purchase entry. */
  valueChanges: z.array(
    z.object({
      lineId: z.string(),
      entry: z.string(),
      inDate: z.string(),
      qty: decimal,
      valueBefore: decimal,
      valueAfter: decimal,
      reversed: z.boolean(),
    }),
  ),
  /** What the batches and packages a draft points at are called. */
  draftLabels: z.object({
    batches: z.record(z.string(), z.string()),
    units: z.record(z.string(), z.string()),
  }),
  /** Only on the answer to a delete: thrown away, as opposed to cancelled. */
  deleted: z.boolean().optional(),
});

export type StockAdjustmentRow = z.infer<typeof stockAdjustmentRowSchema>;
export type StockAdjustmentDetail = z.infer<typeof stockAdjustmentDetailSchema>;
export type StockAdjustmentDetailLine = z.infer<typeof detailLineSchema>;
export type DraftBatch = z.infer<typeof draftBatchSchema>;
