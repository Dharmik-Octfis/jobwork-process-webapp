import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

/**
 * Rejection reasons — a small per-org master.
 *
 * It exists as a master rather than a text box because free text cannot be
 * GROUPED, and "which defect is costing us the most" is the only reason to record
 * a defect reason at all. "shade off", "Shade Off" and "shd off" are three rows
 * in that report and one problem on the floor.
 */

export const rejectionReasonSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  defaultResponsibility: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

export interface CreateRejectionReasonData {
  name: string;
  code?: string | null;
  description?: string | null;
  defaultResponsibility?: string | null;
  isActive?: boolean;
  customFields?: Record<string, unknown>;
}

export const rejectionReasonsPageSchema = paginatedSchema(rejectionReasonSchema);
export type RejectionReasonsPage = Paginated<RejectionReason>;

export async function fetchRejectionReasons(
  orgId: string,
  params: PageParams = {},
): Promise<RejectionReasonsPage> {
  const response = await apiClient.get(endpoints.jobwork.rejectionReasons(orgId), { params });
  return rejectionReasonsPageSchema.parse(response.data);
}

export async function fetchRejectionReasonCount(
  orgId: string,
  params: PageParams = {},
): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.rejectionReasons(orgId)}/count`, {
    params,
  });
  return z.object({ total: z.number() }).parse(response.data).total;
}

export async function createRejectionReason(
  orgId: string,
  data: CreateRejectionReasonData,
): Promise<RejectionReason> {
  const response = await apiClient.post(endpoints.jobwork.rejectionReasons(orgId), data);
  return rejectionReasonSchema.parse(response.data);
}

export async function updateRejectionReason({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: CreateRejectionReasonData;
}): Promise<RejectionReason> {
  const response = await apiClient.put(`${endpoints.jobwork.rejectionReasons(orgId)}/${id}`, data);
  return rejectionReasonSchema.parse(response.data);
}

export async function deleteRejectionReason(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.rejectionReasons(orgId)}/${id}`);
}
