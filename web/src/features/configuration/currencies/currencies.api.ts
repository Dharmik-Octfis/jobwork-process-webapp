import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import type { Currency, CreateCurrencyData, UpdateCurrencyData } from './currencies.schemas';

const CURRENCY_QUERY_KEY = ['currencies'];

export const useCurrencies = (orgId: string) => {
  return useQuery({
    queryKey: [...CURRENCY_QUERY_KEY, orgId],
    queryFn: async (): Promise<Currency[]> => {
      const { data } = await apiClient.get(`/organizations/${orgId}/configuration/currencies`);
      return data;
    },
    enabled: !!orgId,
  });
};

export const useCreateCurrency = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCurrencyData): Promise<Currency> => {
      const { data: resData } = await apiClient.post(`/organizations/${orgId}/configuration/currencies`, data);
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CURRENCY_QUERY_KEY, orgId] });
    },
  });
};

export const useUpdateCurrency = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCurrencyData }): Promise<Currency> => {
      const { data: resData } = await apiClient.put(`/organizations/${orgId}/configuration/currencies/${id}`, data);
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CURRENCY_QUERY_KEY, orgId] });
    },
  });
};

export const useDeleteCurrency = (orgId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/organizations/${orgId}/configuration/currencies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CURRENCY_QUERY_KEY, orgId] });
    },
  });
};
