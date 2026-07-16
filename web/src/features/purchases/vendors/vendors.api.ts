import { apiClient } from '../../../api/client';
import { type Vendor, type CreateVendorData, vendorsResponseSchema, vendorSchema } from './vendors.schemas';

export async function fetchVendors(): Promise<Vendor[]> {
  const response = await apiClient.get('/purchases/vendors');
  return vendorsResponseSchema.parse(response.data);
}

export async function createVendor(data: CreateVendorData): Promise<Vendor> {
  const response = await apiClient.post('/purchases/vendors', data);
  return vendorSchema.parse(response.data);
}
