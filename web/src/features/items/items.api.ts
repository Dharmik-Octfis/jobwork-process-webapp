import { apiClient } from '../../api/client';
import type {
  Item,
  ItemFormData,
  ItemOpeningStockDto,
  ItemOpeningStockLocationRowDto,
} from './items.schemas';
import type { Paginated, PageParams } from '../../lib/pagination';

import { endpoints } from '../../api/endpoints';

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export type ItemsPage = Paginated<Item>;

export const itemsApi = {
  getItems: async (orgId: string, params: PageParams = {}): Promise<ItemsPage> => {
    // The client interceptor already unwrapped the envelope, so `response.data`
    // is the inner `{ results, pageContext }`. Empty params are dropped by axios.
    const response = await apiClient.get(endpoints.seedData.items(orgId), { params });
    return response.data as ItemsPage;
  },

  /** Total matching items — only called when the user clicks "view". */
  getItemCount: async (orgId: string, params: PageParams = {}): Promise<number> => {
    const response = await apiClient.get(`${endpoints.seedData.items(orgId)}/count`, { params });
    return (response.data as { total: number }).total;
  },

  getItem: async (orgId: string, id: string): Promise<Item> => {
    const response = await apiClient.get(`${endpoints.seedData.items(orgId)}/${id}`);
    return response.data;
  },

  createItem: async (orgId: string, data: ItemFormData): Promise<Item> => {
    const response = await apiClient.post(endpoints.seedData.items(orgId), data);
    return response.data;
  },

  updateItem: async ({
    orgId,
    id,
    data,
  }: {
    orgId: string;
    id: string;
    data: Partial<ItemFormData>;
  }): Promise<Item> => {
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
    const response = await apiClient.post(
      `${endpoints.seedData.items(orgId)}/${id}/images`,
      formData,
      {
        transformRequest: [
          (data, headers) => {
            delete headers['Content-Type'];
            return data;
          },
        ],
      },
    );
    return response.data;
  },

  getSignedUrl: async (orgId: string, id: string, key: string): Promise<string> => {
    const response = await apiClient.get<{ url: string }>(
      `${endpoints.seedData.items(orgId)}/${id}/signed-url`,
      {
        params: { key },
      },
    );
    return response.data.url;
  },

  getOpeningStock: async (orgId: string, id: string): Promise<ItemOpeningStockLocationRowDto[]> => {
    const response = await apiClient.get(`${endpoints.seedData.items(orgId)}/${id}/opening-stock`);
    return response.data;
  },

  saveOpeningStock: async (
    orgId: string,
    id: string,
    data: ItemOpeningStockDto,
  ): Promise<ItemOpeningStockLocationRowDto[]> => {
    const response = await apiClient.post(`${endpoints.seedData.items(orgId)}/${id}/opening-stock`, data);
    return response.data;
  },
};
