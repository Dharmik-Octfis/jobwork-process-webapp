import { apiClient } from '../../api/client';
import type { ApprovalRequestDetails } from '../automation/approval-processes/types/approvalProcess.types';

export interface ApprovalRequestListItem {
  id: string;
  moduleId: string;
  moduleName: string;
  recordId: string;
  recordTitle: string;
  processId: string;
  processName: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'FINAL_APPROVED' | 'REJECTED' | 'CANCELLED';
  currentStageId: string | null;
  currentStageName?: string;
  currentStageOrder?: number;
  currentStageApprovers?: Array<{
    id: string;
    userId: string;
    fullName?: string;
    email: string;
    status: string;
  }>;
  requesterId: string | null;
  requesterName?: string;
  submittedAt: string;
  completedAt: string | null;
  isApproverForCurrentUser?: boolean;
}

export interface ListApprovalRequestsParams {
  tab?: 'all' | 'pending' | 'my' | 'approved' | 'rejected';
  status?: string;
  moduleId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ListApprovalRequestsResponse {
  items: ApprovalRequestListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RecordApprovalHistoryResponse {
  activeRequest: ApprovalRequestDetails | null;
  allRequests: ApprovalRequestDetails[];
}

export const approvalsApi = {
  async listRequests(
    orgId: string,
    params: ListApprovalRequestsParams = {},
  ): Promise<ListApprovalRequestsResponse> {
    const res = await apiClient.get<ListApprovalRequestsResponse>(
      `/organizations/${orgId}/approvals`,
      { params },
    );
    return res.data;
  },

  async getRequestById(orgId: string, id: string): Promise<ApprovalRequestDetails> {
    const res = await apiClient.get<ApprovalRequestDetails>(
      `/organizations/${orgId}/approvals/${id}`,
    );
    return res.data;
  },

  async getRecordApprovalHistory(
    orgId: string,
    moduleId: string,
    recordId: string,
  ): Promise<RecordApprovalHistoryResponse> {
    const res = await apiClient.get<RecordApprovalHistoryResponse>(
      `/organizations/${orgId}/approvals/records/${moduleId}/${recordId}`,
    );
    return res.data;
  },

  async approveRequest(
    orgId: string,
    id: string,
    payload: { comment?: string } = {},
  ): Promise<{ success: boolean; requestStatus: string }> {
    const res = await apiClient.post<{ success: boolean; requestStatus: string }>(
      `/organizations/${orgId}/approvals/${id}/approve`,
      payload,
    );
    return res.data;
  },

  async rejectRequest(
    orgId: string,
    id: string,
    payload: { reason: string },
  ): Promise<{ success: boolean; requestStatus: string }> {
    const res = await apiClient.post<{ success: boolean; requestStatus: string }>(
      `/organizations/${orgId}/approvals/${id}/reject`,
      payload,
    );
    return res.data;
  },

  async cancelRequest(
    orgId: string,
    id: string,
    payload: { reason?: string } = {},
  ): Promise<{ success: boolean; requestStatus: string }> {
    const res = await apiClient.post<{ success: boolean; requestStatus: string }>(
      `/organizations/${orgId}/approvals/${id}/cancel`,
      payload,
    );
    return res.data;
  },
};

