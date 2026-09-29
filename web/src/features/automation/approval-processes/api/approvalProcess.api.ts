import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../api/client';
import { endpoints } from '../../../../api/endpoints';
import { membersApi, isMember } from '../../../members/members.api';
import { rolesApi } from '../../../roles/roles.api';
import type {
  ApprovalProcessListItem,
  ApprovalProcessDetail,
  CreateApprovalProcessPayload,
  UpdateApprovalProcessPayload,
  ModuleMetadata,
  FieldMetadata,
  ApprovalRequestDetail,
} from '../types/approvalProcess.types';

export const approvalProcessKeys = {
  all: (orgId: string) => ['approval-processes', orgId] as const,
  list: (orgId: string, filters?: Record<string, unknown>) =>
    ['approval-processes', orgId, 'list', filters ?? {}] as const,
  detail: (orgId: string, id: string) => ['approval-processes', orgId, 'detail', id] as const,
  modules: (orgId: string) => ['approval-processes', orgId, 'modules'] as const,
  moduleFields: (orgId: string, moduleId: string) =>
    ['approval-processes', orgId, 'module-fields', moduleId] as const,
  requests: (orgId: string, filters?: Record<string, unknown>) =>
    ['approval-processes', orgId, 'requests', filters ?? {}] as const,
  requestDetail: (orgId: string, id: string) =>
    ['approval-processes', orgId, 'request-detail', id] as const,
};

// ── Hook: List Approval Processes ──────────────────────────────────────────
export function useApprovalProcesses(
  orgId: string | undefined,
  filters?: { moduleId?: string; status?: string; search?: string },
) {
  return useQuery({
    queryKey: approvalProcessKeys.list(orgId ?? '', filters),
    queryFn: async (): Promise<ApprovalProcessListItem[]> => {
      const params = new URLSearchParams();
      if (filters?.moduleId) params.set('moduleId', filters.moduleId);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.search) params.set('search', filters.search);

      const qs = params.toString();
      const url = `${endpoints.automation.approvalProcesses(orgId!)}${qs ? `?${qs}` : ''}`;
      const { data } = await apiClient.get<any>(url);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.items)) return data.items;
      return [];
    },
    enabled: !!orgId,
    staleTime: 30 * 1000,
  });
}

// ── Hook: Single Approval Process ─────────────────────────────────────────
export function useApprovalProcess(orgId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: approvalProcessKeys.detail(orgId ?? '', id ?? ''),
    queryFn: async (): Promise<ApprovalProcessDetail> => {
      const { data } = await apiClient.get(endpoints.automation.approvalProcessById(orgId!, id!));
      return data as ApprovalProcessDetail;
    },
    enabled: !!orgId && !!id,
  });
}

// ── Hook: Modules Discovery ────────────────────────────────────────────────
export function useApprovalModules(orgId: string | undefined) {
  return useQuery({
    queryKey: approvalProcessKeys.modules(orgId ?? ''),
    queryFn: async (): Promise<ModuleMetadata[]> => {
      const { data } = await apiClient.get(endpoints.automation.modules(orgId!));
      return (data as ModuleMetadata[]) ?? [];
    },
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000,
  });
}

// ── Hook: Module Fields Discovery ──────────────────────────────────────────
export function useModuleFields(orgId: string | undefined, moduleId: string | undefined) {
  return useQuery({
    queryKey: approvalProcessKeys.moduleFields(orgId ?? '', moduleId ?? ''),
    queryFn: async (): Promise<FieldMetadata[]> => {
      const { data } = await apiClient.get(endpoints.automation.moduleFields(orgId!, moduleId!));
      return (data as FieldMetadata[]) ?? [];
    },
    enabled: !!orgId && !!moduleId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Hook: Create Process Mutation ──────────────────────────────────────────
export function useCreateApprovalProcess(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateApprovalProcessPayload) => {
      const { data } = await apiClient.post(endpoints.automation.approvalProcesses(orgId!), payload);
      return data as ApprovalProcessDetail;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
    },
  });
}

// ── Hook: Update Process Mutation ──────────────────────────────────────────
export function useUpdateApprovalProcess(orgId: string | undefined, id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateApprovalProcessPayload) => {
      const { data } = await apiClient.put(
        endpoints.automation.approvalProcessById(orgId!, id!),
        payload,
      );
      return data as ApprovalProcessDetail;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
      if (id) {
        queryClient.invalidateQueries({ queryKey: approvalProcessKeys.detail(orgId ?? '', id) });
      }
    },
  });
}

// ── Hook: Delete Process Mutation ──────────────────────────────────────────
export function useDeleteApprovalProcess(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(endpoints.automation.approvalProcessById(orgId!, id));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
    },
  });
}

// ── Hook: Activate Process Mutation ────────────────────────────────────────
export function useActivateApprovalProcess(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(
        endpoints.automation.activateApprovalProcess(orgId!, id),
      );
      return data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.detail(orgId ?? '', id) });
    },
  });
}

// ── Hook: Deactivate Process Mutation ──────────────────────────────────────
export function useDeactivateApprovalProcess(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(
        endpoints.automation.deactivateApprovalProcess(orgId!, id),
      );
      return data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.detail(orgId ?? '', id) });
    },
  });
}

// ── Hook: Duplicate Process Mutation ───────────────────────────────────────
export function useDuplicateApprovalProcess(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(
        endpoints.automation.duplicateApprovalProcess(orgId!, id),
      );
      return data as ApprovalProcessDetail;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
    },
  });
}

// ── Hook: Reorder Processes Mutation ───────────────────────────────────────
export function useReorderApprovalProcesses(orgId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (processIds: string[]) => {
      const { data } = await apiClient.post(
        endpoints.automation.reorderApprovalProcesses(orgId!),
        { processIds },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.all(orgId ?? '') });
    },
  });
}

// ── Hook: List Approval Requests ───────────────────────────────────────────
export function useApprovalRequests(
  orgId: string | undefined,
  filters?: { processId?: string; status?: string; entityType?: string; entityId?: string },
) {
  return useQuery({
    queryKey: approvalProcessKeys.requests(orgId ?? '', filters),
    queryFn: async (): Promise<ApprovalRequestDetail[]> => {
      const params = new URLSearchParams();
      if (filters?.processId) params.set('processId', filters.processId);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.entityType) params.set('entityType', filters.entityType);
      if (filters?.entityId) params.set('entityId', filters.entityId);

      const qs = params.toString();
      const url = `${endpoints.automation.requests(orgId!)}${qs ? `?${qs}` : ''}`;
      const { data } = await apiClient.get<any>(url);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.items)) return data.items;
      return [];
    },
    enabled: !!orgId,
  });
}

// ── Hook: Single Approval Request ──────────────────────────────────────────
export function useApprovalRequest(orgId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: approvalProcessKeys.requestDetail(orgId ?? '', id ?? ''),
    queryFn: async (): Promise<ApprovalRequestDetail> => {
      const { data } = await apiClient.get(endpoints.automation.requestById(orgId!, id!));
      return data as ApprovalRequestDetail;
    },
    enabled: !!orgId && !!id,
  });
}

// ── Hook: Approve Request Stage Mutation ───────────────────────────────────
export function useApproveStage(orgId: string | undefined, requestId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { comments?: string }) => {
      const { data } = await apiClient.post(
        endpoints.automation.approveRequest(orgId!, requestId!),
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.requests(orgId ?? '') });
      if (requestId) {
        queryClient.invalidateQueries({
          queryKey: approvalProcessKeys.requestDetail(orgId ?? '', requestId),
        });
      }
    },
  });
}

// ── Hook: Reject Request Mutation ──────────────────────────────────────────
export function useRejectRequest(orgId: string | undefined, requestId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { comments: string }) => {
      const { data } = await apiClient.post(
        endpoints.automation.rejectRequest(orgId!, requestId!),
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalProcessKeys.requests(orgId ?? '') });
      if (requestId) {
        queryClient.invalidateQueries({
          queryKey: approvalProcessKeys.requestDetail(orgId ?? '', requestId),
        });
      }
    },
  });
}

// ── Hook: Org Members & Roles ───────────────────────────────────────────────
export function useOrgMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-members', orgId ?? ''],
    queryFn: async () => {
      const res = await membersApi.list(orgId!, { perPage: 200, filter: 'all' });
      return res.results.filter(isMember);
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
}

export function useOrgRoles(orgId: string | undefined) {
  return useQuery({
    queryKey: ['org-roles', orgId ?? ''],
    queryFn: async () => {
      return await rolesApi.list(orgId!);
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
}

