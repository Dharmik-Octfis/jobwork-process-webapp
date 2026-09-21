import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, ExternalLink, ShieldAlert, X } from 'lucide-react';
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
      queryClient.invalidateQueries({ queryKey: ['record-approvals', organizationId, moduleId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
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
      queryClient.invalidateQueries({ queryKey: ['record-approvals', organizationId, moduleId, recordId] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      onActionComplete?.();
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to reject request.');
    },
  });

  if (isLoading || !data?.activeRequest) {
    return null;
  }

  const activeRequest = data.activeRequest;
  const currentStage = activeRequest.stages?.find(
    (s) => s.stageId === activeRequest.currentStageId || s.id === activeRequest.currentStageId,
  ) || activeRequest.stages?.[0];

  // Determine if authenticated user can approve:
  // 1. They are an assigned pending approver for the current stage
  const isAssignedApprover = currentStage?.approvers?.some(
    (a) => a.userId === user?.id && a.status === 'PENDING',
  );

  // 2. They are an org owner (backend enforces this authorization too)
  // The auth context user object has isOwner when set via membership
  const isOrgOwner = !!(user as any)?.isOwner;

  // 3. They can act on this approval if they meet any of the above
  const canActOnApproval = isAssignedApprover || isOrgOwner;

  return (
    <>
      <div className="record-approval-banner">
        <div className="approval-banner-left">
          <div className="approval-banner-icon">
            <Clock size={20} />
          </div>
          <div className="approval-banner-info">
            <div className="approval-banner-title">
              <span>{activeRequest.processName}</span>
              <span className="approval-stage-badge">
                {currentStage?.name ? `Stage ${currentStage.stageOrder}: ${currentStage.name}` : 'Pending Approval'}
              </span>
            </div>
            <div className="approval-banner-sub">
              {currentStage?.approvers && currentStage.approvers.length > 0 ? (
                <span>
                  Waiting for: {currentStage.approvers.map((a) => a.fullName || a.email).join(', ')}
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
                Approve
              </button>
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
            </>
          )}

          <Link
            to={`/organizations/${organizationId}/approvals/${activeRequest.id}`}
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
                onClick={() => approveMutation.mutate(activeRequest.id)}
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
                onClick={() => rejectMutation.mutate(activeRequest.id)}
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
