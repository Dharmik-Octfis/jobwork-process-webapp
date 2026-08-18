import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  type Bill,
  type CreateBillData,
  type UpdateBillData,
  type BillsPage,
  type BillActivity,
  billActivitySchema,
  billsPageSchema,
} from './bills.schemas';

export async function fetchBills(
  orgId: string,
  params: PageParams = {},
): Promise<BillsPage> {
  const response = await apiClient.get(endpoints.purchases.bills(orgId), { params });
  return billsPageSchema.parse(response.data);
}

export async function fetchBillCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.purchases.bills(orgId)}/count`, { params });
  return (response.data as { total: number }).total;
}

export async function createBill(orgId: string, data: CreateBillData): Promise<Bill> {
  const response = await apiClient.post(endpoints.purchases.bills(orgId), data);
  return response.data;
}

export async function fetchBillById(orgId: string, id: string): Promise<Bill> {
  const response = await apiClient.get(`${endpoints.purchases.bills(orgId)}/${id}`);
  return response.data;
}

export async function updateBill({ orgId, id, data }: { orgId: string; id: string; data: UpdateBillData }): Promise<Bill> {
  const response = await apiClient.patch(`${endpoints.purchases.bills(orgId)}/${id}`, data);
  return response.data;
}

export async function deleteBill(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.bills(orgId)}/${id}`);
}

export async function fetchBillActivities(orgId: string, id: string): Promise<BillActivity[]> {
  const response = await apiClient.get(`${endpoints.purchases.bills(orgId)}/${id}/activities`);
  return z.array(billActivitySchema).parse(response.data);
}

export interface BillComment {
  id: string;
  billId: string;
  content: string;
  performedBy?: string | null;
  createdAt: string;
}

export async function fetchBillComments(orgId: string, id: string): Promise<BillComment[]> {
  const response = await apiClient.get(`${endpoints.purchases.bills(orgId)}/${id}/comments`);
  return response.data;
}

export async function addBillComment(
  orgId: string,
  id: string,
  content: string,
): Promise<BillComment> {
  const response = await apiClient.post(`${endpoints.purchases.bills(orgId)}/${id}/comments`, {
    content,
  });
  return response.data;
}

export async function deleteBillComment(
  orgId: string,
  billId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete(`${endpoints.purchases.bills(orgId)}/${billId}/comments/${commentId}`);
}

export interface BillAttachment {
  key?: string;
  name?: string;
  size?: number;
  type?: string;
  data?: string;
  url?: string;
}

export async function uploadBillAttachments(orgId: string, formData: FormData): Promise<BillAttachment[]> {
  const response = await apiClient.post(
    `${endpoints.purchases.bills(orgId)}/attachments/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return response.data;
}

export async function getBillSignedUrl(orgId: string, key: string): Promise<string> {
  const response = await apiClient.get(
    `${endpoints.purchases.bills(orgId)}/attachments/signed-url`,
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

export async function fetchBillNumberPreference(orgId: string): Promise<NumberSequencePreference> {
  const response = await apiClient.get(endpoints.purchases.billPreferences(orgId));
  return response.data;
}

export async function updateBillNumberPreference(
  orgId: string,
  data: { prefix: string; nextNumber: number },
): Promise<NumberSequencePreference> {
  const response = await apiClient.put(endpoints.purchases.billPreferences(orgId), data);
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
