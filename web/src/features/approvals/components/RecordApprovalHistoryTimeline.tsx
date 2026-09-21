import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, CheckCircle2, XCircle, ArrowRightCircle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { approvalsApi } from '../approvals.api';
import './RecordApprovalHistoryTimeline.css';

interface RecordApprovalHistoryTimelineProps {
  organizationId: string;
  moduleId: string;
  recordId: string;
}

export const RecordApprovalHistoryTimeline: React.FC<RecordApprovalHistoryTimelineProps> = ({
  organizationId,
  moduleId,
  recordId,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['record-approvals', organizationId, moduleId, recordId],
    queryFn: () => approvalsApi.getRecordApprovalHistory(organizationId, moduleId, recordId),
    enabled: Boolean(organizationId && moduleId && recordId),
  });

  if (isLoading) {
    return (
      <div className="record-approval-history">
        <div style={{ color: '#64748b', fontSize: 13, padding: '10px 0' }}>Loading approval history...</div>
      </div>
    );
  }

  if (!data?.allRequests || data.allRequests.length === 0) {
    return (
      <div className="record-approval-history">
        <div className="history-section-header">
          <h4>
            <History size={16} />
            Approval History
          </h4>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          No approval workflow records found for this document.
        </div>
      </div>
    );
  }

  return (
    <div className="record-approval-history">
      <div className="history-section-header">
        <h4>
          <History size={16} />
          Approval History ({data.allRequests.length})
        </h4>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.allRequests.map((req, idx) => (
          <div key={req.id} className="history-request-card">
            <div className="history-request-header">
              <div className="history-request-title">
                Cycle #{data.allRequests.length - idx}: {req.processName}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontWeight: 600,
                    background:
                      req.status === 'FINAL_APPROVED' || (req.status as string) === 'APPROVED'
                        ? '#dcfce7'
                        : req.status === 'REJECTED'
                        ? '#fee2e2'
                        : '#e0f2fe',
                    color:
                      req.status === 'FINAL_APPROVED' || (req.status as string) === 'APPROVED'
                        ? '#15803d'
                        : req.status === 'REJECTED'
                        ? '#b91c1c'
                        : '#0369a1',
                  }}
                >
                  {req.status}
                </span>
              </div>
              <Link
                to={`/organizations/${organizationId}/approvals/${req.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: '#2563eb',
                  textDecoration: 'none',
                }}
              >
                <span>Full Audit</span>
                <ExternalLink size={12} />
              </Link>
            </div>

            <div className="history-events-timeline">
              {req.history && req.history.length > 0 ? (
                req.history.map((ev) => {
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
                          <CheckCircle2 size={12} color="#10b981" />
                        ) : isReject ? (
                          <XCircle size={12} color="#ef4444" />
                        ) : (
                          <ArrowRightCircle size={12} color="#3b82f6" />
                        )}
                      </div>
                      <div className="timeline-event-content">
                        <div className="timeline-event-header">
                          <span className="timeline-event-type">{ev.eventType.replace(/_/g, ' ')}</span>
                          {ev.actorName && <span className="timeline-event-actor">by {ev.actorName}</span>}
                          <span className="timeline-event-time">
                            {new Date(ev.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {ev.comment && <div className="timeline-event-comment">{ev.comment}</div>}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Submitted at {new Date(req.submittedAt).toLocaleString()}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
