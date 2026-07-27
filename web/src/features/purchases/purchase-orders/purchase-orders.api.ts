import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  type PurchaseOrder,
  type CreatePurchaseOrderData,
  type UpdatePurchaseOrderData,
  type PurchaseOrdersPage,
  type PurchaseOrderActivity,
  PurchaseOrderActivitySchema,
  purchaseOrdersPageSchema,
} from './purchase-orders.schemas';

export async function fetchPurchaseOrders(
  orgId: string,
  params: PageParams = {},
): Promise<PurchaseOrdersPage> {
  const response = await apiClient.get(endpoints.purchases.purchaseOrders(orgId), { params });
  return purchaseOrdersPageSchema.parse(response.data);
}

export async function fetchPurchaseOrderCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.purchases.purchaseOrders(orgId)}/count`, { params });
  return (response.data as { total: number }).total;
}

export async function createPurchaseOrder(orgId: string, data: CreatePurchaseOrderData): Promise<PurchaseOrder> {
  const response = await apiClient.post(endpoints.purchases.purchaseOrders(orgId), data);
  return response.data;
}

export async function fetchPurchaseOrderById(orgId: string, id: string): Promise<PurchaseOrder> {
  const response = await apiClient.get(`${endpoints.purchases.purchaseOrders(orgId)}/${id}`);
  return response.data;
}

export async function updatePurchaseOrder({ orgId, id, data }: { orgId: string; id: string; data: UpdatePurchaseOrderData }): Promise<PurchaseOrder> {
  const response = await apiClient.patch(`${endpoints.purchases.purchaseOrders(orgId)}/${id}`, data);
  return response.data;
}

export async function deletePurchaseOrder(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.purchaseOrders(orgId)}/${id}`);
}

export async function fetchPurchaseOrderActivities(orgId: string, id: string): Promise<PurchaseOrderActivity[]> {
  const response = await apiClient.get(`${endpoints.purchases.purchaseOrders(orgId)}/${id}/activities`);
  return z.array(PurchaseOrderActivitySchema).parse(response.data);
}

export interface POComment {
  id: string;
  purchaseOrderId: string;
  content: string;
  performedBy?: string | null;
  createdAt: string;
}

export async function fetchPurchaseOrderComments(orgId: string, id: string): Promise<POComment[]> {
  const response = await apiClient.get(`${endpoints.purchases.purchaseOrders(orgId)}/${id}/comments`);
  return response.data;
}

export async function addPurchaseOrderComment(
  orgId: string,
  id: string,
  content: string,
): Promise<POComment> {
  const response = await apiClient.post(`${endpoints.purchases.purchaseOrders(orgId)}/${id}/comments`, {
    content,
  });
  return response.data;
}

export async function deletePurchaseOrderComment(
  orgId: string,
  poId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.purchaseOrders(orgId)}/${poId}/comments/${commentId}`);
}

export interface POAttachment {
  key?: string;
  name?: string;
  size?: number;
  type?: string;
  data?: string;
  url?: string;
}

export async function uploadPOAttachments(orgId: string, formData: FormData): Promise<POAttachment[]> {
  const response = await apiClient.post(
    `${endpoints.purchases.purchaseOrders(orgId)}/attachments/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return response.data;
}

export async function getPOSignedUrl(orgId: string, key: string): Promise<string> {
  const response = await apiClient.get(
    `${endpoints.purchases.purchaseOrders(orgId)}/attachments/signed-url`,
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

export async function fetchPONumberPreference(orgId: string): Promise<NumberSequencePreference> {
  const response = await apiClient.get(endpoints.purchases.purchaseOrderPreferences(orgId));
  return response.data;
}

export async function updatePONumberPreference(
  orgId: string,
  data: { prefix: string; nextNumber: number },
): Promise<NumberSequencePreference> {
  const response = await apiClient.put(endpoints.purchases.purchaseOrderPreferences(orgId), data);
  return response.data;
}

// Configuration endpoints hooks since we didn't create dedicated api files for them
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
