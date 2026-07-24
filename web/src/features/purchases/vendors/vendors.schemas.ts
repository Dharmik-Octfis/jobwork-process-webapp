import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const vendorContactPersonSchema = z.object({
  id: z.string().optional(),
  salutation: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().email('Invalid email address').or(z.literal('')).nullable().optional(),
  workPhone: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
});

export const vendorAddressSchema = z.object({
  id: z.string().optional(),
  addressType: z.string().min(1),
  attention: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  street1: z.string().nullable().optional(),
  street2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  pinCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type VendorAddress = z.infer<typeof vendorAddressSchema>;

export const vendorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  primaryContactSalutation: z.string().nullable(),
  primaryContactFirstName: z.string().nullable(),
  primaryContactLastName: z.string().nullable(),
  companyName: z.string().nullable(),
  displayName: z.string(),
  vendorNumber: z.string(),
  emailAddress: z.string().nullable(),
  workPhone: z.string().nullable(),
  mobilePhone: z.string().nullable(),
  currency: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  remarks: z.string().nullable().optional(),
  billingAttention: z.string().nullable(),
  billingCountry: z.string().nullable(),
  billingStreet1: z.string().nullable(),
  billingStreet2: z.string().nullable(),
  billingCity: z.string().nullable(),
  billingState: z.string().nullable(),
  billingPinCode: z.string().nullable(),
  billingPhone: z.string().nullable(),
  shippingAttention: z.string().nullable(),
  shippingCountry: z.string().nullable(),
  shippingStreet1: z.string().nullable(),
  shippingStreet2: z.string().nullable(),
  shippingCity: z.string().nullable(),
  shippingState: z.string().nullable(),
  shippingPinCode: z.string().nullable(),
  shippingPhone: z.string().nullable(),
  status: z.string().default('active'),

  createdAt: z.string(),
  updatedAt: z.string(),
  contactPersons: z.array(vendorContactPersonSchema).optional(),
  addresses: z.array(vendorAddressSchema).optional(),
});

export type Vendor = z.infer<typeof vendorSchema>;
export type VendorContactPerson = z.infer<typeof vendorContactPersonSchema>;

export const vendorActivitySchema = z.object({
  id: z.string(),
  vendorId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  performedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type VendorActivity = z.infer<typeof vendorActivitySchema>;

export const createVendorSchema = z.object({
  organizationId: z.string().optional(),
  primaryContactSalutation: z.string().nullable().optional(),
  primaryContactFirstName: z.string().nullable().optional(),
  primaryContactLastName: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  displayName: z.string().min(1, 'Display Name is required'),
  vendorNumber: z.string().min(1, 'Vendor Number is required'),
  emailAddress: z.string().email('Invalid email address').or(z.literal('')).optional(),
  workPhone: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  billingAttention: z.string().nullable().optional(),
  billingCountry: z.string().nullable().optional(),
  billingStreet1: z.string().nullable().optional(),
  billingStreet2: z.string().nullable().optional(),
  billingCity: z.string().nullable().optional(),
  billingState: z.string().nullable().optional(),
  billingPinCode: z.string().nullable().optional(),
  billingPhone: z.string().nullable().optional(),
  shippingAttention: z.string().nullable().optional(),
  shippingCountry: z.string().nullable().optional(),
  shippingStreet1: z.string().nullable().optional(),
  shippingStreet2: z.string().nullable().optional(),
  shippingCity: z.string().nullable().optional(),
  shippingState: z.string().nullable().optional(),
  shippingPinCode: z.string().nullable().optional(),
  shippingPhone: z.string().nullable().optional(),

  contactPersons: z.array(vendorContactPersonSchema).optional(),
  addresses: z.array(vendorAddressSchema).optional(),

  // Dynamic per-org custom fields. Kept loose here; validated server-side against
  // this org's field definitions.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type CreateVendorData = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.extend({
  status: z.string().optional(),
});

export type UpdateVendorData = z.infer<typeof updateVendorSchema>;

export const vendorCommentSchema = z.object({
  id: z.string(),
  vendorId: z.string(),
  content: z.string(),
  performedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type VendorComment = z.infer<typeof vendorCommentSchema>;

export const vendorsResponseSchema = z.array(vendorSchema);

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const vendorsPageSchema = paginatedSchema(vendorSchema);
export type VendorsPage = Paginated<Vendor>;
