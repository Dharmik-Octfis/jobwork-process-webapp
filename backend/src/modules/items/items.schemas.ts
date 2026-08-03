import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { openApiRegistry } from '../../config/openapi.ts';

extendZodWithOpenApi(z);

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
    inventoryTracking: z.string().nullable().optional(),
    inventory_tracking: z.string().nullable().optional(),
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
