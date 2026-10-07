import { useState } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import type { ApprovalRequestDetail } from '../types/approvalProcess.types';
import { useApproveStage, useRejectRequest } from '../api/approvalProcess.api';

interface ApprovalExecutionTimelineProps {
  orgId: string;
  request: ApprovalRequestDetail;
  onClose: () => void;
}

export function ApprovalExecutionTimeline({
  orgId,
  request,
  onClose,
}: ApprovalExecutionTimelineProps) {
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const approveMutation = useApproveStage(orgId, request.id);
  const rejectMutation = useRejectRequest(orgId, request.id);

  const safeStatus = request?.status || 'PENDING';
  const canTakeAction = safeStatus === 'PENDING' || safeStatus === 'IN_PROGRESS';
  const safeStages = Array.isArray(request?.stages) ? request.stages : [];
  const safeHistory = Array.isArray(request?.history) ? request.history : [];

  const handleApprove = async () => {
    try {
      setActionError(null);
      await approveMutation.mutateAsync({ comments: comment.trim() || undefined });
      setComment('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Approval failed.';
      setActionError(msg);
    }
  };

  const handleReject = async () => {
    if (!comment.trim()) {
      setActionError('Comments are required when rejecting a request.');
      return;
    }
    try {
      setActionError(null);
      await rejectMutation.mutateAsync({ comments: comment.trim() });
      setComment('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rejection failed.';
      setActionError(msg);
    }
  };

  return (
    <div
      className="ap-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ap-modal ap-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-title">
        <div className="ap-modal-header">
          <div className="ap-timeline-header-meta">
            <h3 id="timeline-title" className="ap-modal-title">
              Approval Request Timeline
            </h3>
            <span className={`ap-status-badge is-${safeStatus.toLowerCase()}`}>
              {safeStatus.replace('_', ' ')}
            </span>
          </div>
          <button type="button" className="ap-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="ap-modal-body">
          {actionError && (
            <div className="ap-alert ap-alert-error" role="alert">
              <AlertCircle size={16} />
              <span>{actionError}</span>
            </div>
          )}

          {/* Record Metadata summary */}
          <div className="ap-timeline-summary-card">
            <div className="ap-summary-row">
              <span className="ap-summary-label">Process:</span>
              <span className="ap-summary-value">{request?.processName || 'N/A'}</span>
            </div>
            <div className="ap-summary-row">
              <span className="ap-summary-label">Target Record:</span>
              <span className="ap-summary-value">
                {request?.moduleName || 'Module'} ({request?.recordTitle || request?.recordId || 'N/A'})
              </span>
            </div>
            <div className="ap-summary-row">
              <span className="ap-summary-label">Submitted:</span>
              <span className="ap-summary-value">
                {request?.submittedAt ? new Date(request.submittedAt).toLocaleString() : 'N/A'}
              </span>
            </div>
          </div>

          {/* Stages Progression */}
          <div className="ap-timeline-section">
            <h4 className="ap-timeline-section-title">Stages Progress</h4>
            <div className="ap-timeline-flow">
              {safeStages.map((st) => {
                const isCurrent = st.id === request?.currentStageId;
                const approversList = Array.isArray(st?.approvers) ? st.approvers : [];
                return (
                  <div
                    key={st.id}
                    className={`ap-timeline-stage-item ${isCurrent ? 'is-current' : ''} is-${(st.status || 'PENDING').toLowerCase()}`}
                  >
                    <div className="ap-timeline-marker">
                      {st.status === 'APPROVED' ? (
                        <CheckCircle2 size={18} className="ap-icon-success" />
                      ) : st.status === 'REJECTED' ? (
                        <XCircle size={18} className="ap-icon-danger" />
                      ) : (
                        <Clock size={18} className="ap-icon-pending" />
                      )}
                    </div>

                    <div className="ap-timeline-stage-info">
                      <div className="ap-timeline-stage-header">
                        <span className="ap-stage-name">
                          Stage {st.stageOrder}: {st.name}
                        </span>
                        <span className={`ap-stage-status-badge is-${(st.status || 'PENDING').toLowerCase()}`}>
                          {st.status}
                        </span>
                      </div>

                      {/* Approvers */}
                      <div className="ap-timeline-approvers-list">
                        {approversList.map((appr) => (
                          <div key={appr.id} className="ap-approver-entry">
                            <User size={14} />
                            <span className="ap-approver-name">{appr.fullName || appr.email || appr.userId}</span>
                            <span className={`ap-approver-status is-${(appr.status || 'PENDING').toLowerCase()}`}>
                              ({appr.status})
                            </span>
                            {appr.comment && (
                              <div className="ap-approver-comment">
                                <MessageSquare size={12} />
                                <span>&quot;{appr.comment}&quot;</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audit History Log */}
          {safeHistory.length > 0 && (
            <div className="ap-timeline-section">
              <h4 className="ap-timeline-section-title">Audit History Log</h4>
              <div className="ap-history-log-list">
                {safeHistory.map((hist) => (
                  <div key={hist.id} className="ap-history-log-item">
                    <div className="ap-history-meta">
                      <span className="ap-history-action">{hist.eventType}</span>
                      <span className="ap-history-time">
                        {hist.createdAt
                          ? new Date(hist.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                    {hist.comment && (
                      <div className="ap-history-comment">{hist.comment}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions Bar if user can take action */}
          {canTakeAction && (
            <div className="ap-timeline-action-box">
              <h4 className="ap-action-box-title">Make a Decision</h4>
              <textarea
                className="ap-textarea"
                rows={2}
                placeholder="Add comments (required for rejection)..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="ap-action-box-buttons">
                <button
                  type="button"
                  className="ap-button ap-button-danger"
                  onClick={handleReject}
                  disabled={rejectMutation.isPending || approveMutation.isPending}
                >
                  <XCircle size={16} /> Reject
                </button>
                <button
                  type="button"
                  className="ap-button ap-button-success"
                  onClick={handleApprove}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <CheckCircle2 size={16} /> Approve
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="ap-modal-footer">
          <button type="button" className="ap-button ap-button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
