import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  processSchema,
  processesPageSchema,
  type CreateProcessData,
  type Process,
  type ProcessesPage,
  type UpdateProcessData,
} from './processes.schemas';

/**
 * `apiClient` unwraps the `{ statusCode, message, data }` envelope in one
 * interceptor, so `response.data` here is already the inner value. Everything is
 * parsed through the zod schema on the way out, which is what turns a backend
 * shape change into a loud error at the boundary instead of `undefined` three
 * components deep.
 */

export async function fetchProcesses(
  orgId: string,
  params: PageParams = {},
): Promise<ProcessesPage> {
  const response = await apiClient.get(endpoints.jobwork.processes(orgId), { params });
  return processesPageSchema.parse(response.data);
}

/** Total matching processes — only called when the user clicks "view". */
export async function fetchProcessCount(orgId: string, params: PageParams = {}): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.processes(orgId)}/count`, { params });
  return z.object({ total: z.number() }).parse(response.data).total;
}

export async function fetchProcessById(orgId: string, id: string): Promise<Process> {
  const response = await apiClient.get(`${endpoints.jobwork.processes(orgId)}/${id}`);
  return processSchema.parse(response.data);
}

export async function createProcess(orgId: string, data: CreateProcessData): Promise<Process> {
  const response = await apiClient.post(endpoints.jobwork.processes(orgId), data);
  return processSchema.parse(response.data);
}

export async function updateProcess({
  orgId,
  id,
  data,
}: {
  orgId: string;
  id: string;
  data: UpdateProcessData;
}): Promise<Process> {
  const response = await apiClient.put(`${endpoints.jobwork.processes(orgId)}/${id}`, data);
  return processSchema.parse(response.data);
}

export async function deleteProcess(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.processes(orgId)}/${id}`);
}
