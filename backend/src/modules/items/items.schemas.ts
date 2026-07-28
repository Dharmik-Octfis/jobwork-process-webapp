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
    aliasName: z.string().max(100).nullable().optional(),
    alias_name: z.string().max(100).nullable().optional(),
    type: z.enum(['Goods', 'Service']).default('Goods').openapi({ example: 'Goods' }),
    product_type: z.string().optional(),
    category: z.string().max(100).nullable().optional().openapi({ example: 'Electronics' }),
    brand: z.string().max(100).nullable().optional().openapi({ example: 'Apple' }),
    manufacturer: z.string().max(100).nullable().optional().openapi({ example: 'Foxconn' }),
    hsnCode: z.string().max(50).nullable().optional().openapi({ example: '84713010' }),
    hsn_or_sac: z.string().max(50).nullable().optional(),
    taxPreference: z
      .enum(['Taxable', 'Non-Taxable'])
      .default('Taxable')
      .openapi({ example: 'Taxable' }),
    taxability_type: z.string().optional(),
    is_taxable: z.boolean().optional(),
    itemType: z
      .enum(['Single Item', 'Contains Variants'])
      .default('Single Item')
      .openapi({ example: 'Single Item' }),
    item_type: z.string().optional(),
    unit: z.string().min(1, 'Unit is required').max(50).openapi({ example: 'pcs' }),
    sku: z.string().min(1, 'SKU is required').max(100).openapi({ example: 'SKU-MBP-14-M3' }),
    isSalesInfo: z.boolean().default(false).openapi({ example: true }),
    can_be_sold: z.boolean().optional(),
    sellingPrice: z.number().nullable().optional().openapi({ example: 150000.0 }),
    rate: z.number().nullable().optional(),
    salesAccount: z.string().max(100).nullable().optional().openapi({ example: 'Sales' }),
    account_id: z.string().max(100).nullable().optional(),
    isPurchaseInfo: z.boolean().default(false).openapi({ example: true }),
    can_be_purchased: z.boolean().optional(),
    costPrice: z.number().nullable().optional().openapi({ example: 120000.0 }),
    purchase_rate: z.number().nullable().optional(),
    purchaseAccount: z
      .string()
      .max(100)
      .nullable()
      .optional()
      .openapi({ example: 'Cost of Goods Sold' }),
    purchase_account_id: z.string().max(100).nullable().optional(),
    packaging: z.string().max(100).nullable().optional().openapi({ example: 'Box' }),
    deliveryDate: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .openapi({ example: '2026-07-20T10:00:00Z' }),
    delivery_date: z.string().nullable().optional(),

    frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    front_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    rear_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
    images: z.array(z.union([itemImageAttachmentSchema, z.string()])).default([]),

    trackInventory: z.boolean().default(false),
    track_inventory: z.boolean().optional(),
    binLocationTracking: z.string().nullable().optional(),
    is_storage_location_enabled: z.union([z.boolean(), z.string()]).nullable().optional(),
    inventoryTracking: z.string().nullable().optional(),
    inventory_tracking: z.string().nullable().optional(),
    inventoryAccount: z.string().nullable().optional(),
    inventory_account_id: z.string().nullable().optional(),
    inventoryValuationMethod: z.string().nullable().optional(),
    inventory_valuation_method: z.string().nullable().optional(),
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
      costPrice: z.number().nullable().optional(),
      purchase_rate: z.number().nullable().optional(),
      deliveryDate: z.string().nullable().optional(),
      delivery_date: z.string().nullable().optional(),
    }),
);

export const updateItemSchema = openApiRegistry.register(
  'UpdateItemRequest',
  createItemSchema.partial(),
);

export type Item = z.infer<typeof itemSchema>;
export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
