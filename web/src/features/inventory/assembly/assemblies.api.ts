import { apiClient } from '../../../api/client';
import { z } from 'zod';
import type { Paginated, PageParams } from '../../../lib/pagination';

export interface ItemAssembly {
  id: string;
  assemblyNumber: string;
  assemblyDate: string;
  compositeItemId: string;
  qty: number;
  totalValue: number;
  componentValue: number;
  additionalCost: number;
  status: string;
  direction: string;
  createdAt: string;
  compositeItem?: {
    name: string;
    sku: string;
  };
}

export interface ItemAssemblyLine {
  id: string;
  itemId: string;
  qty: number;
  qtyPerUnit: number;
  unitValue: number;
  value: number;
  item: {
    name: string;
    sku: string;
    type: string;
    stockingUomId: string;
    stockingUom?: {
      unitName: string;
    };
  };
}

export interface DetailedItemAssembly extends ItemAssembly {
  location: { name: string };
  totalValue: number;
  componentValue: number;
  additionalCost: number;
  lines: ItemAssemblyLine[];
}

export type ItemAssemblyPage = Paginated<ItemAssembly>;

export interface ItemAssemblyComment {
  id: string;
  content: string;
  performedBy: string | null;
  createdAt: string;
}

export interface ItemAssemblyActivity {
  id: string;
  title: string;
  description: string | null;
  performedBy: string | null;
  createdAt: string;
}

export const itemAssemblyLineSchema = z.object({
  id: z.string().optional(),
  itemId: z.string(),
  qtyRequired: z.number().min(0),
  batchId: z.string().optional(),
});

export const createAssemblySchema = z.object({
  compositeItemId: z.string().min(1, 'Composite Item is required'),
  assemblyNumber: z.string().optional(),
  remarks: z.string().optional(),
  assemblyDate: z.string().min(1, 'Assembled Date is required'),
  qty: z.number().min(1, 'Quantity must be at least 1'),
  locationId: z.string().min(1, 'Location is required'),
  projectId: z.string().optional(),
  lines: z.array(itemAssemblyLineSchema).optional(),
});

export type CreateAssemblyDto = z.infer<typeof createAssemblySchema>;

export const assembliesApi = {
  createAssembly: async ({ orgId, data }: { orgId: string; data: CreateAssemblyDto }) => {
    const response = await apiClient.post(`/organizations/${orgId}/assemblies`, data);
    return response.data;
  },

  getAssemblies: async (orgId: string, params: PageParams = {}): Promise<ItemAssemblyPage> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies`, { params });
    return response.data as ItemAssemblyPage;
  },

  getById: async (orgId: string, id: string): Promise<DetailedItemAssembly> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies/${id}`);
    return response.data as DetailedItemAssembly;
  },

  getAssemblyCount: async (orgId: string, params: PageParams = {}): Promise<number> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies`, {
      params: { ...params, count: true },
    });
    return (response.data as { count: number }).count;
  },

  getNumberPreference: async (orgId: string): Promise<{ prefix: string; nextNumber: number }> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies/number-preference`);
    return response.data;
  },

  updateNumberPreference: async (
    orgId: string,
    data: { prefix: string; nextNumber: number },
  ): Promise<{ prefix: string; nextNumber: number }> => {
    const response = await apiClient.put(
      `/organizations/${orgId}/assemblies/number-preference`,
      data,
    );
    return response.data;
  },

  deleteAssembly: async (orgId: string, id: string): Promise<void> => {
    await apiClient.delete(`/organizations/${orgId}/assemblies/${id}`);
  },

  getComments: async (orgId: string, id: string): Promise<ItemAssemblyComment[]> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies/${id}/comments`);
    return response.data;
  },

  addComment: async (orgId: string, id: string, content: string): Promise<ItemAssemblyComment> => {
    const response = await apiClient.post(`/organizations/${orgId}/assemblies/${id}/comments`, {
      content,
    });
    return response.data;
  },

  deleteComment: async (orgId: string, id: string, commentId: string): Promise<void> => {
    await apiClient.delete(`/organizations/${orgId}/assemblies/${id}/comments/${commentId}`);
  },

  getActivities: async (orgId: string, id: string): Promise<ItemAssemblyActivity[]> => {
    const response = await apiClient.get(`/organizations/${orgId}/assemblies/${id}/activities`);
    return response.data;
  },
};
