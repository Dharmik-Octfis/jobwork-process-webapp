import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  type Invoice,
  type CreateInvoiceData,
  type UpdateInvoiceData,
  type InvoicesPage,
  type InvoiceActivity,
  InvoiceActivitySchema,
  invoicesPageSchema,
} from './invoices.schemas';

export async function fetchInvoices(
  orgId: string,
  params: PageParams = {},
): Promise<InvoicesPage> {
  const response = await apiClient.get(endpoints.sales.invoices(orgId), { params });
  return invoicesPageSchema.parse(response.data);
}

export async function fetchInvoiceCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.sales.invoices(orgId)}/count`, { params });
  return (response.data as { total: number }).total;
}

export async function createInvoice(orgId: string, data: CreateInvoiceData): Promise<Invoice> {
  const response = await apiClient.post(endpoints.sales.invoices(orgId), data);
  return response.data;
}

export async function fetchInvoiceById(orgId: string, id: string): Promise<Invoice> {
  const response = await apiClient.get(`${endpoints.sales.invoices(orgId)}/${id}`);
  return response.data;
}

export async function updateInvoice({ orgId, id, data }: { orgId: string; id: string; data: UpdateInvoiceData }): Promise<Invoice> {
  const response = await apiClient.patch(`${endpoints.sales.invoices(orgId)}/${id}`, data);
  return response.data;
}

export async function deleteInvoice(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.sales.invoices(orgId)}/${id}`);
}

export async function fetchInvoiceActivities(orgId: string, id: string): Promise<InvoiceActivity[]> {
  const response = await apiClient.get(`${endpoints.sales.invoices(orgId)}/${id}/activities`);
  return z.array(InvoiceActivitySchema).parse(response.data);
}

export interface InvoiceComment {
  id: string;
  invoiceId: string;
  content: string;
  performedBy?: string | null;
  createdAt: string;
}

export async function fetchInvoiceComments(orgId: string, id: string): Promise<InvoiceComment[]> {
  const response = await apiClient.get(`${endpoints.sales.invoices(orgId)}/${id}/comments`);
  return response.data;
}

export async function addInvoiceComment(
  orgId: string,
  id: string,
  content: string,
): Promise<InvoiceComment> {
  const response = await apiClient.post(`${endpoints.sales.invoices(orgId)}/${id}/comments`, {
    content,
  });
  return response.data;
}

export async function deleteInvoiceComment(
  orgId: string,
  invoiceId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(`${endpoints.sales.invoices(orgId)}/${invoiceId}/comments/${commentId}`);
}

export interface InvoiceAttachment {
  key?: string;
  name?: string;
  size?: number;
  type?: string;
  data?: string;
  url?: string;
}

export async function uploadInvoiceAttachments(orgId: string, formData: FormData): Promise<InvoiceAttachment[]> {
  const response = await apiClient.post(
    `${endpoints.sales.invoices(orgId)}/attachments/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return response.data;
}

export async function getInvoiceSignedUrl(orgId: string, key: string): Promise<string> {
  const response = await apiClient.get(
    `${endpoints.sales.invoices(orgId)}/attachments/signed-url`,
    { params: { key } },
  );
  return (response.data as { url: string }).url;
}

export interface NumberSequencePreference {
  id: string;
  organizationId: string;
  entityType: string;
  prefix: string;
  nextNumber: number;
}

export async function fetchInvoiceNumberPreference(orgId: string): Promise<NumberSequencePreference> {
  const response = await apiClient.get(endpoints.sales.invoicePreferences(orgId));
  return response.data;
}

export async function updateInvoiceNumberPreference(
  orgId: string,
  data: { prefix: string; nextNumber: number },
): Promise<NumberSequencePreference> {
  const response = await apiClient.put(endpoints.sales.invoicePreferences(orgId), data);
  return response.data;
}
