import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, ExternalLink, ShieldAlert, X, Lock } from 'lucide-react';
import { approvalsApi } from '../approvals.api';
import { useAuth } from '../../../providers/auth-context';
import './RecordApprovalBanner.css';

interface RecordApprovalBannerProps {
  organizationId: string;
  moduleId: string;
  recordId: string;
  onActionComplete?: () => void;
}

export const RecordApprovalBanner: React.FC<RecordApprovalBannerProps> = ({
  organizationId,
  moduleId,
  recordId,
  onActionComplete,
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['record-approvals', organizationId, moduleId, recordId],
    queryFn: () => approvalsApi.getRecordApprovalHistory(organizationId, moduleId, recordId),
    enabled: Boolean(organizationId && moduleId && recordId),
  });

  const approveMutation = useMutation({
    mutationFn: (reqId: string) => approvalsApi.approveRequest(organizationId, reqId, { comment }),
    onSuccess: () => {
      setApproveModalOpen(false);
      setComment('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['record-approvals', organizationId, moduleId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', organizationId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['bills', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['bill', organizationId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['items', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['item', organizationId, recordId] });
      onActionComplete?.();
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to submit approval.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (reqId: string) => approvalsApi.rejectRequest(organizationId, reqId, { reason: rejectReason }),
    onSuccess: () => {
      setRejectModalOpen(false);
      setRejectReason('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['record-approvals', organizationId, moduleId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', organizationId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['bills', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['bill', organizationId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['items', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['item', organizationId, recordId] });
      onActionComplete?.();
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to reject request.');
    },
  });

  const activeRequest = data?.activeRequest;
  const latestRequest = activeRequest || data?.allRequests?.[0] || null;

  if (isLoading || !latestRequest) {
    return null;
  }

  // If there is no active request and latest is not rejected, don't show the banner
  if (!activeRequest && latestRequest.status !== 'REJECTED') {
    return null;
  }

  const isRejected = latestRequest.status === 'REJECTED';
  const targetRequest = activeRequest || latestRequest;

  const currentStage =
    targetRequest.stages?.find(
      (s) => s.stageId === targetRequest.currentStageId || s.id === targetRequest.currentStageId,
    ) || targetRequest.stages?.[0];

  const stageMode = targetRequest.stages?.[0]?.approvalMode || 'ANYONE';
  const isAnyoneMode = stageMode === 'ANYONE' || stageMode === 'FIRST_RESPONSE';
  const isEveryoneMode = stageMode === 'EVERYONE';

  // Get last rejection comment if rejected
  const rejectionHistory = isRejected
    ? targetRequest.history?.slice().reverse().find((h) => h.eventType === 'REJECTED')
    : null;

  // Check current user's approver records across stages
  const userApproverRecords = targetRequest.stages
    ?.flatMap((s) => s.approvers || [])
    .filter((a) => a.userId === user?.id) || [];

  // An approver already approved if their record(s) are approved and they have no unapproved/rejected record
  const hasAlreadyApproved =
    userApproverRecords.length > 0 &&
    userApproverRecords.every((a) => a.status === 'APPROVED');

  const isRejecter = Boolean(
    rejectionHistory?.actorId && rejectionHistory.actorId === user?.id,
  );

  // Check if current user is a Process Admin (Rule Admin)
  const isRuleAdmin = Boolean(targetRequest.processAdminUserIds?.includes(user?.id || ''));

  // Determine if authenticated user can approve:
  // When rejected:
  //   - If Jay already approved: NO need to display reconsider & approve button
  //   - Dharmik who rejected (or has rejected/unapproved record) CAN reconsider & approve
  //   - Rule Admin can reconsider & approve
  // When active (PENDING / IN_PROGRESS):
  //   - Anyone / Everyone: any pending approver
  //   - Sequential: only active stage's pending approver
  const isAssignedApprover = isRejected
    ? !hasAlreadyApproved && (isRejecter || userApproverRecords.some((a) => a.status === 'REJECTED' || a.status === 'PENDING'))
    : (isAnyoneMode || isEveryoneMode)
    ? targetRequest.stages?.some((s) => s.approvers?.some((a) => a.userId === user?.id && a.status === 'PENDING'))
    : currentStage?.approvers?.some((a) => a.userId === user?.id && a.status === 'PENDING');

  // User can act if assigned approver or if Rule Admin (who has override authority)
  const canActOnApproval = isAssignedApprover || isRuleAdmin;

  // Collect pending approvers
  const allPendingApproverNames = Array.from(
    new Set(
      targetRequest.stages
        ?.flatMap((s) => s.approvers || [])
        .filter((a) => a.status === 'PENDING')
        .map((a) => a.fullName || a.email) || [],
    ),
  );

  const currentStagePendingNames =
    currentStage?.approvers?.filter((a) => a.status === 'PENDING').map((a) => a.fullName || a.email) || [];

  return (
    <>
      <div className={`record-approval-banner ${isRejected ? 'rejected' : ''}`}>
        <div className="approval-banner-left">
          <div className="approval-banner-icon" style={isRejected ? { background: '#fee2e2', color: '#dc2626' } : undefined}>
            {isRejected ? <XCircle size={20} /> : <Clock size={20} />}
          </div>
          <div className="approval-banner-info">
            <div className="approval-banner-title">
              <span>{targetRequest.processName}</span>
              {isRejected ? (
                <span className="approval-stage-badge" style={{ background: '#ef4444' }}>
                  Rejected · Record Inactive
                </span>
              ) : isAnyoneMode ? (
                <span className="approval-stage-badge">
                  Anyone from list ({targetRequest.stages?.length || 1} Stages)
                </span>
              ) : isEveryoneMode ? (
                <span className="approval-stage-badge">
                  Everyone from list (Parallel)
                </span>
              ) : (
                <span className="approval-stage-badge">
                  {currentStage?.name ? `Stage ${currentStage.stageOrder}: ${currentStage.name}` : 'Pending Approval'}
                </span>
              )}
              <span className="approval-lock-badge" title={isRejected ? "Record is currently rejected and inactive." : "Other actions are locked while pending approval. Only View, Edit, and Delete actions are permitted."}>
                <Lock size={12} />
                <span>{isRejected ? 'Inactive · Approval Rejected' : 'Locked · View, Edit, Delete only'}</span>
              </span>
            </div>
            <div className="approval-banner-sub">
              {isRejected ? (
                <span>
                  {rejectionHistory?.comment ? `Reason: ${rejectionHistory.comment}. ` : ''}
                  {hasAlreadyApproved
                    ? `You already approved this request. Waiting for ${rejectionHistory?.actorName || 'the rejecting approver'} to reconsider.`
                    : isRejecter
                    ? 'You rejected this request. You can reconsider and approve to reactivate it.'
                    : 'This record was rejected and is inactive.'}
                </span>
              ) : isAnyoneMode && allPendingApproverNames.length > 0 ? (
                <span>
                  Waiting for (Any one approver): <strong>{allPendingApproverNames.join(', ')}</strong>
                </span>
              ) : isEveryoneMode && allPendingApproverNames.length > 0 ? (
                <span>
                  Waiting for (All approvers in parallel): <strong>{allPendingApproverNames.join(', ')}</strong>
                </span>
              ) : currentStagePendingNames.length > 0 ? (
                <span>
                  Waiting for Stage {currentStage?.stageOrder}: <strong>{currentStagePendingNames.join(', ')}</strong>
                </span>
              ) : (
                <span>Approval workflow in progress</span>
              )}
            </div>
          </div>
        </div>

        <div className="approval-banner-actions">
          {canActOnApproval && (
            <>
              <button
                type="button"
                className="btn-banner-approve"
                onClick={() => {
                  setErrorMessage(null);
                  setApproveModalOpen(true);
                }}
              >
                <CheckCircle size={15} />
                {isRejected ? 'Reconsider & Approve' : 'Approve'}
              </button>
              {!isRejected && (
                <button
                  type="button"
                  className="btn-banner-reject"
                  onClick={() => {
                    setErrorMessage(null);
                    setRejectModalOpen(true);
                  }}
                >
                  <XCircle size={15} />
                  Reject
                </button>
              )}
            </>
          )}

          <Link
            to={`/organizations/${organizationId}/approvals/${targetRequest.id}`}
            className="btn-banner-view"
          >
            <span>Approval Details</span>
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* Approve Modal */}
      {approveModalOpen && (
        <div className="approval-modal-backdrop" onClick={() => setApproveModalOpen(false)}>
          <div className="approval-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="approval-modal-header">
              <h3>Approve Request</h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                onClick={() => setApproveModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="approval-modal-body">
              {isRuleAdmin && (
                <div style={{ fontSize: 13, color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 6, marginBottom: 12, border: '1px solid #bbf7d0' }}>
                  <strong>Process Admin Override:</strong> You have Process Admin authority for this rule. Confirming approval will immediately complete and approve this record (no approval required from Jay, Dharmik, or remaining stage approvers).
                </div>
              )}
              {!isRuleAdmin && !isAnyoneMode && !isEveryoneMode && (
                <div style={{ fontSize: 13, color: '#1e40af', background: '#dbeafe', padding: '8px 12px', borderRadius: 6, marginBottom: 12, border: '1px solid #bfdbfe' }}>
                  Approving Stage {currentStage?.stageOrder} will advance this request to the next stage approver.
                </div>
              )}
              {errorMessage && (
                <div style={{ color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldAlert size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}
              <label>Optional Comment / Remarks</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Enter approval note..."
              />
            </div>
            <div className="approval-modal-footer">
              <button
                type="button"
                className="btn-banner-view"
                onClick={() => setApproveModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-banner-approve"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate(targetRequest.id)}
              >
                {approveMutation.isPending ? 'Approving...' : 'Confirm Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalOpen && (
        <div className="approval-modal-backdrop" onClick={() => setRejectModalOpen(false)}>
          <div className="approval-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="approval-modal-header">
              <h3>Reject Request</h3>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                onClick={() => setRejectModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="approval-modal-body">
              {errorMessage && (
                <div style={{ color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldAlert size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}
              <label>Rejection Reason <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please explain why this request is being rejected..."
                required
              />
            </div>
            <div className="approval-modal-footer">
              <button
                type="button"
                className="btn-banner-view"
                onClick={() => setRejectModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-banner-reject"
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                onClick={() => rejectMutation.mutate(targetRequest.id)}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
