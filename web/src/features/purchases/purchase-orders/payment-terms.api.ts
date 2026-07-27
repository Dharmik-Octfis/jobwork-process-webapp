import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';

/**
 * Represents a payment term in the system.
 */
export interface PaymentTerm {
  id: string;
  termName: string;
  dueAfterDays: number;
}

/**
 * Payload used to create a new payment term.
 */
export interface CreatePaymentTermPayload {
  termName: string;
  dueAfterDays: number;
}

// Fetch all payment terms
export const fetchPaymentTerms = async (orgId: string): Promise<PaymentTerm[]> => {
  const response = await apiClient.get(endpoints.configuration.paymentTerms(orgId));
  return response.data;
};

// Create a new payment term
export const createPaymentTerm = async (orgId: string, payload: CreatePaymentTermPayload): Promise<PaymentTerm> => {
  const response = await apiClient.post(endpoints.configuration.paymentTerms(orgId), payload);
  return response.data;
};
