/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const billItemSchema = z.object({
  id: z.string().optional(),
  billId: z.string().optional(),
  itemId: z.string().min(1, 'Item is required'),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discountPercentage: z.number().or(z.string()).nullable().optional(),
  discount_amount: z.number().or(z.string()).nullable().optional(),
  amount: z.number().or(z.string()).optional(),
  itemTotal: z.number().or(z.string()).nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
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
  vendorId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  billNumber: z.string(),
  billDate: z.string(),
  dueDate: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  subTotal: z.number().or(z.string()).nullable().optional(),
  totalAmount: z.number().or(z.string()).nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  attachments: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  lineItems: z.array(billItemSchema).nullable().optional(),
  // Frontend virtual fields for display
  deliveryType: z.enum(['Location', 'Customer']).nullable().optional(),
  deliveryLocationId: z.string().nullable().optional(),
  deliveryCustomerId: z.string().nullable().optional(),
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
