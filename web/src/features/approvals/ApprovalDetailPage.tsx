import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  CheckCircle2,
  ExternalLink,
  Layers,
  FileText,
  History,
  ShieldAlert,
  Zap,
  X,
  Loader2,
  Package,
} from 'lucide-react';
import { approvalsApi } from './approvals.api';
import { useAuth } from '../../providers/auth-context';
import { resolveRecordRoute, getModuleBadgeStyle } from './approvalRoutes.helper';
import './ApprovalDetailPage.css';

/** Helper to format raw field keys into clean Title Case labels */
function formatFieldLabel(key: string): string {
  const customLabels: Record<string, string> = {
    poNumber: 'PO Number',
    subTotal: 'Sub Total',
    totalAmount: 'Total Amount',
    poDate: 'Order Date',
    date: 'Order Date',
    deliveryDate: 'Delivery Date',
    deliveryType: 'Delivery Type',
    paymentTerms: 'Payment Terms',
    termsAndConditions: 'Terms & Conditions',
  };
  if (customLabels[key]) return customLabels[key];
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/** Helper to format currency values */
function formatValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  const numericKeys = ['subTotal', 'totalAmount', 'amount', 'rate', 'price', 'sub_total', 'total_amount'];
  if (numericKeys.includes(key) && !isNaN(Number(val))) {
    return `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  // Format ISO date strings
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }

  return String(val);
}

export const ApprovalDetailPage: React.FC = () => {
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: request, isLoading, error } = useQuery({
    queryKey: ['approval-request-detail', orgId, id],
    queryFn: () => approvalsApi.getRequestById(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const approveMutation = useMutation({
    mutationFn: () => approvalsApi.approveRequest(orgId!, id!, { comment }),
    onSuccess: () => {
      setApproveModalOpen(false);
      setComment('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['approval-request-detail', orgId, id] });
      queryClient.invalidateQueries({ queryKey: ['approvals-inbox'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to submit approval.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => approvalsApi.rejectRequest(orgId!, id!, { reason: rejectReason }),
    onSuccess: () => {
      setRejectModalOpen(false);
      setRejectReason('');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['approval-request-detail', orgId, id] });
      queryClient.invalidateQueries({ queryKey: ['approvals-inbox'] });
    },
    onError: (err: any) => {
      setErrorMessage(err.response?.data?.message || 'Failed to reject request.');
    },
  });

  if (isLoading) {
    return (
      <div className="approval-detail-page">
        <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Loader2 size={22} className="cap-spinner" />
          <span>Loading approval request details...</span>
        </div>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="approval-detail-page">
        <Link to={`/organizations/${orgId}/approvals`} className="approval-detail-nav-back">
          <ArrowLeft size={16} />
          Back to Approvals
        </Link>
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#ef4444' }}>
          Approval request not found or inaccessible.
        </div>
      </div>
    );
  }

  const badgeStyle = getModuleBadgeStyle(request.moduleId);
  const recordRoute = orgId ? resolveRecordRoute(orgId, request.moduleId, request.recordId) : '#';

  // Active stage and authorization detection
  const activeStage = request.stages?.find(
    (s) => s.stageId === request.currentStageId || s.id === request.currentStageId,
  );

  const stageMode = request.stages?.[0]?.approvalMode || 'ANYONE';
  const isAnyoneMode = stageMode === 'ANYONE' || stageMode === 'FIRST_RESPONSE';
  const isEveryoneMode = stageMode === 'EVERYONE';

  const isRejected = request.status === 'REJECTED';
  const isPendingOrInProgress = request.status === 'IN_PROGRESS' || request.status === 'PENDING';

  const lastRejection = isRejected
    ? request.history?.slice().reverse().find((h) => h.eventType === 'REJECTED')
    : null;

  const userApproverRecords = request.stages
    ?.flatMap((s) => s.approvers || [])
    .filter((a) => a.userId === user?.id) || [];

  const hasAlreadyApproved =
    userApproverRecords.length > 0 &&
    userApproverRecords.every((a) => a.status === 'APPROVED');

  const isRejecter = Boolean(
    lastRejection?.actorId && lastRejection.actorId === user?.id,
  );

  const isAssignedApprover = isPendingOrInProgress
    ? (isAnyoneMode || isEveryoneMode)
      ? request.stages?.some((s) => s.approvers?.some((a) => a.userId === user?.id && a.status === 'PENDING'))
      : activeStage?.approvers?.some((a) => a.userId === user?.id && a.status === 'PENDING')
    : isRejected
    ? !hasAlreadyApproved && (isRejecter || userApproverRecords.some((a) => a.status === 'REJECTED' || a.status === 'PENDING'))
    : false;

  const isRuleAdmin = Boolean(request.processAdminUserIds?.includes(user?.id || ''));

  const canActOnApproval = isRejected
    ? (!hasAlreadyApproved && (isAssignedApprover || isRejecter)) || isRuleAdmin
    : isAssignedApprover || isRuleAdmin || Boolean(request.isApproverForCurrentUser);

  // Extract snapshot fields filtering out internal system UUIDs and array collections
  const IGNORED_SNAPSHOT_KEYS = new Set([
    'id',
    'organizationId',
    'vendorId',
    'deliveryLocationId',
    'deliveryCustomerId',
    'locationId',
    'createdBy',
    'updatedBy',
    'isDeleted',
    'documents',
    'customFields',
    'lineItems',
    'items',
    'activities',
    'comments',
    'attachments',
  ]);

  const snapshot = request.recordSnapshot || {};
  const snapshotEntries = Object.entries(snapshot).filter(([k]) => !IGNORED_SNAPSHOT_KEYS.has(k));

  // Extract line items if present in snapshot
  const lineItems: Array<Record<string, unknown>> = Array.isArray(snapshot.lineItems)
    ? (snapshot.lineItems as Array<Record<string, unknown>>)
    : Array.isArray(snapshot.items)
    ? (snapshot.items as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="approval-detail-page">
      {/* Back link */}
      <Link to={`/organizations/${orgId}/approvals`} className="approval-detail-nav-back">
        <ArrowLeft size={16} />
        Back to Approvals Inbox
      </Link>

      {/* Header Card */}
      <div className="approval-detail-header-card">
        <div className="header-left-section">
          <div className="header-process-icon">
            <Layers size={22} />
          </div>
          <div className="header-details">
            <h1>
              <span>{request.recordTitle || `Record ${request.recordId.slice(0, 8)}`}</span>
              <span
                className="module-badge"
                style={{ background: badgeStyle.bg, color: badgeStyle.color }}
              >
                {badgeStyle.label}
              </span>
              <span className={`status-chip ${request.status.toLowerCase()}`}>
                {request.status === 'FINAL_APPROVED'
                  ? 'Approved'
                  : request.status === 'IN_PROGRESS'
                  ? 'Pending'
                  : request.status}
              </span>
            </h1>
            <div className="header-meta-row">
              <span>Process: <strong>{request.processName}</strong></span>
              {request.ruleName && <span>Rule: <strong>{request.ruleName}</strong></span>}
              <span>Requested by: <strong>{request.requesterName || 'System'}</strong></span>
              <span>Submitted: {new Date(request.submittedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="header-right-actions">
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

          <Link to={recordRoute} className="btn-banner-view">
            <span>View Record</span>
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="approval-detail-grid">
        {/* Left Column: Workflow Stages & Record Snapshot */}
        <div>
          {/* Approval Stages Flow */}
          <div className="detail-card">
            <h3 className="detail-card-title">
              <Layers size={17} color="#2563eb" />
              Approval Workflow Stages ({request.stages?.length || 0})
            </h3>

            <div className="stages-flow-list">
              {request.stages?.map((stage) => {
                const isActive = stage.stageId === request.currentStageId || stage.id === request.currentStageId;
                const isCompleted = stage.status === 'APPROVED';
                const isRejected = stage.status === 'REJECTED';

                return (
                  <div
                    key={stage.id}
                    className={`stage-step-card ${
                      isActive ? 'active' : isCompleted ? 'completed' : isRejected ? 'rejected' : ''
                    }`}
                  >
                    <div className="stage-step-header">
                      <div className="stage-step-name">
                        <span>Stage {stage.stageOrder}: {stage.name}</span>
                        {isActive && <span className="approval-stage-badge">Current Stage</span>}
                      </div>
                      <span className={`status-chip ${stage.status.toLowerCase()}`}>
                        {stage.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Approval Mode: <strong>{stage.approvalMode}</strong>
                    </div>

                    {/* Approver assignment status */}
                    {stage.approvers && stage.approvers.length > 0 && (
                      <div className="stage-approver-list">
                        {stage.approvers.map((appr) => (
                          <div key={appr.id} className="stage-approver-row">
                            <div>
                              <strong style={{ color: '#0f172a' }}>{appr.fullName || appr.email}</strong>
                              {appr.actionTakenAt && (
                                <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 11 }}>
                                  ({new Date(appr.actionTakenAt).toLocaleTimeString()})
                                </span>
                              )}
                            </div>
                            <span className={`status-chip ${appr.status.toLowerCase()}`}>
                              {appr.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Record Snapshot */}
          <div className="detail-card">
            <h3 className="detail-card-title">
              <FileText size={17} color="#059669" />
              Record Snapshot at Submission
            </h3>

            {/* Grid of Key Record Fields */}
            <div className="snapshot-fields-grid">
              {snapshotEntries.map(([key, val]) => (
                <div key={key} className="snapshot-field-item">
                  <div className="snapshot-field-label">{formatFieldLabel(key)}</div>
                  <div className="snapshot-field-val">{formatValue(key, val)}</div>
                </div>
              ))}
            </div>

            {/* Line Items Table if present */}
            {lineItems.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Package size={15} color="#2563eb" />
                  <span>Line Items at Submission ({lineItems.length})</span>
                </div>
                <table className="snapshot-line-items-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Quantity</th>
                      <th>Rate</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => {
                      const qty = Number(item.quantity ?? 0);
                      const rate = Number(item.rate ?? item.costPrice ?? 0);
                      const amt = Number(item.itemTotal ?? item.amount ?? qty * rate);
                      return (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>{qty}</td>
                          <td>₹{rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td><strong>₹{amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Executed Actions & Audit Timeline */}
        <div>
          {/* Automated Actions */}
          {request.actions && request.actions.length > 0 && (
            <div className="detail-card">
              <h3 className="detail-card-title">
                <Zap size={17} color="#ea580c" />
                Triggered Actions ({request.actions.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {request.actions.map((act) => (
                  <div
                    key={act.id}
                    style={{
                      padding: '8px 12px',
                      background: '#f8fafc',
                      borderRadius: 6,
                      fontSize: 12,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>
                      {act.actionType.replace(/_/g, ' ')} ({act.triggerEvent})
                    </div>
                    <div style={{ color: act.status === 'SUCCESS' ? '#15803d' : '#b91c1c' }}>
                      Status: {act.status}
                    </div>
                    {act.errorMessage && (
                      <div style={{ color: '#ef4444', fontSize: 11 }}>{act.errorMessage}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution History Timeline */}
          <div className="detail-card">
            <h3 className="detail-card-title">
              <History size={17} color="#6366f1" />
              Audit Timeline
            </h3>
            <div className="history-events-timeline">
              {request.history?.map((ev) => {
                const isApprove = ev.eventType === 'APPROVED' || ev.eventType === 'FINAL_APPROVED';
                const isReject = ev.eventType === 'REJECTED';
                return (
                  <div key={ev.id} className="timeline-event-item">
                    <div
                      className={`timeline-event-icon ${
                        isApprove ? 'approved' : isReject ? 'rejected' : ''
                      }`}
                    >
                      {isApprove ? (
                        <CheckCircle2 size={14} color="#10b981" />
                      ) : isReject ? (
                        <XCircle size={14} color="#ef4444" />
                      ) : (
                        <Clock size={14} color="#3b82f6" />
                      )}
                    </div>
                    <div className="timeline-event-content">
                      <div className="timeline-event-header">
                        <span>{ev.eventType.replace(/_/g, ' ')}</span>
                        {ev.actorName && <span className="timeline-event-actor">by {ev.actorName}</span>}
                      </div>
                      <span className="timeline-event-time">
                        {new Date(ev.createdAt).toLocaleString()}
                      </span>
                      {ev.comment && <div className="timeline-event-comment">{ev.comment}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
                placeholder="Enter approval note or remarks..."
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
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="cap-spinner" />
                    <span>Approving...</span>
                  </>
                ) : (
                  'Confirm Approve'
                )}
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
                onClick={() => rejectMutation.mutate()}
              >
                {rejectMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="cap-spinner" />
                    <span>Rejecting...</span>
                  </>
                ) : (
                  'Confirm Reject'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalDetailPage;
