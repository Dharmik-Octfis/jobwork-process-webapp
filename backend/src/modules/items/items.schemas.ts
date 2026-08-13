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
    product_id: z.string().uuid().optional(),
    organizationId: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
    organization_id: z.string().uuid().optional(),
    name: z
      .string()
      .min(1, 'Name is required')
      .max(200)
      .openapi({ example: 'Apple MacBook Pro M3' }),
    type: z.enum(['Goods', 'Service']).optional().openapi({ example: 'Goods' }),
    product_type: z.string().optional(),
    category: z.string().max(100).nullable().optional().openapi({ example: 'Electronics' }),
    hsnCode: z.string().max(50).nullable().optional().openapi({ example: '84713010' }),
    hsn_or_sac: z.string().max(50).nullable().optional(),
    itemType: z
      .enum(['Single Item', 'Contains Variants'])
      .default('Single Item')
      .openapi({ example: 'Single Item' }),
    item_type: z.string().optional(),
    unit: z.string().max(50).optional().default('').openapi({ example: 'pcs' }),
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
    sku: z.string().max(100).optional().default('').openapi({ example: 'SKU-MBP-14-M3' }),
    isSalesInfo: z.boolean().default(false).openapi({ example: true }),
    can_be_sold: z.boolean().optional(),
    sellingPrice: z.number().nullable().optional().openapi({ example: 150000.0 }),
    rate: z.number().nullable().optional(),
    salesDescription: z.string().nullable().optional(),
    sales_description: z.string().nullable().optional(),
    isPurchaseInfo: z.boolean().default(false).openapi({ example: true }),
    can_be_purchased: z.boolean().optional(),
    costPrice: z.number().nullable().optional().openapi({ example: 120000.0 }),
    purchase_rate: z.number().nullable().optional(),
    purchaseDescription: z.string().nullable().optional(),
    purchase_description: z.string().nullable().optional(),
    packaging: z.string().max(100).nullable().optional().openapi({ example: 'Box' }),

    frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    front_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    rear_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    images: z.array(z.union([itemImageAttachmentSchema, z.string()])).optional(),

    trackInventory: z.boolean().optional(),
    track_inventory: z.boolean().optional(),
    // none | batch. NOT nullable: the column is NOT NULL since the 2026-08-12
    // rename, and an untracked item is the string 'none', never an absent value.
    inventoryTracking: INVENTORY_TRACKING.optional(),
    inventory_tracking: INVENTORY_TRACKING.optional(),
    openingStock: z.number().nullable().optional(),
    openingStockValuePerUnit: z.number().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().optional(),
    created_at: z.string().optional(),
    updatedAt: z.string().optional(),
    updated_at: z.string().optional(),
    createdBy: z.string().nullable().optional(),
    created_by: z.string().nullable().optional(),
    updatedBy: z.string().nullable().optional(),
    updated_by: z.string().nullable().optional(),
    isActive: z.boolean().optional().openapi({ example: true }),
    is_active: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
  }),
);

export const createItemSchema = openApiRegistry.register(
  'CreateItemRequest',
  itemSchema
    .omit({
      id: true,
      product_id: true,
      organizationId: true,
      organization_id: true,
      createdAt: true,
      created_at: true,
      updatedAt: true,
      updated_at: true,
    })
    .extend({
      sellingPrice: z.number().nullable().optional(),
      rate: z.number().nullable().optional(),
      salesDescription: z.string().nullable().optional(),
      sales_description: z.string().nullable().optional(),
      costPrice: z.number().nullable().optional(),
      purchase_rate: z.number().nullable().optional(),
      purchaseDescription: z.string().nullable().optional(),
      purchase_description: z.string().nullable().optional(),
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

export const batchInfoSchema = z.object({
  id: z.string().optional(),
  batchReference: z.string().optional().nullable(),
  manufacturerBatch: z.string().optional().nullable(),
  manufacturedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  sellingPrice: z.union([z.string(), z.number()]).optional().nullable(),
  mrp: z.union([z.string(), z.number()]).optional().nullable(),
  quantityIn: z.union([z.string(), z.number()]).optional().nullable(),
});

export const locationRowSchema = z.object({
  id: z.string().optional(),
  locationId: z.string(),
  openingStock: z.union([z.string(), z.number()]).optional().nullable(),
  openingStockValue: z.union([z.string(), z.number()]).optional().nullable(),
  batches: z.array(batchInfoSchema),
});

export const itemOpeningStockSchema = openApiRegistry.register(
  'ItemOpeningStockRequest',
  z.object({
    locationRows: z.array(locationRowSchema),
  }),
);

export type ItemOpeningStockDto = z.infer<typeof itemOpeningStockSchema>;
