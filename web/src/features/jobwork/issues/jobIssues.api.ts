import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { PageParams } from '../../../lib/pagination';
import {
  jobIssueSchema,
  jobIssuesPageSchema,
  type CreateJobIssueData,
  type JobIssue,
  type JobIssuesPage,
} from './jobIssues.schemas';

export async function fetchJobIssues(
  orgId: string,
  params: PageParams = {},
): Promise<JobIssuesPage> {
  const response = await apiClient.get(endpoints.jobwork.issues(orgId), { params });
  return jobIssuesPageSchema.parse(response.data);
}

export async function fetchJobIssueCount(orgId: string, params: PageParams = {}): Promise<number> {
  const response = await apiClient.get(`${endpoints.jobwork.issues(orgId)}/count`, { params });
  return z.object({ total: z.number() }).parse(response.data).total;
}

/** Every challan against one step — the Overview page's "2 issues" link.
 * Unpaginated: a step has a handful and they are read together. */
export async function fetchIssuesForStep(orgId: string, stepId: string): Promise<JobIssue[]> {
  const response = await apiClient.get(endpoints.jobwork.issues(orgId), { params: { stepId } });
  return z.array(jobIssueSchema).parse(response.data);
}

export async function fetchJobIssueById(orgId: string, id: string): Promise<JobIssue> {
  const response = await apiClient.get(`${endpoints.jobwork.issues(orgId)}/${id}`);
  return jobIssueSchema.parse(response.data);
}

export async function createJobIssue(orgId: string, data: CreateJobIssueData): Promise<JobIssue> {
  const response = await apiClient.post(endpoints.jobwork.issues(orgId), data);
  return jobIssueSchema.parse(response.data);
}

/**
 * Rewrite a parked draft — the whole form again, not a patch.
 *
 * 🔴 Only reaches a draft. The server refuses this once the challan is issued:
 * from that point it has ledger rows, and the only legal correction is a
 * cancellation that posts the opposite ones.
 */
export async function updateJobIssue(
  orgId: string,
  id: string,
  data: CreateJobIssueData,
): Promise<JobIssue> {
  const response = await apiClient.put(`${endpoints.jobwork.issues(orgId)}/${id}`, data);
  return jobIssueSchema.parse(response.data);
}

/** Issue a draft as it stands. Every check the draft was allowed to skip —
 * stock, tolerance, the step chain — runs now, so this can legitimately 400. */
export async function postJobIssue(orgId: string, id: string): Promise<JobIssue> {
  const response = await apiClient.post(`${endpoints.jobwork.issues(orgId)}/${id}/post`);
  return jobIssueSchema.parse(response.data);
}

/** Delete a DRAFT. A posted challan is cancelled instead — see above. */
export async function deleteJobIssue(orgId: string, id: string): Promise<void> {
  await apiClient.delete(`${endpoints.jobwork.issues(orgId)}/${id}`);
}

/** Cancelling posts reversing ledger rows. It never deletes — the history of
 * "this went out on the 3rd and was cancelled on the 5th" has to survive. */
export async function cancelJobIssue(orgId: string, id: string, reason: string): Promise<void> {
  await apiClient.post(`${endpoints.jobwork.issues(orgId)}/${id}/cancel`, { reason });
}
