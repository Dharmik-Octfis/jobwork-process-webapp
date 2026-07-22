import { apiClient } from '../../api/client';
import type { Item, ItemFormData } from './items.schemas.ts';

import { endpoints } from '../../api/endpoints';

export const itemsApi = {
  getItems: async (orgId: string): Promise<Item[]> => {
    const response = await apiClient.get(endpoints.masterData.items(orgId));
    return response.data;
  },

  getItem: async (orgId: string, id: string): Promise<Item> => {
    const response = await apiClient.get(`${endpoints.masterData.items(orgId)}/${id}`);
    return response.data;
  },

  createItem: async (orgId: string, data: ItemFormData): Promise<Item> => {
    const response = await apiClient.post(endpoints.masterData.items(orgId), data);
    return response.data;
  },

  updateItem: async ({ orgId, id, data }: { orgId: string; id: string; data: ItemFormData }): Promise<Item> => {
    const response = await apiClient.put(`${endpoints.masterData.items(orgId)}/${id}`, data);
    return response.data;
  },

  deleteItem: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${endpoints.masterData.items(orgId)}/${id}`);
  },

  fetchItemActivities: async (orgId: string, id: string) => {
    const response = await apiClient.get(`${endpoints.masterData.items(orgId)}/${id}/activities`);
    return response.data;
  },

  uploadImages: async (orgId: string, id: string, formData: FormData): Promise<Item> => {
    const response = await apiClient.post(`${endpoints.masterData.items(orgId)}/${id}/images`, formData, {
      transformRequest: [
        (data, headers) => {
          delete headers['Content-Type'];
          return data;
        }
      ]
    });
    return response.data;
  },
};
