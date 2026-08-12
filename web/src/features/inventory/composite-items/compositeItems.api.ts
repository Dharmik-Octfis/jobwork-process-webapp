import { apiClient } from '../../../api/client.ts';
import type { Item } from '../../items/items.schemas.ts';
import type { Paginated, PageParams } from '../../../lib/pagination.ts';
import { endpoints } from '../../../api/endpoints.ts';

export type CompositeItemsPage = Paginated<Item>;

export interface CreateCompositeItemDto extends Omit<
  Item,
  'id' | 'createdAt' | 'updatedAt' | 'isDeleted' | 'organizationId' | 'itemType'
> {
  components?: CreateCompositeComponentDto[];
}
export type UpdateCompositeItemDto = Partial<CreateCompositeItemDto>;

/* eslint-disable @typescript-eslint/naming-convention */
export interface CompositeComponent {
  id: string;
  composite_item_id: string;
  component_item_id: string;
  qty_per_unit: number;
  uom_id?: string | null;
  seq: number;
  notes?: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  component?: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    stockingUomId: string | null;
    type: string;
    sellingPrice?: number | null;
    costPrice?: number | null;
  };
}

export interface CreateCompositeComponentDto {
  component_item_id: string;
  qty_per_unit: number;
  uom_id?: string | null;
  seq?: number;
  notes?: string | null;
  custom_fields?: Record<string, unknown>;
}

export type UpdateCompositeComponentDto = Partial<CreateCompositeComponentDto>;
/* eslint-enable @typescript-eslint/naming-convention */

export const compositeItemsApi = {
  getItems: async (orgId: string, params: PageParams = {}): Promise<CompositeItemsPage> => {
    const response = await apiClient.get(endpoints.seedData.compositeItems(orgId), { params });
    return response.data as CompositeItemsPage;
  },

  getItemCount: async (orgId: string, params: PageParams = {}): Promise<number> => {
    const response = await apiClient.get(`${endpoints.seedData.compositeItems(orgId)}/count`, {
      params,
    });
    return (response.data as { total: number }).total;
  },

  getItem: async (orgId: string, id: string): Promise<Item> => {
    const response = await apiClient.get(`${endpoints.seedData.compositeItems(orgId)}/${id}`);
    return response.data;
  },

  createItem: async (orgId: string, data: CreateCompositeItemDto): Promise<Item> => {
    const response = await apiClient.post(endpoints.seedData.compositeItems(orgId), data);
    return response.data;
  },

  updateItem: async ({
    orgId,
    id,
    data,
  }: {
    orgId: string;
    id: string;
    data: UpdateCompositeItemDto;
  }): Promise<Item> => {
    const response = await apiClient.put(`${endpoints.seedData.compositeItems(orgId)}/${id}`, data);
    return response.data;
  },

  deleteItem: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`${endpoints.seedData.compositeItems(orgId)}/${id}`);
  },

  getComponents: async (orgId: string, itemId: string): Promise<CompositeComponent[]> => {
    const res = await apiClient.get(`/organizations/${orgId}/items/${itemId}/components`);
    return res.data;
  },

  createComponent: async (
    orgId: string,
    itemId: string,
    data: CreateCompositeComponentDto,
  ): Promise<CompositeComponent> => {
    const res = await apiClient.post(`/organizations/${orgId}/items/${itemId}/components`, data);
    return res.data;
  },

  updateComponent: async (
    orgId: string,
    itemId: string,
    componentId: string,
    data: UpdateCompositeComponentDto,
  ): Promise<CompositeComponent> => {
    const res = await apiClient.put(
      `/organizations/${orgId}/items/${itemId}/components/${componentId}`,
      data,
    );
    return res.data;
  },

  deleteComponent: async (orgId: string, itemId: string, componentId: string): Promise<void> => {
    await apiClient.delete(`/organizations/${orgId}/items/${itemId}/components/${componentId}`);
  },
};
