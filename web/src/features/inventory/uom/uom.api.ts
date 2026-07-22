import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import type { Uom, CreateUomData, UpdateUomData } from './uom.schemas';

const UOM_QUERY_KEY = ['uoms'];

export const useUoms = (orgId: string) => {
  return useQuery({
    queryKey: [...UOM_QUERY_KEY, orgId],
    queryFn: async (): Promise<Uom[]> => {
      const { data } = await apiClient.get(`/organizations/${orgId}/inventory/uom`);
      return data;
    },
    enabled: !!orgId,
  });
};

export const useCreateUom = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUomData): Promise<Uom> => {
      const { data: resData } = await apiClient.post(`/organizations/${orgId}/inventory/uom`, data);
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UOM_QUERY_KEY, orgId] });
    },
  });
};

export const useUpdateUom = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUomData }): Promise<Uom> => {
      const { data: resData } = await apiClient.put(`/organizations/${orgId}/inventory/uom/${id}`, data);
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UOM_QUERY_KEY, orgId] });
    },
  });
};

export const useDeleteUom = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/organizations/${orgId}/inventory/uom/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UOM_QUERY_KEY, orgId] });
    },
  });
};
