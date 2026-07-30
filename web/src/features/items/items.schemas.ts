/* eslint-disable @typescript-eslint/naming-convention */
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
  product_id: z.string().optional(),
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(['Goods', 'Service']).default('Goods'),
  product_type: z.string().optional(),
  category: z.string().max(100).nullable().optional(),
  hsnCode: z.string().max(50).nullable().optional(),
  hsn_or_sac: z.string().max(50).nullable().optional(),
  taxability_type: z.string().optional(),
  is_taxable: z.boolean().optional(),
  itemType: z.enum(['Single Item', 'Contains Variants']).default('Single Item'),
  item_type: z.string().optional(),
  unit: z.string().min(1, 'Unit is required').max(50),
  sku: z.string().min(1, 'SKU is required').max(100),
  isSalesInfo: z.boolean().default(true),
  can_be_sold: z.boolean().optional(),
  sellingPrice: z.number().nullable().optional(),
  rate: z.number().nullable().optional(),
  account_id: z.string().max(100).nullable().optional(),
  salesDescription: z.string().nullable().optional(),
  sales_description: z.string().nullable().optional(),
  isPurchaseInfo: z.boolean().default(true),
  can_be_purchased: z.boolean().optional(),
  costPrice: z.number().nullable().optional(),
  purchase_rate: z.number().nullable().optional(),
  purchaseDescription: z.string().nullable().optional(),
  purchase_description: z.string().nullable().optional(),
  packaging: z.string().max(100).nullable().optional(),
  delivery_date: z.string().nullable().optional(),

  frontImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  front_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  rearImage: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  rear_image: z.union([itemImageAttachmentSchema, z.string()]).nullable().optional(),
  images: z.array(z.union([itemImageAttachmentSchema, z.string()])).default([]),

  trackInventory: z.boolean().default(true),
  track_inventory: z.boolean().optional(),
  is_storage_location_enabled: z.union([z.boolean(), z.string()]).nullable().optional(),
  inventoryTracking: z.string().nullable().optional(),
  openingStock: z.number().nullable().optional(),
  opening_stock: z.number().nullable().optional(),
  openingStockValuePerUnit: z.number().nullable().optional(),
  inventory_tracking: z.string().nullable().optional(),
  inventory_account_id: z.string().nullable().optional(),
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
  isActive: z.boolean().default(true),
  is_active: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['Goods', 'Service']).default('Goods'),
  category: z.string().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  itemType: z.enum(['Single Item', 'Contains Variants']).default('Single Item'),
  unit: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),

  isSalesInfo: z.boolean().default(true),
  sellingPrice: z.number().optional().nullable(),
  salesDescription: z.string().optional().nullable(),

  isPurchaseInfo: z.boolean().default(true),
  costPrice: z.number().optional().nullable(),
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
