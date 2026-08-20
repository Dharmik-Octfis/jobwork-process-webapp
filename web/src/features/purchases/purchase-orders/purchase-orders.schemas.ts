/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const PurchaseOrderItemSchema = z.object({
  id: z.string().optional(),
  lineItemId: z.string().optional(),
  itemId: z.string().min(1, 'Item is required'),
  itemPoStatus: z.string().nullable().optional(),
  linkedSalesOrderId: z.string().nullable().optional(),
  totalWeight: z.number().or(z.string()).nullable().optional(),
  costPrice: z.number().or(z.string()).nullable().optional(),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discountPercentage: z.number().or(z.string()).nullable().optional(),
  discount: z.number().or(z.string()).nullable().optional(),
  itemTotal: z.number().or(z.string()).optional(),
  projectId: z.string().nullable().optional(),
  reportingTags: z.any().nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  // Frontend virtual fields for display
  description: z.string().nullable().optional(),
  item: z.any().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().or(z.string()).nullable().optional(),
});

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  vendorId: z.string().nullable().optional(),
  deliveryType: z.string().nullable().optional(),
  deliveryLocationId: z.string().nullable().optional(),
  deliveryCustomerId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  poNumber: z.string(),
  date: z.string(),
  deliveryDate: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  subTotal: z.number().or(z.string()).nullable().optional(),
  totalAmount: z.number().or(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  documents: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  lineItems: z.array(PurchaseOrderItemSchema).nullable().optional(),
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
export type CreatePurchaseOrderData = Omit<
  PurchaseOrder,
  'id' | 'vendor' | 'deliveryLocation' | 'deliveryCustomer'
>;
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
