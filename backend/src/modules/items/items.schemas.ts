import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { openApiRegistry } from '../../config/openapi.ts';

extendZodWithOpenApi(z);

/**
 * How much batch detail the user sees. `none` still creates a batch internally —
 * see `Item.inventoryTracking` in the schema. Accepts the form's capitalised
 * labels so an older client cannot silently write an unrecognised value.
 */
export const INVENTORY_TRACKING = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['none', 'batch']));

export const itemImageAttachmentSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  size: z.number().optional(),
  type: z.string().optional(),
});

export const itemSchema = openApiRegistry.register(
  'Item',
  z.object({
    id: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    organizationId: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
    name: z
      .string()
      .min(1, 'Name is required')
      .max(200)
      .openapi({ example: 'Apple MacBook Pro M3' }),
    itemType: z.enum(['goods', 'service']).optional().openapi({ example: 'goods' }),
    category: z.string().max(100).nullable().optional().openapi({ example: 'Electronics' }),
    hsnCode: z.string().max(50).nullable().optional().openapi({ example: '84713010' }),
    itemStructure: z
      .enum(['single', 'variants', 'composite'])
      .optional()
      .openapi({ example: 'single' }),
    unit: z.string().max(50).optional().openapi({ example: 'pcs' }),
    /**
     * 🔴 THE UNIT THE LEDGER MOVES THIS ITEM IN. One item, one stocking unit
     * (jobwork domain §5.1) — every batch, every challan line and every balance is
     * denominated in it, and nothing converts between units anywhere.
     *
     * Distinct from `unit` above, which is a free string this form has always
     * shown. The two are set together from the same dropdown; collapsing them is
     * a larger change and is not blocking (spec I-5).
     *
     * Nullable: the Sprint 1 backfill matched `unit` against the UoM master and
     * left the rows that did not match with none. A loud, fixable gap beats a
     * value invented for every unmatched row (spec I-2).
     */
    stockingUomId: z.string().uuid().nullable().optional(),
    sku: z.string().max(100).optional().openapi({ example: 'SKU-MBP-14-M3' }),
    isSalesInfo: z.boolean().optional().openapi({ example: true }),
    sellingPrice: z.number().nullable().optional().openapi({ example: 150000.0 }),
    salesDescription: z.string().nullable().optional(),
    isPurchaseInfo: z.boolean().optional().openapi({ example: true }),
    costPrice: z.number().nullable().optional().openapi({ example: 120000.0 }),
    purchaseDescription: z.string().nullable().optional(),
    packaging: z.string().max(100).nullable().optional().openapi({ example: 'Box' }),

    frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    images: z.array(z.union([itemImageAttachmentSchema, z.string()])).optional(),

    trackInventory: z.boolean().optional(),
    // none | batch. NOT nullable: the column is NOT NULL since the 2026-08-12
    // rename, and an untracked item is the string 'none', never an absent value.
    inventoryTracking: INVENTORY_TRACKING.optional(),
    openingStock: z.number().nullable().optional(),
    openingStockValuePerUnit: z.number().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    createdBy: z.string().nullable().optional(),
    updatedBy: z.string().nullable().optional(),
    isActive: z.boolean().optional().openapi({ example: true }),
    isDeleted: z.boolean().optional(),
  }),
);

export const createItemSchema = openApiRegistry.register(
  'CreateItemRequest',
  itemSchema
    .omit({
      id: true,
      organizationId: true,
      createdAt: true,
      updatedAt: true,
    })
    .extend({
      sellingPrice: z.number().nullable().optional(),
      salesDescription: z.string().nullable().optional(),
      costPrice: z.number().nullable().optional(),
      purchaseDescription: z.string().nullable().optional(),
      openingStock: z.number().nullable().optional(),
      openingStockValuePerUnit: z.number().nullable().optional(),
    }),
);

export const updateItemSchema = openApiRegistry.register(
  'UpdateItemRequest',
  createItemSchema.partial(),
);

export type Item = z.infer<typeof itemSchema>;
export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

/**
 * One package inside a declared batch — a taka, roll, bale — when the org runs a
 * unit level.
 *
 * `id` is the real `batch_units.id`, round-tripped by the form. A row carrying a
 * known one is that package EDITED; a row without is a new package; and a package
 * the payload never mentions was deleted. Exactly the contract `batchInfoSchema`'s
 * own `id` has one level up, and for the same reason: without it the writer has to
 * reverse everything and re-create, which is what made a re-save destructive.
 */
export const batchUnitInfoSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional().nullable(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
});

export const batchInfoSchema = z.object({
  id: z.string().optional(),
  batchReference: z.string().optional().nullable(),
  manufacturerBatch: z.string().optional().nullable(),
  manufacturedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  sellingPrice: z.union([z.string(), z.number()]).optional().nullable(),
  mrp: z.union([z.string(), z.number()]).optional().nullable(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
  /** The packages inside this batch. Naming them is optional; naming SOME of them
   * is not (2026-09-02) — name none and the whole batch is untagged, name one and
   * they must add up to the batch. The service enforces it. */
  units: z.array(batchUnitInfoSchema).optional(),
});

export const locationRowSchema = z.object({
  id: z.string().optional(),
  locationId: z.string(),
  openingStock: z.union([z.string(), z.number()]).optional().nullable(),
  openingStockValue: z.union([z.string(), z.number()]).optional().nullable(),
  // Optional: an item at `inventoryTracking = none` declares a bulk quantity and
  // names no batches. The service still creates one internally.
  batches: z.array(batchInfoSchema).optional().default([]),
});

export const itemOpeningStockSchema = openApiRegistry.register(
  'ItemOpeningStockRequest',
  z.object({
    locationRows: z.array(locationRowSchema),
    /**
     * Whose goods these are — applied to batches this save CREATES, never to ones
     * it merely adjusts. The Item screen omits it and gets `own`; the Issue dialog
     * passes the job order's, because a customer-ownership order can only be fed
     * by customer-owned stock (the availability query filters on it, §5.2) and
     * stock added as our own would appear to have vanished.
     */
    ownership: z.enum(['own', 'customer']).optional(),
    ownerPartyId: z.string().uuid().nullable().optional(),
  }),
);

export type ItemOpeningStockDto = z.infer<typeof itemOpeningStockSchema>;
