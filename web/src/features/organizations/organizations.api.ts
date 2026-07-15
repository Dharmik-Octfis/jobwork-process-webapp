import { apiClient } from '../../api/client';
import type { Organization, CreateOrganizationData, UpdateOrganizationData } from './organizations.schemas';

export const organizationsApi = {
  getOrganizations: async (): Promise<Organization[]> => {
    const response = await apiClient.get('/organizations');
    return response.data;
  },

  createOrganization: async (data: CreateOrganizationData): Promise<Organization> => {
    const response = await apiClient.post('/organizations', data);
    return response.data;
  },

  updateOrganization: async (id: string, data: UpdateOrganizationData): Promise<Organization> => {
    const response = await apiClient.put(`/organizations/${id}`, data);
    return response.data;
  },

  deleteOrganization: async (id: string): Promise<void> => {
    await apiClient.delete(`/organizations/${id}`);
  },

  getMasterData: async () => {
    const response = await apiClient.get('/master-data');
    return response.data;
  },
};

