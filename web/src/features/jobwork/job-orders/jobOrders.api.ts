import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  jobOrderOverviewSchema,
  jobOrderSchema,
  jobOrdersPageSchema,
  type CreateJobOrderData,
  jobOrderWithStepsSchema,
  type JobOrder,
  type JobOrderWithSteps,
  type JobOrderOverviewData,
  type JobOrdersPage,
  type JobOrderStepData,
  type UpdateJobOrderData,
} from './jobOrders.schemas';

export async function fetchJobOrders(
  orgId: string,
  params: PageParams = {},
): Promise<JobOrdersPage> {
  const response = await apiClient.get(endpoints.jobwork.jobOrders(orgId), { params });
  return jobOrdersPageSchema.parse(response.data);
}

export async function fetchJobOrderCount(orgId: string, params: PageParams = {}): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.jobOrders(orgId)}/count`, { params });
  return z.object({ total: z.number() }).parse(response.data).total;
}

export async function fetchJobOrderById(orgId: string, id: string, light = false): Promise<JobOrder> {
  const response = await apiClient.get(`${endpoints.jobwork.jobOrders(orgId)}/${id}`, {
    params: light ? { light: 'true' } : undefined,
  });
  return jobOrderSchema.parse(response.data);
}

export async function fetchJobOrderWithStepsById(orgId: string, id: string): Promise<JobOrderWithSteps> {
  const response = await apiClient.get(`${endpoints.jobwork.jobOrders(orgId)}/${id}/with-steps`);
  return jobOrderWithStepsSchema.parse(response.data);
}

/** The stepper page. ONE request: the tiles, the per-step totals and the live
 * balance all have to describe the same moment. */
export async function fetchJobOrderOverview(
  orgId: string,
  id: string,
  stepId?: string,
): Promise<JobOrderOverviewData> {
  const params = stepId ? { stepId } : undefined;
  const response = await apiClient.get(endpoints.jobwork.jobOrderOverview(orgId, id), { params });
  return jobOrderOverviewSchema.parse(response.data);
}

export async function createJobOrder(orgId: string, data: CreateJobOrderData): Promise<JobOrder> {
  const response = await apiClient.post(endpoints.jobwork.jobOrders(orgId), data);
  return jobOrderSchema.parse(response.data);
}

export async function updateJobOrder({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateJobOrderData;
}): Promise<JobOrder> {
  const response = await apiClient.put(`${endpoints.jobwork.jobOrders(orgId)}/${id}`, data);
  return jobOrderSchema.parse(response.data);
}

/**
 * Add work to the END of an order that has already started.
 *
 * A separate call from `updateJobOrder` because it is a different operation, not
 * a relaxed one: the update endpoint rewrites the whole grid and refuses anything
 * but a draft, while this only ever inserts after the last step.
 */
export async function appendJobOrderSteps({
  orgId,
  id,
  steps,
  reason,
}: {
  orgId: string;
  id: string;
  steps: JobOrderStepData[];
  reason?: string;
}): Promise<JobOrder> {
  const response = await apiClient.post(`${endpoints.jobwork.jobOrders(orgId)}/${id}/steps`, {
    steps,
    reason,
  });
  return jobOrderSchema.parse(response.data);
}

/** Finished, and the numbers do not balance. The reason is required — it is a
 * decision someone owns, not a status change. */
export async function shortCloseJobOrder(orgId: string, id: string, reason: string): Promise<void> {
  await apiClient.post(`${endpoints.jobwork.jobOrders(orgId)}/${id}/short-close`, { reason });
}

export async function deleteJobOrder(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.jobOrders(orgId)}/${id}`);
}

export async function completeJobOrderStep(
  orgId: string,
  id: string,
  stepId: string,
): Promise<JobOrderOverviewData> {
  const response = await apiClient.post(
    `${endpoints.jobwork.jobOrders(orgId)}/${id}/steps/${stepId}/complete`,
  );
  return jobOrderOverviewSchema.parse(response.data);
}

/** The numbering series behind the gear beside Job Order Number. */
const numberPreferenceSchema = z.object({ prefix: z.string(), nextNumber: z.number() });

export type NumberPreference = z.infer<typeof numberPreferenceSchema>;

export async function fetchJobOrderNumberPreference(orgId: string): Promise<NumberPreference> {
  const response = await apiClient.get(endpoints.jobwork.jobOrderPreferences(orgId));
  return numberPreferenceSchema.parse(response.data);
}

export async function updateJobOrderNumberPreference(
  orgId: string,
  data: NumberPreference,
): Promise<NumberPreference> {
  const response = await apiClient.put(endpoints.jobwork.jobOrderPreferences(orgId), data);
  return numberPreferenceSchema.parse(response.data);
}

/** JO-00007 from `{ prefix: 'JO-', nextNumber: 7 }`. Five digits, the width the
 * server pads to (`numberSequence.ts`) — a mismatch here would show one number
 * and save another. */
export function formatJobOrderNumber(pref: NumberPreference): string {
  return `${pref.prefix}${String(pref.nextNumber).padStart(5, '0')}`;
}
