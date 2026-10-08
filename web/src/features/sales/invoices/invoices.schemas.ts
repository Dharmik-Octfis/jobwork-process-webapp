/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const invoiceItemSchema = z.object({
  id: z.string().optional(),
  itemId: z.string().min(1, 'Item is required'),
  batchId: z.string().nullable().optional(),
  quantity: z.number().or(z.string()).optional(),
  rate: z.number().or(z.string()).optional(),
  discountPercentage: z.number().or(z.string()).nullable().optional(),
  discount: z.number().or(z.string()).nullable().optional(),
  itemTotal: z.number().or(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  batches: z
    .array(
      z.object({
        batchId: z.string().optional(),
        supplierBatchRef: z.string().optional(),
        manufacturerBatch: z.string().nullable().optional(),
        manufacturedDate: z.string().nullable().optional(),
        expiryDate: z.string().nullable().optional(),
        mrp: z.number().or(z.string()).nullable().optional(),
        sellingPrice: z.number().or(z.string()).nullable().optional(),
        quantity: z.number().or(z.string()),
        units: z
          .array(
            z.object({
              unitId: z.string(),
              label: z.string(),
              quantity: z.number().or(z.string()),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  // Frontend virtual fields for display
  description: z.string().nullable().optional(),
  item: z.any().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().or(z.string()).nullable().optional(),
});

export const InvoiceSchema = z.object({
  id: z.string(),
  customerId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  invoiceNumber: z.string(),
  salesOrderId: z.string().nullable().optional(),
  date: z.string(),
  dueDate: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  subTotal: z.number().or(z.string()).nullable().optional(),
  totalAmount: z.number().or(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  documents: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  deliveryType: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.any()).nullable().optional(),
  lineItems: z.array(invoiceItemSchema).nullable().optional(),
  // Included relations
  customer: z.any().optional(),
  location: z.any().optional(),
});

export const invoicesPageSchema = paginatedSchema(InvoiceSchema);
export type InvoicesPage = Paginated<Invoice>;

export type InvoiceItem = z.infer<typeof invoiceItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type CreateInvoiceData = Omit<
  Invoice,
  'id' | 'customer' | 'location'
>;
export type UpdateInvoiceData = Partial<CreateInvoiceData>;

export const InvoiceActivitySchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  performedBy: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type InvoiceActivity = z.infer<typeof InvoiceActivitySchema>;
