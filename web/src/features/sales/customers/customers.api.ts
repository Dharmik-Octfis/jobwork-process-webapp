import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import {
  type Customer,
  type CreateCustomerData,
  type UpdateCustomerData,
  type CustomerActivity,
  customersResponseSchema,
  customerSchema,
  customerActivitySchema,
  type CustomerComment,
  customerCommentSchema,
  type CustomerAddress,
} from './customers.schemas';
import { z } from 'zod';

function mapAddressesToFlat(data: Record<string, unknown> & { addresses?: CustomerAddress[] }): Record<string, unknown> {
  if (!data || !data.addresses) return data;
  
  const billing = data.addresses.find((a: CustomerAddress) => a.addressType === 'billing') || {} as Partial<CustomerAddress>;
  const shipping = data.addresses.find((a: CustomerAddress) => a.addressType === 'shipping') || {} as Partial<CustomerAddress>;

  return {
    ...data,
    billingAttention: billing.attention || null,
    billingCountry: billing.country || null,
    billingStreet1: billing.street1 || null,
    billingStreet2: billing.street2 || null,
    billingCity: billing.city || null,
    billingState: billing.state || null,
    billingPinCode: billing.pinCode || null,
    billingPhone: billing.phone || null,
    shippingAttention: shipping.attention || null,
    shippingCountry: shipping.country || null,
    shippingStreet1: shipping.street1 || null,
    shippingStreet2: shipping.street2 || null,
    shippingCity: shipping.city || null,
    shippingState: shipping.state || null,
    shippingPinCode: shipping.pinCode || null,
    shippingPhone: shipping.phone || null,
  };
}

function mapFlatToAddresses(data: Record<string, unknown>): Record<string, unknown> {
  if (!data) return data;
  
  const {
    billingAttention, billingCountry, billingStreet1, billingStreet2,
    billingCity, billingState, billingPinCode, billingPhone,
    shippingAttention, shippingCountry, shippingStreet1, shippingStreet2,
    shippingCity, shippingState, shippingPinCode, shippingPhone,
    addresses: existingAddresses,
    ...rest
  } = data as Record<string, unknown> & {
    billingAttention?: string | null;
    billingCountry?: string | null;
    billingStreet1?: string | null;
    billingStreet2?: string | null;
    billingCity?: string | null;
    billingState?: string | null;
    billingPinCode?: string | null;
    billingPhone?: string | null;
    shippingAttention?: string | null;
    shippingCountry?: string | null;
    shippingStreet1?: string | null;
    shippingStreet2?: string | null;
    shippingCity?: string | null;
    shippingState?: string | null;
    shippingPinCode?: string | null;
    shippingPhone?: string | null;
    addresses?: CustomerAddress[];
  };

  const addresses = (existingAddresses || []).filter(a => a.addressType !== 'billing' && a.addressType !== 'shipping');

  if (billingStreet1 || billingCity || billingState || billingCountry || billingPinCode || billingPhone || billingAttention) {
    addresses.push({
      addressType: 'billing',
      attention: billingAttention,
      country: billingCountry,
      street1: billingStreet1,
      street2: billingStreet2,
      city: billingCity,
      state: billingState,
      pinCode: billingPinCode,
      phone: billingPhone,
    });
  }

  if (shippingStreet1 || shippingCity || shippingState || shippingCountry || shippingPinCode || shippingPhone || shippingAttention) {
    addresses.push({
      addressType: 'shipping',
      attention: shippingAttention,
      country: shippingCountry,
      street1: shippingStreet1,
      street2: shippingStreet2,
      city: shippingCity,
      state: shippingState,
      pinCode: shippingPinCode,
      phone: shippingPhone,
    });
  }

  return { ...rest, addresses };
}

export async function fetchCustomers(orgId: string): Promise<Customer[]> {
  const response = await apiClient.get(endpoints.sales.customers(orgId));
  return customersResponseSchema.parse(response.data.map(mapAddressesToFlat));
}

export async function createCustomer(orgId: string, data: CreateCustomerData): Promise<Customer> {
  const payload = mapFlatToAddresses(data);
  const response = await apiClient.post(endpoints.sales.customers(orgId), payload);
  return customerSchema.parse(mapAddressesToFlat(response.data));
}

export async function fetchCustomerById(orgId: string, id: string): Promise<Customer> {
  const response = await apiClient.get(`${endpoints.sales.customers(orgId)}/${id}`);
  return customerSchema.parse(mapAddressesToFlat(response.data));
}

export async function updateCustomer({ orgId, id, data }: { orgId: string; id: string; data: UpdateCustomerData }): Promise<Customer> {
  const payload = mapFlatToAddresses(data);
  const response = await apiClient.put(`${endpoints.sales.customers(orgId)}/${id}`, payload);
  return customerSchema.parse(mapAddressesToFlat(response.data));
}

export async function deleteCustomer(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.sales.customers(orgId)}/${id}`);
}

export async function fetchCustomerActivities(orgId: string, id: string): Promise<CustomerActivity[]> {
  const response = await apiClient.get(`${endpoints.sales.customers(orgId)}/${id}/activities`);
  return z.array(customerActivitySchema).parse(response.data);
}

export async function fetchCustomerComments(orgId: string, id: string): Promise<CustomerComment[]> {
  const response = await apiClient.get(`${endpoints.sales.customers(orgId)}/${id}/comments`);
  return z.array(customerCommentSchema).parse(response.data);
}

export async function addCustomerComment(orgId: string, id: string, content: string): Promise<CustomerComment> {
  const response = await apiClient.post(`${endpoints.sales.customers(orgId)}/${id}/comments`, { content });
  return customerCommentSchema.parse(response.data);
}

export async function deleteCustomerComment(orgId: string, customerId: string, commentId: string): Promise<void> {
  await apiClient.delete(`${endpoints.sales.customers(orgId)}/${customerId}/comments/${commentId}`);
}

export async function fetchCustomerNumberPreference(orgId: string): Promise<{ prefix: string; nextNumber: number }> {
  const response = await apiClient.get(endpoints.sales.customerPreferences(orgId));
  return z.object({ prefix: z.string(), nextNumber: z.number() }).parse(response.data);
}

export async function updateCustomerNumberPreference(orgId: string, data: { prefix: string; nextNumber: number }): Promise<{ prefix: string; nextNumber: number }> {
  const response = await apiClient.put(endpoints.sales.customerPreferences(orgId), data);
  return z.object({ prefix: z.string(), nextNumber: z.number() }).parse(response.data);
}
