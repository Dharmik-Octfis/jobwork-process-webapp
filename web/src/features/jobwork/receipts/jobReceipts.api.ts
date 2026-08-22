import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  jobReceiptSchema,
  jobReceiptsPageSchema,
  receiptBatchOptionsSchema,
  receivePrefillSchema,
  type CreateJobReceiptData,
  type JobReceipt,
  type JobReceiptsPage,
  type ReceiptBatchOptions,
  type ReceivePrefill,
} from './jobReceipts.schemas';

export async function fetchJobReceipts(
  orgId: string,
  params: PageParams = {},
): Promise<JobReceiptsPage> {
  const response = await apiClient.get(endpoints.jobwork.receipts(orgId), { params });
  return jobReceiptsPageSchema.parse(response.data);
}

export async function fetchJobReceiptCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.receipts(orgId)}/count`, { params });
  return z.object({ total: z.number() }).parse(response.data).total;
}

export async function fetchReceiptsForStep(orgId: string, stepId: string): Promise<JobReceipt[]> {
  const response = await apiClient.get(endpoints.jobwork.receipts(orgId), { params: { stepId } });
  return z.array(jobReceiptSchema).parse(response.data);
}

export async function fetchJobReceiptById(orgId: string, id: string): Promise<JobReceipt> {
  const response = await apiClient.get(`${endpoints.jobwork.receipts(orgId)}/${id}`);
  return jobReceiptSchema.parse(response.data);
}

/** Everything the Receive dialog needs before anyone types: the mode (decided by
 * the process, not the user), the open challans, and one row per taka still out. */
export async function fetchReceivePrefill(orgId: string, stepId: string): Promise<ReceivePrefill> {
  const response = await apiClient.get(endpoints.jobwork.receiptPrefill(orgId), {
    params: { stepId },
  });
  return receivePrefillSchema.parse(response.data);
}

/**
 * The batches this receipt may add to, and where each one currently sits.
 *
 * `search` narrows both groups. `cursor` pages the second one — omit it for page
 * one, then feed back the previous page's `otherNextCursor`.
 */
export async function fetchReceiptBatchOptions(
  orgId: string,
  params: { stepId: string; itemId: string; search?: string; cursor?: string },
): Promise<ReceiptBatchOptions> {
  const response = await apiClient.get(endpoints.jobwork.receiptBatchOptions(orgId), { params });
  return receiptBatchOptionsSchema.parse(response.data);
}

export async function createJobReceipt(
  orgId: string,
  data: CreateJobReceiptData,
): Promise<JobReceipt> {
  const response = await apiClient.post(endpoints.jobwork.receipts(orgId), data);
  return jobReceiptSchema.parse(response.data);
}

export async function cancelJobReceipt(orgId: string, id: string, reason: string): Promise<void> {
  await apiClient.post(`${endpoints.jobwork.receipts(orgId)}/${id}/cancel`, { reason });
}
