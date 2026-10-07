/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const SalesOrderItemSchema = z.object({
  id: z.string().optional(),
  lineItemId: z.string().optional(),
  itemId: z.string().min(1, 'Item is required'),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discountPercentage: z.number().or(z.string()).nullable().optional(),
  discount: z.number().or(z.string()).nullable().optional(),
  itemTotal: z.number().or(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  // Frontend virtual fields for display
  description: z.string().nullable().optional(),
  item: z.any().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().or(z.string()).nullable().optional(),
});

export const SalesOrderSchema = z.object({
  id: z.string(),
  customerId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  deliveryLocationId: z.string().nullable().optional(),
  deliveryCustomerId: z.string().nullable().optional(),
  soNumber: z.string().optional(),
  date: z.string().or(z.date()).optional().nullable(),
  deliveryType: z.string().nullable().optional(),
  deliveryDate: z.string().or(z.date()).nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  subTotal: z.number().or(z.string()).or(z.any()).nullable().optional(),
  totalAmount: z.number().or(z.string()).or(z.any()).nullable().optional(),
  total: z.number().or(z.string()).or(z.any()).nullable().optional(),
  notes: z.string().nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  documents: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  lineItems: z.array(SalesOrderItemSchema).nullable().optional(),
  createdAt: z.string().or(z.date()).nullable().optional(),
  updatedAt: z.string().or(z.date()).nullable().optional(),
  // Included relations
  customer: z.any().optional(),
  location: z.any().optional(),
  deliveryLocation: z.any().optional(),
  deliveryCustomer: z.any().optional(),
  bills: z.any().optional(),
}).passthrough();

export const salesOrdersPageSchema = paginatedSchema(SalesOrderSchema);
export type SalesOrdersPage = Paginated<SalesOrder>;

export type SalesOrderItem = z.infer<typeof SalesOrderItemSchema>;
export type SalesOrder = z.infer<typeof SalesOrderSchema>;
export type CreateSalesOrderData = Omit<
  SalesOrder,
  'id' | 'customer' | 'location'
>;
export type UpdateSalesOrderData = Partial<CreateSalesOrderData>;

export const SalesOrderActivitySchema = z.object({
  id: z.string(),
  salesOrderId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type SalesOrderActivity = z.infer<typeof SalesOrderActivitySchema>;
