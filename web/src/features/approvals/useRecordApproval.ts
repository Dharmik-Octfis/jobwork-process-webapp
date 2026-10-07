import { useQuery } from '@tanstack/react-query';
import { approvalsApi } from './approvals.api';

/**
 * Hook to check if a record in any module is currently under approval.
 * Returns `isUnderApproval = true` if there is an active pending approval request.
 */
export function useRecordApproval(
  organizationId: string | undefined,
  moduleId: string | undefined,
  recordId: string | undefined,
) {
  const query = useQuery({
    queryKey: ['record-approvals', organizationId, moduleId, recordId],
    queryFn: () => approvalsApi.getRecordApprovalHistory(organizationId!, moduleId!, recordId!),
    enabled: Boolean(organizationId && moduleId && recordId),
    staleTime: 10 * 1000,
  });

  const activeRequest = query.data?.activeRequest ?? null;
  const allRequests = query.data?.allRequests ?? [];
  const latestRequest = activeRequest || allRequests[0] || null;
  const isUnderApproval = Boolean(
    activeRequest && (activeRequest.status === 'PENDING' || activeRequest.status === 'IN_PROGRESS'),
  );
  const isRejected = Boolean(latestRequest && latestRequest.status === 'REJECTED' && !activeRequest);

  return {
    ...query,
    activeRequest,
    latestRequest,
    allRequests,
    isUnderApproval,
    isRejected,
  };
}
