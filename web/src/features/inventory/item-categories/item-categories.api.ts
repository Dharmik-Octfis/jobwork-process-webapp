import { apiClient } from '../../../api/client';

export interface ItemCategory {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CreateItemCategoryDto {
  name: string;
  parentId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateItemCategoryDto extends Partial<CreateItemCategoryDto> {}

export async function fetchItemCategories(orgId: string): Promise<ItemCategory[]> {
  const { data } = await apiClient.get(`/organizations/${orgId}/inventory/item-categories`);
  return data;
}

export async function createItemCategory(orgId: string, data: CreateItemCategoryDto): Promise<ItemCategory> {
  const response = await apiClient.post(`/organizations/${orgId}/inventory/item-categories`, data);
  return response.data;
}

export async function updateItemCategory(orgId: string, id: string, data: UpdateItemCategoryDto): Promise<ItemCategory> {
  const response = await apiClient.put(`/organizations/${orgId}/inventory/item-categories/${id}`, data);
  return response.data;
}

export async function deleteItemCategory(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`/organizations/${orgId}/inventory/item-categories/${id}`);
}
