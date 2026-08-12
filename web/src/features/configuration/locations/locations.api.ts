import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';

export interface Location {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  parentId: string | null;
  logo: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  addressString: string | null;
  isPrimary: boolean;
}

export type CreateLocationData = Omit<Location, 'id' | 'organizationId' | 'addressString'>;
export type UpdateLocationData = Partial<CreateLocationData>;

export async function fetchLocations(orgId: string): Promise<Location[]> {
  const response = await apiClient.get(endpoints.configuration.locations(orgId));
  return response.data;
}

export async function fetchLocationById(orgId: string, id: string): Promise<Location> {
  const response = await apiClient.get(`${endpoints.configuration.locations(orgId)}/${id}`);
  return response.data;
}

export async function createLocation(orgId: string, data: CreateLocationData): Promise<Location> {
  const response = await apiClient.post(endpoints.configuration.locations(orgId), data);
  return response.data;
}

export async function updateLocation({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateLocationData;
}): Promise<Location> {
  const response = await apiClient.patch(`${endpoints.configuration.locations(orgId)}/${id}`, data);
  return response.data;
}

export async function deleteLocation(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.configuration.locations(orgId)}/${id}`);
}

export async function markLocationAsPrimary(orgId: string, id: string): Promise<void> {
  await apiClient.post(`${endpoints.configuration.locations(orgId)}/${id}/primary`);
}
