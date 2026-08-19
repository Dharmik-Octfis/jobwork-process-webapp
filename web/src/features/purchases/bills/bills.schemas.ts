/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const billItemSchema = z.object({
  id: z.string().optional(),
  billId: z.string().optional(),
  item_id: z.string().min(1, 'Item is required'),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discount_percentage: z.number().or(z.string()).nullable().optional(),
  discount_amount: z.number().or(z.string()).nullable().optional(),
  amount: z.number().or(z.string()).optional(),
  item_total: z.number().or(z.string()).nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
  // Frontend virtual fields for display
  description: z.string().nullable().optional(),
  item: z.any().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().or(z.string()).nullable().optional(),
  batches: z
    .array(
      z.object({
        supplierBatchRef: z.string().optional(),
        manufacturerBatch: z.string().nullable().optional(),
        manufacturedDate: z.string().nullable().optional(),
        expiryDate: z.string().nullable().optional(),
        mrp: z.number().or(z.string()).nullable().optional(),
        sellingPrice: z.number().or(z.string()).nullable().optional(),
        quantity: z.number().or(z.string()),
      }),
    )
    .optional(),
});

export const billSchema = z.object({
  id: z.string(),
  vendor_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  bill_number: z.string(),
  bill_date: z.string(),
  due_date: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  sub_total: z.number().or(z.string()).nullable().optional(),
  total_amount: z.number().or(z.string()).nullable().optional(),
  total: z.number().or(z.string()).nullable().optional(),
  terms_and_conditions: z.string().nullable().optional(),
  attachments: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
  line_items: z.array(billItemSchema).nullable().optional(),
  // Frontend virtual fields for display
  delivery_type: z.enum(['Location', 'Customer']).nullable().optional(),
  delivery_location_id: z.string().nullable().optional(),
  delivery_customer_id: z.string().nullable().optional(),
  // Included relations
  vendor: z.any().optional(),
  location: z.any().optional(),
});

export const billsPageSchema = paginatedSchema(billSchema);
export type BillsPage = Paginated<Bill>;

export type BillItem = z.infer<typeof billItemSchema>;
export type Bill = z.infer<typeof billSchema>;
export type CreateBillData = Omit<Bill, 'id' | 'vendor' | 'location'>;
export type UpdateBillData = Partial<CreateBillData>;

export const billActivitySchema = z.object({
  id: z.string(),
  billId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type BillActivity = z.infer<typeof billActivitySchema>;
