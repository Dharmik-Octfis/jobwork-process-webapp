/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const PurchaseOrderItemSchema = z.object({
  id: z.string().optional(),
  line_item_id: z.string().optional(),
  item_id: z.string().min(1, 'Item is required'),
  item_po_status: z.string().nullable().optional(),
  linked_sales_order_id: z.string().nullable().optional(),
  total_weight: z.number().or(z.string()).nullable().optional(),
  cost_price: z.number().or(z.string()).nullable().optional(),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discount_percentage: z.number().or(z.string()).nullable().optional(),
  discount: z.number().or(z.string()).nullable().optional(),
  item_total: z.number().or(z.string()).optional(),
  project_id: z.string().nullable().optional(),
  reporting_tags: z.any().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
  // Frontend virtual fields for display
  description: z.string().nullable().optional(),
  item: z.any().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().or(z.string()).nullable().optional(),
});

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  vendor_id: z.string().nullable().optional(),
  delivery_type: z.string().nullable().optional(),
  delivery_location_id: z.string().nullable().optional(),
  delivery_customer_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  purchaseorder_number: z.string(),
  date: z.string(),
  delivery_date: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  sub_total: z.number().or(z.string()).nullable().optional(),
  total: z.number().or(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  documents: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
  line_items: z.array(PurchaseOrderItemSchema).nullable().optional(),
  // Included relations
  vendor: z.any().optional(),
  deliveryLocation: z.any().optional(),
  deliveryCustomer: z.any().optional(),
  bills: z.array(z.any()).nullable().optional(),
});

export const purchaseOrdersPageSchema = paginatedSchema(PurchaseOrderSchema);
export type PurchaseOrdersPage = Paginated<PurchaseOrder>;

export type PurchaseOrderItem = z.infer<typeof PurchaseOrderItemSchema>;
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
export type CreatePurchaseOrderData = Omit<PurchaseOrder, 'id' | 'vendor' | 'deliveryLocation' | 'deliveryCustomer'>;
export type UpdatePurchaseOrderData = Partial<CreatePurchaseOrderData>;

export const PurchaseOrderActivitySchema = z.object({
  id: z.string(),
  purchaseOrderId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PurchaseOrderActivity = z.infer<typeof PurchaseOrderActivitySchema>;

