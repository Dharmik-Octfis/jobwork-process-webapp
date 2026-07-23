import { apiClient } from '../../../api/client';
import type { CreatePaymentTermData } from './payment-terms.schemas';
import { useQuery } from '@tanstack/react-query';

export interface PaymentTerm {
  id: string;
  organizationId: string;
  termName: string;
  dueAfterDays: number;
}

export async function fetchPaymentTerms(orgId: string): Promise<PaymentTerm[]> {
  const { data } = await apiClient.get(`/organizations/${orgId}/configuration/payment-terms`);
  return data;
}

export async function createPaymentTerm(orgId: string, payload: CreatePaymentTermData): Promise<PaymentTerm> {
  const { data } = await apiClient.post(`/organizations/${orgId}/configuration/payment-terms`, payload);
  return data;
}

export function usePaymentTerms(orgId: string) {
  return useQuery({
    queryKey: ['payment-terms', orgId],
    queryFn: () => fetchPaymentTerms(orgId),
    enabled: !!orgId,
  });
}
