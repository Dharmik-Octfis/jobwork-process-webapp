import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  type Vendor,
  type CreateVendorData,
  type UpdateVendorData,
  type VendorActivity,
  type VendorsPage,
  vendorsPageSchema,
  vendorSchema,
  vendorActivitySchema,
  type VendorComment,
  vendorCommentSchema,
  type VendorAddress,
} from './vendors.schemas';
import { z } from 'zod';

function mapAddressesToFlat(
  data: Record<string, unknown> & { addresses?: VendorAddress[] },
): Record<string, unknown> {
  if (!data || !data.addresses) return data;

  const billing =
    data.addresses.find((a: VendorAddress) => a.addressType === 'billing') ||
    ({} as Partial<VendorAddress>);
  const shipping =
    data.addresses.find((a: VendorAddress) => a.addressType === 'shipping') ||
    ({} as Partial<VendorAddress>);

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
    billingAttention,
    billingCountry,
    billingStreet1,
    billingStreet2,
    billingCity,
    billingState,
    billingPinCode,
    billingPhone,
    shippingAttention,
    shippingCountry,
    shippingStreet1,
    shippingStreet2,
    shippingCity,
    shippingState,
    shippingPinCode,
    shippingPhone,
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
    addresses?: VendorAddress[];
  };

  const addresses = (existingAddresses || []).filter(
    (a) => a.addressType !== 'billing' && a.addressType !== 'shipping',
  );

  if (
    billingStreet1 ||
    billingCity ||
    billingState ||
    billingCountry ||
    billingPinCode ||
    billingPhone ||
    billingAttention
  ) {
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

  if (
    shippingStreet1 ||
    shippingCity ||
    shippingState ||
    shippingCountry ||
    shippingPinCode ||
    shippingPhone ||
    shippingAttention
  ) {
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

export async function fetchVendors(orgId: string, params: PageParams = {}): Promise<VendorsPage> {
  // The client interceptor unwraps the envelope, so `response.data` is already
  // the inner `{ results, pageContext }`. Empty params are dropped by axios.
  const response = await apiClient.get(endpoints.purchases.vendors(orgId), { params });
  const raw = response.data as { results: unknown[]; pageContext: unknown };
  return vendorsPageSchema.parse({
    results: raw.results.map((v) =>
      mapAddressesToFlat(v as Record<string, unknown> & { addresses?: VendorAddress[] }),
    ),
    pageContext: raw.pageContext,
  });
}

/** Total matching vendors — only called when the user clicks "view". */
export async function fetchVendorCount(orgId: string, params: PageParams = {}): Promise<number> {
  const response = await apiClient.get(`${endpoints.purchases.vendors(orgId)}/count`, { params });
  return (response.data as { total: number }).total;
}

export async function createVendor(orgId: string, data: CreateVendorData): Promise<Vendor> {
  const payload = mapFlatToAddresses(data);
  const response = await apiClient.post(endpoints.purchases.vendors(orgId), payload);
  return vendorSchema.parse(mapAddressesToFlat(response.data));
}

export async function fetchVendorById(orgId: string, id: string): Promise<Vendor> {
  const response = await apiClient.get(`${endpoints.purchases.vendors(orgId)}/${id}`);
  return vendorSchema.parse(mapAddressesToFlat(response.data));
}

export async function updateVendor({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateVendorData;
}): Promise<Vendor> {
  const payload = mapFlatToAddresses(data);
  const response = await apiClient.put(`${endpoints.purchases.vendors(orgId)}/${id}`, payload);
  return vendorSchema.parse(mapAddressesToFlat(response.data));
}

export async function deleteVendor(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.vendors(orgId)}/${id}`);
}

export async function fetchVendorActivities(orgId: string, id: string): Promise<VendorActivity[]> {
  const response = await apiClient.get(`${endpoints.purchases.vendors(orgId)}/${id}/activities`);
  return z.array(vendorActivitySchema).parse(response.data);
}

export async function fetchVendorComments(orgId: string, id: string): Promise<VendorComment[]> {
  const response = await apiClient.get(`${endpoints.purchases.vendors(orgId)}/${id}/comments`);
  return z.array(vendorCommentSchema).parse(response.data);
}

export async function addVendorComment(
  orgId: string,
  id: string,
  content: string,
): Promise<VendorComment> {
  const response = await apiClient.post(`${endpoints.purchases.vendors(orgId)}/${id}/comments`, {
    content,
  });
  return vendorCommentSchema.parse(response.data);
}

export async function deleteVendorComment(
  orgId: string,
  vendorId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.vendors(orgId)}/${vendorId}/comments/${commentId}`);
}

export async function fetchVendorNumberPreference(
  orgId: string,
): Promise<{ prefix: string; nextNumber: number }> {
  const response = await apiClient.get(endpoints.purchases.vendorPreferences(orgId));
  return z.object({ prefix: z.string(), nextNumber: z.number() }).parse(response.data);
}

export async function updateVendorNumberPreference(
  orgId: string,
  data: { prefix: string; nextNumber: number },
): Promise<{ prefix: string; nextNumber: number }> {
  const response = await apiClient.put(endpoints.purchases.vendorPreferences(orgId), data);
  return z.object({ prefix: z.string(), nextNumber: z.number() }).parse(response.data);
}
