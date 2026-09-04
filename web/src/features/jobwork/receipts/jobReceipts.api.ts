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
  params: {
    stepId: string;
    itemId: string;
    search?: string;
    cursor?: string;
    /** Ask for each batch's existing packages, so a row can add to one. Costs an
     * extra grouped query, so only a caller that can render them sets it. */
    withUnits?: boolean;
  },
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

/**
 * Rewrite a parked draft. Only reaches a draft — once posted, a receipt has
 * created batches and moved stock, and its only correction is a cancellation.
 */
export async function updateJobReceipt(
  orgId: string,
  id: string,
  data: CreateJobReceiptData,
): Promise<JobReceipt> {
  const response = await apiClient.put(`${endpoints.jobwork.receipts(orgId)}/${id}`, data);
  return jobReceiptSchema.parse(response.data);
}

/**
 * Post a draft as it stands.
 *
 * 🔴 Refused with a 400 when the draft never named the batch its goods came into
 * — which is the usual case, since a draft cannot store a batch it is creating.
 * The message says to reopen the draft; surface it rather than swallowing it.
 */
export async function postJobReceipt(orgId: string, id: string): Promise<JobReceipt> {
  const response = await apiClient.post(`${endpoints.jobwork.receipts(orgId)}/${id}/post`);
  return jobReceiptSchema.parse(response.data);
}

/** Delete a DRAFT. A posted receipt is cancelled instead. */
export async function deleteJobReceipt(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.receipts(orgId)}/${id}`);
}

export async function cancelJobReceipt(orgId: string, id: string, reason: string): Promise<void> {
  await apiClient.post(`${endpoints.jobwork.receipts(orgId)}/${id}/cancel`, { reason });
}
