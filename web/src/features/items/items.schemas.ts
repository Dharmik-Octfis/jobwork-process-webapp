import { z } from 'zod';

export const itemSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(['Goods', 'Service']).default('Goods'),
  category: z.string().max(100).nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  manufacturer: z.string().max(100).nullable().optional(),
  hsnCode: z.string().max(50).nullable().optional(),
  taxPreference: z.enum(['Taxable', 'Non-Taxable']).default('Taxable'),
  itemType: z.enum(['Single Item', 'Contains Variants']).default('Single Item'),
  unit: z.string().min(1, 'Unit is required').max(50),
  sku: z.string().min(1, 'SKU is required').max(100),
  isSalesInfo: z.boolean().default(false),
  sellingPrice: z.number().nullable().optional(),
  salesAccount: z.string().max(100).nullable().optional(),
  isPurchaseInfo: z.boolean().default(false),
  costPrice: z.number().nullable().optional(),
  purchaseAccount: z.string().max(100).nullable().optional(),
  packaging: z.string().max(100).nullable().optional(),
  deliveryDate: z.string().nullable().optional(),

  frontImage: z.string().nullable().optional(),
  rearImage: z.string().nullable().optional(),
  images: z.array(z.string()).default([]),

  trackInventory: z.boolean().default(false),
  binLocationTracking: z.string().nullable().optional(),
  inventoryTracking: z.string().nullable().optional(),
  inventoryAccount: z.string().nullable().optional(),
  inventoryValuationMethod: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const itemFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['Goods', 'Service']).default('Goods'),
  category: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  hsnCode: z.string().optional().nullable(),
  taxPreference: z.enum(['Taxable', 'Non-Taxable']).default('Taxable'),
  itemType: z.enum(['Single Item', 'Contains Variants']).default('Single Item'),
  unit: z.string().min(1, 'Unit is required'),
  sku: z.string().min(1, 'SKU is required'),

  isSalesInfo: z.boolean().default(false),
  sellingPrice: z.number().optional().nullable(),
  salesAccount: z.string().optional().nullable(),

  isPurchaseInfo: z.boolean().default(false),
  costPrice: z.number().optional().nullable(),
  purchaseAccount: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),

  deliveryDate: z.string().optional().nullable(),

  frontImage: z.string().nullable().optional(),
  rearImage: z.string().nullable().optional(),
  images: z.array(z.string()).default([]),

  trackInventory: z.boolean().default(false),
  binLocationTracking: z.string().nullable().optional(),
  inventoryTracking: z.string().nullable().optional(),
  inventoryAccount: z.string().nullable().optional(),
  inventoryValuationMethod: z.string().nullable().optional(),

  // Dynamic per-org custom fields; validated server-side against the org's definitions.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type Item = z.infer<typeof itemSchema>;
export type ItemFormData = z.infer<typeof itemFormSchema>;
