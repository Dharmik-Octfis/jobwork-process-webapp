import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Printer,
  X,
  Copy,
  Check,
  Building2,
  Warehouse,
  ArrowRight,
  ExternalLink,
  Package,
  Send,
  Trash2,
  Edit,
  CircleSlash,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { formatDate } from '../../../lib/formatDate';
import { organizationsApi } from '../../organizations/organizations.api';
import { ISSUE_STATUS_META, formatQty, sharedUnit, statusMeta, toNumber } from '../jobwork.schemas';
import { invalidateStockQueries } from '../stockCache';
import { cancelJobIssue, deleteJobIssue, fetchJobIssueById, postJobIssue } from './jobIssues.api';
import { printChallan } from './printChallan';
import type { JobIssue, JobIssuesPage } from './jobIssues.schemas';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';

interface Props {
  issueId: string;
  onClose: () => void;
}

function patchStatusInLists(
  queryClient: QueryClient,
  orgId: string | undefined,
  issueId: string,
  status: string,
) {
  const swap = (rows: JobIssue[]) =>
    rows.map((item) => (item.id === issueId ? { ...item, status } : item));

  queryClient.setQueriesData(
    { queryKey: ['job-issues', orgId], type: 'active' },
    (old: JobIssuesPage | JobIssue[] | undefined) => {
      if (!old) return old;
      if (Array.isArray(old)) return swap(old);
      if (!old.results) return old;
      return { ...old, results: swap(old.results) };
    },
  );
  queryClient.invalidateQueries({ queryKey: ['job-issues', orgId], type: 'inactive' });
}

export function IssueDetail({ issueId, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const trackingLabel = useTrackingLabel();
  const unitLabel = useBatchUnitLabel();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['job-issue', orgId, issueId],
    queryFn: () => fetchJobIssueById(orgId!, issueId),
    enabled: Boolean(orgId && issueId),
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });
  const orgName =
    organizations.find((org) => org.organizationId === orgId)?.name ?? 'Delivery Challan';

  const cancelMutation = useMutation({
    mutationFn: () => cancelJobIssue(orgId!, issueId, cancelReason),
    onSuccess: () => {
      patchStatusInLists(queryClient, orgId, issueId, 'cancelled');
      queryClient.invalidateQueries({ queryKey: ['job-issue', orgId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      invalidateStockQueries(queryClient, orgId);
      setCancelOpen(false);
      setCancelReason('');
      toast.success('Challan cancelled');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not cancel this challan');
    },
  });

  const postMutation = useMutation({
    mutationFn: () => postJobIssue(orgId!, issueId),
    onSuccess: (posted) => {
      patchStatusInLists(queryClient, orgId, issueId, posted.status);
      queryClient.invalidateQueries({ queryKey: ['job-issue', orgId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      invalidateStockQueries(queryClient, orgId);
      setError(null);
      toast.success('Challan issued successfully');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not issue this challan');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteJobIssue(orgId!, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      setDeleteOpen(false);
      toast.success('Draft deleted');
      onClose();
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not delete this draft');
      setDeleteOpen(false);
    },
  });

  const handleCopyChallanNumber = () => {
    if (issue?.challanNumber) {
      navigator.clipboard.writeText(issue.challanNumber);
      setCopied(true);
      toast.success('Challan number copied');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading challan details…" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div style={{ padding: 32, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
        Challan not found.
      </div>
    );
  }

  const unit = sharedUnit(issue.lines);
  const status = statusMeta(ISSUE_STATUS_META, issue.status);

  const issuedByItem = (() => {
    const totals = new Map<string, { name: string; unit: string; qty: number }>();
    for (const line of issue.lines) {
      if (!line.item) continue;
      const key = line.item.id;
      const existing = totals.get(key) ?? {
        name: line.item.name,
        unit: line.uom ? (line.uom.symbol ?? line.uom.unitName) : '',
        qty: 0,
      };
      existing.qty += toNumber(line.qty);
      totals.set(key, existing);
    }
    return [...totals.values()];
  })();

  const getStatusIcon = () => {
    switch (issue.status) {
      case 'issued':
        return <CheckCircle2 size={13} />;
      case 'draft':
        return <Clock size={13} />;
      case 'cancelled':
        return <CircleSlash size={13} />;
      default:
        return null;
    }
  };

  return (
    <div
      style={{ background: '#ffffff', minHeight: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header Bar */}
      <header
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: '#0f172a',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {issue.challanNumber}
            </h2>

            <button
              type="button"
              onClick={handleCopyChallanNumber}
              title="Copy challan number"
              aria-label="Copy challan number"
              style={{
                background: 'none',
                border: 'none',
                padding: 4,
                cursor: 'pointer',
                color: copied ? '#16a34a' : '#94a3b8',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 4,
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 12,
                fontSize: 11.5,
                fontWeight: 600,
                color: status.color,
                background: status.bg,
                border: `1px solid ${status.color}25`,
              }}
            >
              {getStatusIcon()}
              <span>{status.label}</span>
            </span>

            {issue.isRework && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  background: '#fffbeb',
                  color: '#b45309',
                  border: '1px solid #fde68a',
                }}
              >
                Rework #{issue.attemptNo}
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: 12,
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{formatDate(issue.issueDate)}</span>
            <span>•</span>
            <span>
              {issue.processorNameSnapshot ??
                (issue.processorType === 'internal' ? 'In-house Work Centre' : 'Processor')}
            </span>
          </div>
        </div>

        {/* Action Buttons Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {issue.status === 'draft' && (
            <>
              <button
                type="button"
                onClick={() =>
                  navigate(`/organizations/${orgId}/jobwork/issues/new?draftId=${issue.id}`, {
                    state: { returnUrl: `/organizations/${orgId}/jobwork/issues` },
                  })
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 12px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                <Edit size={14} /> Edit Draft
              </button>

              <button
                type="button"
                onClick={() => postMutation.mutate()}
                disabled={postMutation.isPending}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 6,
                  background: postMutation.isPending ? '#93c5fd' : 'var(--color-primary, #0284c7)',
                  cursor: postMutation.isPending ? 'not-allowed' : 'pointer',
                  color: '#fff',
                  boxShadow: '0 1px 2px rgba(2, 132, 199, 0.2)',
                }}
              >
                <Send size={14} />
                <span>{postMutation.isPending ? 'Issuing…' : 'Issue Challan'}</span>
              </button>

              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 10px',
                  fontSize: 12.5,
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#dc2626',
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}

          {issue.status !== 'draft' && (
            <button
              type="button"
              onClick={() => {
                const opened = printChallan(issue, orgName, trackingLabel.singular, unitLabel);
                if (!opened) {
                  setError(
                    'The print window was blocked. Allow pop-ups for this site and try again.',
                  );
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                color: '#1e293b',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <Printer size={15} color="#0284c7" />
              <span>Print Challan</span>
            </button>
          )}

          {issue.status !== 'cancelled' && issue.status !== 'draft' && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 500,
                border: '1px solid #fecaca',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                color: '#b91c1c',
              }}
            >
              <CircleSlash size={14} /> Cancel
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail pane"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          role="alert"
        >
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Scrollable Content Body */}
      <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
        {/* Logistics Movement Flow Banner */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '16px 20px',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 12,
            }}
          >
            Material Movement Route
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            {/* Origin Source Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: '#eff6ff',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Warehouse size={18} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Issued From</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  {issue.sourceLocation?.name ?? 'Our Godown'}
                </div>
              </div>
            </div>

            {/* Directional Transit Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0284c7' }}>
              <div style={{ width: 24, height: 1, background: '#bae6fd' }} />
              <ArrowRight size={16} />
              <div style={{ width: 24, height: 1, background: '#bae6fd' }} />
            </div>

            {/* Destination Processor */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: issue.processorType === 'internal' ? '#f0fdf4' : '#faf5ff',
                  color: issue.processorType === 'internal' ? '#16a34a' : '#7c3aed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {issue.processorType === 'internal' ? (
                  <Warehouse size={18} />
                ) : (
                  <Building2 size={18} />
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                  {issue.processorType === 'internal'
                    ? 'In-house Work Centre'
                    : 'Processor (Vendor)'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  {issue.processorNameSnapshot ?? issue.destination?.name ?? 'Processor Location'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Context Metric Tiles */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #eef0f3',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#64748b',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Job Order
            </div>
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/organizations/${orgId}/jobwork/job-orders/${issue.jobOrderId}`)
                }
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-primary, #0284c7)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>{issue.jobOrder?.jobOrderNumber ?? 'Open Order'}</span>
                <ExternalLink size={12} />
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #eef0f3',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#64748b',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Process Step
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginTop: 4 }}>
              {issue.step ? `Step ${issue.step.seq}: ${issue.step.processNameSnapshot}` : '-'}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #eef0f3',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#64748b',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Total Dispatched
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#0f172a',
                fontVariantNumeric: 'tabular-nums',
                marginTop: 4,
              }}
            >
              {formatQty(issue.totalQty)} {unit}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #eef0f3',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#64748b',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Issue Date
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#334155', marginTop: 4 }}>
              {formatDate(issue.issueDate)}
            </div>
          </div>
        </div>

        {/* Material Lines Breakdown Card */}
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: '#0f172a',
              }}
            >
              <Package size={15} color="#0284c7" />
              <span>Dispatched Material Lines ({issue.lines.length})</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {issuedByItem
                .map((item) => `${item.name} (${formatQty(item.qty)} ${item.unit})`)
                .join(', ')}
            </div>
          </div>

          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#fcfcfd', borderBottom: '1px solid #e2e8f0' }}>
                  <th
                    style={{
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Item
                  </th>
                  <th
                    style={{
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {trackingLabel.singular} Ref
                  </th>
                  <th
                    style={{
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      textAlign: 'right',
                    }}
                  >
                    Dispatched Quantity
                  </th>
                </tr>
              </thead>
              <tbody>
                {issue.lines.map((line, idx) => (
                  <tr
                    key={line.id}
                    style={{
                      borderBottom: idx === issue.lines.length - 1 ? 'none' : '1px solid #f1f5f9',
                      background: idx % 2 === 0 ? '#fff' : '#fafafa',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#1e293b',
                      }}
                    >
                      {line.item?.name ?? '-'}
                      {line.item?.sku && (
                        <span
                          style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}
                        >
                          SKU: {line.item.sku}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#475569' }}>
                      {line.batch?.supplierBatchRef ? (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 500,
                            color: '#334155',
                          }}
                        >
                          {line.batch.supplierBatchRef}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>Unspecified / FIFO</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#0f172a',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatQty(line.qty)} {line.uom?.symbol ?? line.uom?.unitName ?? unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Remarks & Tolerance Notes (if present) */}
        {(issue.remarks || issue.toleranceOverrideReason) && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {issue.remarks && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    marginBottom: 2,
                  }}
                >
                  Remarks / Dispatch Notes
                </div>
                <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap' }}>
                  {issue.remarks}
                </div>
              </div>
            )}

            {issue.toleranceOverrideReason && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#b45309',
                    textTransform: 'uppercase',
                    marginBottom: 2,
                  }}
                >
                  Tolerance Override Reason
                </div>
                <div style={{ fontSize: 13, color: '#92400e' }}>
                  {issue.toleranceOverrideReason}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Cancellation Dialog */}
      <ConfirmDialog
        isOpen={cancelOpen}
        title="Cancel this Delivery Challan"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6, fontSize: 13, color: '#334155' }}>
              Cancelling this challan will return all allocated stock back to{' '}
              <strong>{issue.sourceLocation?.name ?? 'its source godown'}</strong> via reversing
              ledger entries. The original movement remains in the audit trail.
            </p>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#475569',
                marginBottom: 4,
              }}
            >
              Cancellation Reason <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g., Wrong processor selected, goods rejected before transit..."
              aria-label="Reason for cancelling"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
        }
        confirmText={cancelMutation.isPending ? 'Cancelling…' : 'Cancel Challan'}
        cancelText="Keep Challan"
        onConfirm={() => {
          if (cancelReason.trim()) cancelMutation.mutate();
        }}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
      />

      {/* Confirm Delete Draft Dialog */}
      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete this Draft Challan"
        message={
          <p style={{ margin: 0, lineHeight: 1.6, fontSize: 13, color: '#334155' }}>
            Draft <strong>{issue.challanNumber}</strong> has not yet been issued, so no stock has
            moved. Deleting it will permanently remove this draft from your system.
          </p>
        }
        confirmText={deleteMutation.isPending ? 'Deleting…' : 'Delete Draft'}
        cancelText="Keep Draft"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
