import { z } from 'zod';

export const vendorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  vendorName: z.string(),
  vendorNumber: z.string(),
  emailAddress: z.string().nullable(),
  phone: z.string().nullable(),
  gstTreatment: z.string(),
  sourceOfSupply: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Vendor = z.infer<typeof vendorSchema>;

export const createVendorSchema = z.object({
  vendorName: z.string().min(1, 'Vendor Name is required'),
  vendorNumber: z.string().min(1, 'Vendor Number is required'),
  emailAddress: z.string().email('Invalid email address').or(z.literal('')).optional(),
  phone: z.string().optional(),
  gstTreatment: z.string().min(1, 'GST Treatment is required'),
  sourceOfSupply: z.string().min(1, 'Source of Supply is required'),
});

export type CreateVendorData = z.infer<typeof createVendorSchema>;

export const vendorsResponseSchema = z.array(vendorSchema);
