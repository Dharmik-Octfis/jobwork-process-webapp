import { apiClient } from '../../api/client';
import type { Item, ItemFormData } from './items.schemas.ts';

import { endpoints } from '../../api/endpoints';

export const itemsApi = {
  getItems: async (orgId: string): Promise<Item[]> => {
    const response = await apiClient.get(endpoints.seedData.items(orgId));
    return response.data;
  },

  getItem: async (orgId: string, id: string): Promise<Item> => {
    const response = await apiClient.get(`${endpoints.seedData.items(orgId)}/${id}`);
    return response.data;
  },

  createItem: async (orgId: string, data: ItemFormData): Promise<Item> => {
    const response = await apiClient.post(endpoints.seedData.items(orgId), data);
    return response.data;
  },

  updateItem: async ({ orgId, id, data }: { orgId: string; id: string; data: Partial<ItemFormData> }): Promise<Item> => {
    const response = await apiClient.put(`${endpoints.seedData.items(orgId)}/${id}`, data);
    return response.data;
  },

  deleteItem: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${endpoints.seedData.items(orgId)}/${id}`);
  },

  fetchItemActivities: async (orgId: string, id: string) => {
    const response = await apiClient.get(`${endpoints.seedData.items(orgId)}/${id}/activities`);
    return response.data;
  },

  uploadImages: async (orgId: string, id: string, formData: FormData): Promise<Item> => {
    const response = await apiClient.post(`${endpoints.seedData.items(orgId)}/${id}/images`, formData, {
      transformRequest: [
        (data, headers) => {
          delete headers['Content-Type'];
          return data;
        }
      ]
    });
    return response.data;
  },

  getSignedUrl: async (orgId: string, id: string, key: string): Promise<string> => {
    const response = await apiClient.get<{ url: string }>(`${endpoints.seedData.items(orgId)}/${id}/signed-url`, {
      params: { key }
    });
    return response.data.url;
  },
};
