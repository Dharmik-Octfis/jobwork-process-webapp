import { useState, useMemo } from 'react';
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
  Truck,
  ClipboardList,
  Layers,
  Calendar,
  History,
  FileText,
  Boxes,
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

  const [activeTab, setActiveTab] = useState<'overview' | 'units' | 'activity'>('overview');
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

  const issuedByItem = useMemo(() => {
    if (!issue) return [];
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
  }, [issue]);

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

  const packageLinesCount = issue.lines.filter((l) => Boolean(l.batchUnit)).length;

  return (
    <div
      style={{
        background: '#ffffff',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 1. Header Bar */}
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
                fontSize: 18,
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
                border: `1px solid ${issue.status === 'issued' ? '#bae6fd' : issue.status === 'cancelled' ? '#fecdd3' : '#cbd5e1'}`,
                lineHeight: 1.3,
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
            {issue.jobOrder?.jobOrderNumber && (
              <>
                <span>•</span>
                <span style={{ color: '#0284c7', fontWeight: 500 }}>
                  JO {issue.jobOrder.jobOrderNumber}
                </span>
              </>
            )}
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
                  gap: 6,
                  padding: '7px 13px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#334155',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                  transition: 'all 0.12s ease',
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
                  gap: 6,
                  padding: '7px 15px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 6,
                  background: postMutation.isPending ? '#93c5fd' : 'var(--color-primary, #0284c7)',
                  cursor: postMutation.isPending ? 'not-allowed' : 'pointer',
                  color: '#fff',
                  boxShadow: '0 1px 3px rgba(2, 132, 199, 0.25)',
                  transition: 'all 0.12s ease',
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
                  gap: 5,
                  padding: '7px 11px',
                  fontSize: 12.5,
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#dc2626',
                  transition: 'all 0.12s ease',
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
                padding: '7px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                color: '#1e293b',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'all 0.12s ease',
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
                gap: 5,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 500,
                border: '1px solid #fecaca',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                color: '#b91c1c',
                transition: 'all 0.12s ease',
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
              transition: 'all 0.12s ease',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 2. Top Tab Navigation Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '0 24px',
          borderBottom: '1px solid #eef0f3',
          background: '#ffffff',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          style={{
            padding: '11px 0',
            fontSize: 13,
            fontWeight: activeTab === 'overview' ? 600 : 500,
            color: activeTab === 'overview' ? 'var(--color-primary, #0284c7)' : '#64748b',
            borderBottom: `2px solid ${
              activeTab === 'overview' ? 'var(--color-primary, #0284c7)' : 'transparent'
            }`,
            background: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            borderTop: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.15s ease',
          }}
        >
          <FileText size={14} />
          <span>Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('units')}
          style={{
            padding: '11px 0',
            fontSize: 13,
            fontWeight: activeTab === 'units' ? 600 : 500,
            color: activeTab === 'units' ? 'var(--color-primary, #0284c7)' : '#64748b',
            borderBottom: `2px solid ${
              activeTab === 'units' ? 'var(--color-primary, #0284c7)' : 'transparent'
            }`,
            background: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            borderTop: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.15s ease',
          }}
        >
          <Boxes size={14} />
          <span>{unitLabel.plural || 'Packages & Units'}</span>
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 10,
              background: activeTab === 'units' ? '#e0f2fe' : '#f1f5f9',
              color: activeTab === 'units' ? '#0284c7' : '#64748b',
              fontWeight: 600,
            }}
          >
            {packageLinesCount > 0 ? packageLinesCount : issue.lines.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          style={{
            padding: '11px 0',
            fontSize: 13,
            fontWeight: activeTab === 'activity' ? 600 : 500,
            color: activeTab === 'activity' ? 'var(--color-primary, #0284c7)' : '#64748b',
            borderBottom: `2px solid ${
              activeTab === 'activity' ? 'var(--color-primary, #0284c7)' : 'transparent'
            }`,
            background: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            borderTop: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.15s ease',
          }}
        >
          <History size={14} />
          <span>Activity & Audit</span>
        </button>
      </div>

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

      {/* 3. Main Scrollable Content Area */}
      <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            {/* Delivery Route & Transit Progress Flow */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '16px 20px',
                marginBottom: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Truck size={14} color="#0284c7" />
                  <span>Delivery Route & Transit Progress</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: status.color,
                    background: status.bg,
                    padding: '2px 8px',
                    borderRadius: 10,
                  }}
                >
                  {issue.status === 'issued' ? 'Goods Dispatched' : status.label}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(140px, 1fr) auto minmax(140px, 1fr) auto minmax(140px, 1fr)',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {/* Stage 1: Origin Source Godown */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Warehouse size={14} color="#0284c7" />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: '#0369a1',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      Origin Godown
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={issue.sourceLocation?.name ?? 'Internal Warehouse'}
                  >
                    {issue.sourceLocation?.name ?? 'Internal Warehouse'}
                  </div>
                </div>

                {/* Direction Connector 1 */}
                <div style={{ display: 'flex', alignItems: 'center', color: '#0284c7' }}>
                  <ArrowRight size={16} />
                </div>

                {/* Stage 2: Transit Status */}
                <div
                  style={{
                    background: issue.status === 'issued' ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${issue.status === 'issued' ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: 6,
                    padding: '12px 14px',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <Truck size={14} color={issue.status === 'issued' ? '#16a34a' : '#64748b'} />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: issue.status === 'issued' ? '#15803d' : '#475569',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      Transit State
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
                    {issue.status === 'issued'
                      ? 'Dispatched / In-Transit'
                      : 'Draft / Staged at Godown'}
                  </div>
                </div>

                {/* Direction Connector 2 */}
                <div style={{ display: 'flex', alignItems: 'center', color: '#0284c7' }}>
                  <ArrowRight size={16} />
                </div>

                {/* Stage 3: Destination Processor */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {issue.processorType === 'internal' ? (
                      <Warehouse size={14} color="#0284c7" />
                    ) : (
                      <Building2 size={14} color="#7c3aed" />
                    )}
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: issue.processorType === 'internal' ? '#0369a1' : '#6d28d9',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {issue.processorType === 'internal'
                        ? 'In-house Work Centre'
                        : 'Vendor Processor'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={
                      issue.processorNameSnapshot ?? issue.destination?.name ?? 'Processor Location'
                    }
                  >
                    {issue.processorNameSnapshot ?? issue.destination?.name ?? 'Processor Location'}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Context Metric Tiles */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 20,
              }}
            >
              {/* Job Order */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  <ClipboardList size={13} color="#0284c7" />
                  <span>Job Order</span>
                </div>
                <div style={{ marginTop: 6 }}>
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
                      fontSize: 13.5,
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

              {/* Process Step */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  <Layers size={13} color="#7c3aed" />
                  <span>Process Step</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b', marginTop: 6 }}>
                  {issue.step ? `Step ${issue.step.seq}: ${issue.step.processNameSnapshot}` : '-'}
                </div>
              </div>

              {/* Total Dispatched */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  <Package size={13} color="#059669" />
                  <span>Total Dispatched</span>
                </div>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 700,
                    color: '#0f172a',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 6,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                  }}
                >
                  <span>{formatQty(issue.totalQty)}</span>
                  {unit && (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f1f5f9',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {unit}
                    </span>
                  )}
                </div>
              </div>

              {/* Issue Date */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  <Calendar size={13} color="#d97706" />
                  <span>Issue Date</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: '#334155', marginTop: 6 }}>
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
                  flexWrap: 'wrap',
                  gap: 8,
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
                <div
                  style={{
                    fontSize: 12,
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {issuedByItem.map((item) => (
                    <span
                      key={item.name}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <span>{item.name}:</span>
                      <strong style={{ color: '#0f172a' }}>{formatQty(item.qty)}</strong>
                      {item.unit && (
                        <span
                          style={{
                            fontSize: 11,
                            background: '#e2e8f0',
                            color: '#475569',
                            padding: '1px 5px',
                            borderRadius: 3,
                            fontWeight: 600,
                          }}
                        >
                          {item.unit}
                        </span>
                      )}
                    </span>
                  ))}
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
                        Item Details
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
                        {trackingLabel.singular} Reference
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
                          borderBottom:
                            idx === issue.lines.length - 1 ? 'none' : '1px solid #f1f5f9',
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{line.item?.name ?? '-'}</span>
                            {line.item?.sku && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: '#64748b',
                                  background: '#f1f5f9',
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  fontWeight: 500,
                                }}
                              >
                                SKU: {line.item.sku}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 13, color: '#475569' }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
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
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                                Unspecified / FIFO
                              </span>
                            )}
                            {line.batchUnit && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 6px',
                                  background: '#eff6ff',
                                  border: '1px solid #bfdbfe',
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: '#0284c7',
                                }}
                              >
                                Unit: {line.batchUnit.label ?? `#${line.batchUnit.seq}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: '10px 14px',
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#0f172a',
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>{formatQty(line.qty)}</span>
                          {(line.uom?.symbol ?? line.uom?.unitName ?? unit) && (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: '#64748b',
                                background: '#f1f5f9',
                                padding: '1px 5px',
                                borderRadius: 4,
                                marginLeft: 6,
                              }}
                            >
                              {line.uom?.symbol ?? line.uom?.unitName ?? unit}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Summary Footer */}
                  <tfoot>
                    <tr
                      style={{
                        background: '#f8fafc',
                        borderTop: '2px solid #e2e8f0',
                        fontWeight: 600,
                        fontSize: 12.5,
                      }}
                    >
                      <td style={{ padding: '10px 14px', color: '#475569' }}>
                        Total ({issue.lines.length} {issue.lines.length === 1 ? 'line' : 'lines'})
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>—</td>
                      <td
                        style={{
                          padding: '10px 14px',
                          textAlign: 'right',
                          color: '#0f172a',
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <span>{formatQty(issue.totalQty)}</span>
                        {unit && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: '#64748b',
                              background: '#e2e8f0',
                              padding: '1px 5px',
                              borderRadius: 4,
                              marginLeft: 6,
                            }}
                          >
                            {unit}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
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
                  gap: 10,
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
                        marginBottom: 4,
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
                        marginBottom: 4,
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
          </>
        )}

        {/* TAB 2: PACKAGES & UNITS BREAKDOWN */}
        {activeTab === 'units' && (
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Boxes size={16} color="#0284c7" />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>
                  {unitLabel.plural || 'Packages & Units'} Allocation Breakdown
                </span>
              </div>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {issue.lines.length} recorded entries
              </span>
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
                      }}
                    >
                      {trackingLabel.singular} Reference
                    </th>
                    <th
                      style={{
                        padding: '10px 14px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                      }}
                    >
                      Package / Unit Label
                    </th>
                    <th
                      style={{
                        padding: '10px 14px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        textAlign: 'right',
                      }}
                    >
                      Quantity
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
                            }}
                          >
                            {line.batch.supplierBatchRef}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>Unspecified / FIFO</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>
                        {line.batchUnit ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#0284c7',
                            }}
                          >
                            {line.batchUnit.label ?? `Unit #${line.batchUnit.seq}`}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>Bulk Batch Pool</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: '10px 14px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#0f172a',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <span>{formatQty(line.qty)}</span>
                        {(line.uom?.symbol ?? line.uom?.unitName ?? unit) && (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: '#64748b',
                              background: '#f1f5f9',
                              padding: '1px 5px',
                              borderRadius: 4,
                              marginLeft: 6,
                            }}
                          >
                            {line.uom?.symbol ?? line.uom?.unitName ?? unit}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: ACTIVITY & AUDIT */}
        {activeTab === 'activity' && (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '20px',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#0f172a',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <History size={16} color="#0284c7" />
              <span>Challan Lifecycle & Audit History</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Event 1: Creation */}
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 6,
                  background: '#f8fafc',
                  border: '1px solid #eef0f3',
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Clock size={14} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                    Challan Draft Created
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    Created on {formatDate(issue.createdAt)}
                  </div>
                </div>
              </div>

              {/* Event 2: Issue / Dispatch (if issued) */}
              {issue.status === 'issued' && (
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 6,
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: '#dcfce7',
                      color: '#16a34a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircle2 size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#14532d' }}>
                      Material Formally Issued & Dispatched
                    </div>
                    <div style={{ fontSize: 12, color: '#166534', marginTop: 2 }}>
                      Effective Issue Date: {formatDate(issue.issueDate)} · Inventory deducted from{' '}
                      <strong>{issue.sourceLocation?.name ?? 'Godown'}</strong> via Stock Ledger.
                    </div>
                  </div>
                </div>
              )}

              {/* Event 3: Cancellation (if cancelled) */}
              {issue.status === 'cancelled' && (
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 6,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: '#fee2e2',
                      color: '#dc2626',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CircleSlash size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>
                      Challan Cancelled & Stock Returned
                    </div>
                    <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>
                      {issue.remarks || 'Stock reversed to source godown.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
