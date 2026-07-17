import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import {
  type Vendor,
  type CreateVendorData,
  vendorsResponseSchema,
  vendorSchema,
} from './vendors.schemas';

export async function fetchVendors(orgId: string): Promise<Vendor[]> {
  const response = await apiClient.get(endpoints.purchases.vendors(orgId));
  return vendorsResponseSchema.parse(response.data);
}

export async function createVendor(orgId: string, data: CreateVendorData): Promise<Vendor> {
  const response = await apiClient.post(endpoints.purchases.vendors(orgId), data);
  return vendorSchema.parse(response.data);
}

export async function fetchVendorById(orgId: string, id: string): Promise<Vendor> {
  const response = await apiClient.get(`${endpoints.purchases.vendors(orgId)}/${id}`);
  return vendorSchema.parse(response.data);
}

export async function updateVendor({ orgId, id, data }: { orgId: string; id: string; data: CreateVendorData }): Promise<Vendor> {
  const response = await apiClient.put(`${endpoints.purchases.vendors(orgId)}/${id}`, data);
  return vendorSchema.parse(response.data);
}

export async function deleteVendor(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.vendors(orgId)}/${id}`);
}
