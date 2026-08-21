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
 * `search` only widens the second group — this job order's own batches are
 * always returned in full, so an empty search is a complete answer rather than
 * an empty one.
 */
export async function fetchReceiptBatchOptions(
  orgId: string,
  params: { stepId: string; itemId: string; search?: string },
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
