import { z } from 'zod';

export const itemImageAttachmentSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  type: z.string().optional(),
});

export type ItemImageAttachment = z.infer<typeof itemImageAttachmentSchema>;

export const itemSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name is required').max(200),
  itemType: z.enum(['goods', 'service']).default('goods'),
  category: z.string().max(100).nullable().optional(),
  hsnCode: z.string().max(50).nullable().optional(),
  itemStructure: z.enum(['single', 'variants', 'composite']).default('single'),
  unit: z.string().default(''),
  sku: z.string().default(''),
  /**
   * The jobwork columns (migration 20260804120247). Optional here because the
   * Item screens do not edit them yet — but they must survive the parse, because
   * zod STRIPS what it does not declare and the jobwork screens read all three:
   *
   *   stockingUomId  the input unit a job order shows read-only — one item, one
   *                  stocking unit (§5.1)
   *   defaultRouteId pre-selects the route on a new job order (§4.1)
   *
   * `inventoryTracking` is declared once further down, beside `trackInventory` —
   * the two are one control on the form.
   */
  stockingUomId: z.string().nullable().optional(),
  nature: z.string().optional(),
  defaultRouteId: z.string().nullable().optional(),
  isSalesInfo: z.boolean().default(true),
  sellingPrice: z
    .number({ message: 'Selling price is required' })
    .min(0, 'Selling price must be positive'),
  mrp: z.union([z.string(), z.number()]).nullable().optional(),
  salesDescription: z.string().nullable().optional(),
  isPurchaseInfo: z.boolean().default(true),
  costPrice: z.number({ message: 'Cost price is required' }).min(0, 'Cost price must be positive'),
  purchaseDescription: z.string().nullable().optional(),
  packaging: z.string().max(100).nullable().optional(),
  deliveryDate: z.string().nullable().optional(),

  frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  images: z.array(z.union([itemImageAttachmentSchema, z.string()])).default([]),

  trackInventory: z.boolean().default(true),
  inventoryTracking: z.string().nullable().optional(),
  openingStock: z.number().nullable().optional(),
  openingStockValuePerUnit: z.number().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  isDeleted: z.boolean().optional(),
});

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  itemType: z.enum(['goods', 'service']).default('goods'),
  category: z.string().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  itemStructure: z.enum(['single', 'variants', 'composite']).default('single'),
  unit: z.string().optional().default(''),
  /**
   * 🔴 The unit the STOCK LEDGER moves this item in. One item, one stocking unit
   * (jobwork domain §5.1): every batch, challan line and balance is denominated in
   * it, and nothing converts between units anywhere in the system.
   *
   * Set from the same dropdown as `unit` above, which is the legacy free string
   * the lists still render. Nullable because items created before the field
   * existed have none — the jobwork screens then fall back to asking, rather
   * than inventing one.
   */
  stockingUomId: z.string().nullable().optional(),
  sku: z.string().optional().default(''),

  isSalesInfo: z.boolean().default(true),
  sellingPrice: z
    .number({ message: 'Selling price is required' })
    .min(0, 'Selling price must be positive'),
  salesDescription: z.string().optional().nullable(),

  isPurchaseInfo: z.boolean().default(true),
  costPrice: z.number({ message: 'Cost price is required' }).min(0, 'Cost price must be positive'),
  purchaseDescription: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),

  frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  images: z.array(z.union([itemImageAttachmentSchema, z.string()])).default([]),

  trackInventory: z.boolean().default(true),
  inventoryTracking: z.string().nullable().optional(),
  openingStock: z.number().nullable().optional(),
  openingStockValuePerUnit: z.number().nullable().optional(),

  // Dynamic per-org custom fields; validated server-side against the org's definitions.
  customFields: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type Item = z.infer<typeof itemSchema>;
export type ItemFormData = z.infer<typeof itemFormSchema>;

/**
 * One package inside a declared batch — a taka, roll, bale. `id` is the real
 * `batch_units.id` and round-trips: a row carrying a known one is that package
 * EDITED, a row without is a new package, and a package the payload never
 * mentions was deleted. Same contract as the batch id one level up.
 */
export const itemOpeningStockUnitSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional().nullable(),
  /** Read-back only — the batch's own `seq`, so the grid can render them in the
   * order they were tagged rather than in insertion order. */
  seq: z.number().optional(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
});

export const itemOpeningStockBatchSchema = z.object({
  id: z.string().optional(),
  /** 🔴 Removed from the payload 2026-08-14 — internal key. */
  batchReference: z.string().optional().nullable(),
  manufacturerBatch: z.string().optional().nullable(),
  manufacturedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  sellingPrice: z.union([z.string(), z.number()]).optional().nullable(),
  mrp: z.union([z.string(), z.number()]).optional().nullable(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
  /** The packages inside this batch. Their quantities may total LESS than the
   * batch's — the rest is its untagged remainder. */
  units: z.array(itemOpeningStockUnitSchema).optional(),
});

export const itemOpeningStockLocationRowSchema = z.object({
  id: z.string().optional(),
  locationId: z.string(),
  openingStock: z.union([z.string(), z.number()]).optional().nullable(),
  openingStockValue: z.union([z.string(), z.number()]).optional().nullable(),
  stockOnHand: z.union([z.string(), z.number()]).optional().nullable(),
  committedStock: z.union([z.string(), z.number()]).optional().nullable(),
  availableForSale: z.union([z.string(), z.number()]).optional().nullable(),
  batches: z.array(itemOpeningStockBatchSchema),
});

export const itemOpeningStockSchema = z.object({
  locationRows: z.array(itemOpeningStockLocationRowSchema),
  /**
   * Whose goods these are — applied to batches the save CREATES, never to ones it
   * merely adjusts. The Item screen omits it and gets `own`; the Issue dialog
   * passes the job order's, because a customer-ownership order can only be fed by
   * customer-owned stock and anything added as our own would be invisible to it.
   */
  ownership: z.enum(['own', 'customer']).optional(),
  ownerPartyId: z.string().nullable().optional(),
});

export type ItemOpeningStockBatchDto = z.infer<typeof itemOpeningStockBatchSchema>;
export type ItemOpeningStockLocationRowDto = z.infer<typeof itemOpeningStockLocationRowSchema>;
export type ItemOpeningStockDto = z.infer<typeof itemOpeningStockSchema>;

export const itemBatchSchema = z.object({
  id: z.string().optional(),
  locationId: z.string(),
  locationName: z.string().optional(),
  batchReference: z.string().optional().nullable(),
  manufacturerBatch: z.string().optional().nullable(),
  manufacturedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
  quantityAvailable: z.union([z.string(), z.number()]).optional().nullable(),
  sellingPrice: z.union([z.string(), z.number()]).optional().nullable(),
  mrp: z.union([z.string(), z.number()]).optional().nullable(),
  isExpired: z.boolean().optional(),
  /**
   * 🔴 THE PACKAGES OF THIS BATCH AT THIS LOCATION, and what is left of each —
   * which is what makes "where is roll T-1" answerable at a glance. A roll at the
   * dyer's appears under the dyer's row.
   *
   * Empty for a batch that has none, which is every batch in an org that never
   * turned the level on.
   */
  units: z
    .array(
      z.object({
        batchUnitId: z.string(),
        seq: z.number(),
        label: z.string(),
        availableQty: z.number(),
      }),
    )
    .default([]),
  /** What is here but in no package. Real and issuable, so it is shown rather
   * than left to be inferred from a subtraction. */
  untaggedQty: z.number().optional(),
});

export type ItemBatchDto = z.infer<typeof itemBatchSchema>;
