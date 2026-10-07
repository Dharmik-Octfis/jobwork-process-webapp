import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  type SalesOrder,
  type CreateSalesOrderData,
  type UpdateSalesOrderData,
  type SalesOrdersPage,
  type SalesOrderActivity,
  SalesOrderActivitySchema,
  salesOrdersPageSchema,
} from './sales-orders.schemas';

export async function fetchSalesOrders(
  orgId: string,
  params: PageParams = {},
): Promise<SalesOrdersPage> {
  const response = await apiClient.get(endpoints.sales.salesOrders(orgId), { params });
  const parsed = salesOrdersPageSchema.safeParse(response.data);
  if (parsed.success) {
    return parsed.data;
  }
  console.warn('Sales orders schema parse failed, falling back to raw data:', parsed.error);
  return response.data as SalesOrdersPage;
}

export async function fetchSalesOrderCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.sales.salesOrders(orgId)}/count`, { params });
  return (response.data as { total: number }).total;
}

export async function createSalesOrder(orgId: string, data: CreateSalesOrderData): Promise<SalesOrder> {
  const response = await apiClient.post(endpoints.sales.salesOrders(orgId), data);
  return response.data;
}

export async function fetchSalesOrderById(orgId: string, id: string): Promise<SalesOrder> {
  const response = await apiClient.get(`${endpoints.sales.salesOrders(orgId)}/${id}`);
  return response.data;
}

export async function updateSalesOrder({ orgId, id, data }: { orgId: string; id: string; data: UpdateSalesOrderData }): Promise<SalesOrder> {
  const response = await apiClient.patch(`${endpoints.sales.salesOrders(orgId)}/${id}`, data);
  return response.data;
}

export async function deleteSalesOrder(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.sales.salesOrders(orgId)}/${id}`);
}

export async function fetchSalesOrderActivities(orgId: string, id: string): Promise<SalesOrderActivity[]> {
  const response = await apiClient.get(`${endpoints.sales.salesOrders(orgId)}/${id}/activities`);
  return z.array(SalesOrderActivitySchema).parse(response.data);
}

export interface SOComment {
  id: string;
  salesOrderId: string;
  content: string;
  performedBy?: string | null;
  createdAt: string;
}

export async function fetchSalesOrderComments(orgId: string, id: string): Promise<SOComment[]> {
  const response = await apiClient.get(`${endpoints.sales.salesOrders(orgId)}/${id}/comments`);
  return response.data;
}

export async function addSalesOrderComment(
  orgId: string,
  id: string,
  content: string,
): Promise<SOComment> {
  const response = await apiClient.post(`${endpoints.sales.salesOrders(orgId)}/${id}/comments`, {
    content,
  });
  return response.data;
}

export async function deleteSalesOrderComment(
  orgId: string,
  soId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(`${endpoints.sales.salesOrders(orgId)}/${soId}/comments/${commentId}`);
}

export interface SOAttachment {
  key?: string;
  name?: string;
  size?: number;
  type?: string;
  data?: string;
  url?: string;
}

export async function uploadSOAttachments(orgId: string, formData: FormData): Promise<SOAttachment[]> {
  const response = await apiClient.post(
    `${endpoints.sales.salesOrders(orgId)}/attachments/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return response.data;
}

export async function getSOSignedUrl(orgId: string, key: string): Promise<string> {
  const response = await apiClient.get(
    `${endpoints.sales.salesOrders(orgId)}/attachments/signed-url`,
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

export async function fetchSONumberPreference(orgId: string): Promise<NumberSequencePreference> {
  const response = await apiClient.get(endpoints.sales.salesOrderPreferences(orgId));
  return response.data;
}

export async function updateSONumberPreference(
  orgId: string,
  data: { prefix: string; nextNumber: number },
): Promise<NumberSequencePreference> {
  const response = await apiClient.put(endpoints.sales.salesOrderPreferences(orgId), data);
  return response.data;
}

export async function fetchLocations(orgId: string) {
  const response = await apiClient.get(endpoints.configuration.locations(orgId));
  return response.data;
}
export async function fetchTaxes(orgId: string) {
  const response = await apiClient.get(endpoints.configuration.taxes(orgId));
  return response.data;
}
export async function fetchAccounts(orgId: string) {
  const response = await apiClient.get(endpoints.configuration.accounts(orgId));
  return response.data;
}
