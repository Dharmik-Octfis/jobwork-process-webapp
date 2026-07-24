import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

export const customerContactPersonSchema = z.object({
  id: z.string().optional(),
  salutation: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().email('Invalid email address').or(z.literal('')).nullable().optional(),
  workPhone: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
});

export const customerAddressSchema = z.object({
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
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

export const customerSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  customerType: z.string(),
  primaryContactSalutation: z.string().nullable(),
  primaryContactFirstName: z.string().nullable(),
  primaryContactLastName: z.string().nullable(),
  companyName: z.string().nullable(),
  displayName: z.string(),
  customerNumber: z.string(),
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
  contactPersons: z.array(customerContactPersonSchema).optional(),
  addresses: z.array(customerAddressSchema).optional(),

  // Kept on the response so `cf:<key>` columns chosen in Customize Columns can be
  // rendered. Without it zod would strip the blob and those columns render blank.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type Customer = z.infer<typeof customerSchema>;
export type CustomerContactPerson = z.infer<typeof customerContactPersonSchema>;

export const customerActivitySchema = z.object({
  id: z.string(),
  customerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  performedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type CustomerActivity = z.infer<typeof customerActivitySchema>;

export const createCustomerSchema = z.object({
  organizationId: z.string().optional(),
  customerType: z.enum(['business', 'individual']),
  primaryContactSalutation: z.string().nullable().optional(),
  primaryContactFirstName: z.string().nullable().optional(),
  primaryContactLastName: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  displayName: z.string().min(1, 'Display Name is required'),
  customerNumber: z.string().min(1, 'Customer Number is required'),
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

  contactPersons: z.array(customerContactPersonSchema).optional(),
  addresses: z.array(customerAddressSchema).optional(),

  // Dynamic per-org custom fields. Kept loose here; validated server-side against
  // this org's field definitions.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type CreateCustomerData = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.extend({
  status: z.string().optional(),
});

export type UpdateCustomerData = z.infer<typeof updateCustomerSchema>;

export const customerCommentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  content: z.string(),
  performedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type CustomerComment = z.infer<typeof customerCommentSchema>;

export const customersResponseSchema = z.array(customerSchema);

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const customersPageSchema = paginatedSchema(customerSchema);
export type CustomersPage = Paginated<Customer>;
