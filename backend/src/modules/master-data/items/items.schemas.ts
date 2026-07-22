import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { openApiRegistry } from '../../../config/openapi.ts';

extendZodWithOpenApi(z);

export const itemSchema = openApiRegistry.register(
  'Item',
  z.object({
    id: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    organizationId: z.string().uuid().openapi({ example: '123e4567-e89b-12d3-a456-426614174001' }),
    name: z.string().min(1, 'Name is required').max(200).openapi({ example: 'Apple MacBook Pro M3' }),
    type: z.enum(['Goods', 'Service']).default('Goods').openapi({ example: 'Goods' }),
    category: z.string().max(100).nullable().optional().openapi({ example: 'Electronics' }),
    brand: z.string().max(100).nullable().optional().openapi({ example: 'Apple' }),
    manufacturer: z.string().max(100).nullable().optional().openapi({ example: 'Foxconn' }),
    hsnCode: z.string().max(50).nullable().optional().openapi({ example: '84713010' }),
    taxPreference: z.enum(['Taxable', 'Non-Taxable']).default('Taxable').openapi({ example: 'Taxable' }),
    itemType: z.enum(['Single Item', 'Contains Variants']).default('Single Item').openapi({ example: 'Single Item' }),
    unit: z.string().min(1, 'Unit is required').max(50).openapi({ example: 'pcs' }),
    sku: z.string().min(1, 'SKU is required').max(100).openapi({ example: 'SKU-MBP-14-M3' }),
    isSalesInfo: z.boolean().default(false).openapi({ example: true }),
    sellingPrice: z.number().nullable().optional().openapi({ example: 150000.0 }),
    salesAccount: z.string().max(100).nullable().optional().openapi({ example: 'Sales' }),
    isPurchaseInfo: z.boolean().default(false).openapi({ example: true }),
    costPrice: z.number().nullable().optional().openapi({ example: 120000.0 }),
    purchaseAccount: z.string().max(100).nullable().optional().openapi({ example: 'Cost of Goods Sold' }),
    packaging: z.string().max(100).nullable().optional().openapi({ example: 'Box' }),
    deliveryDate: z.string().datetime().nullable().optional().openapi({ example: '2026-07-20T10:00:00Z' }),
    
    frontImage: z.string().nullable().optional(),
    rearImage: z.string().nullable().optional(),
    images: z.array(z.string()).default([]),

    trackInventory: z.boolean().default(false),
    binLocationTracking: z.string().nullable().optional(),
    inventoryTracking: z.string().nullable().optional(),
    inventoryAccount: z.string().nullable().optional(),
    inventoryValuationMethod: z.string().nullable().optional(),
    createdAt: z.string().datetime().openapi({ example: '2026-07-17T12:00:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-07-17T12:00:00Z' }),
  })
);

export const createItemSchema = openApiRegistry.register(
  'CreateItemRequest',
  itemSchema.omit({
    id: true,
    organizationId: true,
    createdAt: true,
    updatedAt: true,
  }).extend({
    sellingPrice: z.number().nullable().optional().openapi({ example: 150000.0 }),
    costPrice: z.number().nullable().optional().openapi({ example: 120000.0 }),
    deliveryDate: z.string().nullable().optional().openapi({ example: '2026-07-20' }), // Using string for date input
  })
);

export const updateItemSchema = openApiRegistry.register(
  'UpdateItemRequest',
  createItemSchema.partial()
);

export type Item = z.infer<typeof itemSchema>;
export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
