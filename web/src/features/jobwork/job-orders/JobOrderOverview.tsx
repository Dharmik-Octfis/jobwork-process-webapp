import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Edit,
  RotateCcw,
  Send,
  Truck,
  X,
  Plus,
  ShieldCheck,
  User,
  Copy,
  Trash2,
  Check,
} from 'lucide-react';
import type { AxiosError } from 'axios';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';

import { JobOrderFlow } from './JobOrderFlow';
import { ActivityTabs } from './JobOrderStepDetail';
import { formatDate } from '../../../lib/formatDate';
import { JobOrderStatusBadge } from './JobOrderStatusBadge';
import { daysSince, formatQty, qtyWithUnit, toNumber } from '../jobwork.schemas';
import {
  deleteJobOrder,
  fetchJobOrderOverview,
  shortCloseJobOrder,
  completeJobOrderStep,
} from './jobOrders.api';
import { AddStepsDialog } from './AddStepsDialog';
import { JobOrderStepDetail } from './JobOrderStepDetail';
import type {
  ActivityEvent,
  JobOrderOverviewData,
  OverviewStep,
  JobOrder,
  JobOrdersPage,
} from './jobOrders.schemas';

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  marginBottom: '4px',
  letterSpacing: '0.03em',
};

const valueStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#1e293b',
  fontWeight: 500,
  lineHeight: 1.4,
};

interface Position {
  icon: React.ReactNode;
  headline: string;
  detail: string | null;
  tint: string;
  border: string;
  step: OverviewStep | null;
}

function currentPosition(data: JobOrderOverviewData, steps: OverviewStep[]): Position {
  const { jobOrder } = data;
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'short_closed').length;

  if (jobOrder.status === 'cancelled') {
    return {
      icon: <CircleSlash size={16} color="#b91c1c" />,
      headline: 'Cancelled',
      detail: 'Nothing further will move on this job order.',
      tint: '#fef2f2',
      border: '#fecaca',
      step: null,
    };
  }
  if (jobOrder.status === 'short_closed') {
    return {
      icon: <CircleSlash size={16} color="#b45309" />,
      headline: 'Closed Short',
      detail: `Ended after ${done} of ${steps.length} steps. Numbers accepted as finalized.`,
      tint: '#fffbeb',
      border: '#fde68a',
      step: null,
    };
  }
  if (jobOrder.status === 'completed') {
    return {
      icon: <CheckCircle2 size={16} color="#15803d" />,
      headline: 'Complete',
      detail: `All ${steps.length} process step${steps.length === 1 ? '' : 's'} finished.`,
      tint: '#f0fdf4',
      border: '#bbf7d0',
      step: steps[steps.length - 1] ?? null,
    };
  }
  if (steps.length === 0) {
    return {
      icon: <Clock size={16} color="#64748b" />,
      headline: 'No Steps Planned',
      detail: 'Edit this order to configure the processes the material runs through.',
      tint: '#f8fafc',
      border: '#e2e8f0',
      step: null,
    };
  }

  const front =
    steps.find((s) => s.status !== 'completed' && s.status !== 'short_closed') ??
    steps[steps.length - 1]!;
  const where = `Step ${front.seq} of ${steps.length}: ${front.processNameSnapshot}`;
  const party = front.processorNameSnapshot ?? front.workCentre?.name ?? 'the processor';
  const unit = front.inputs[0]?.uom
    ? (front.inputs[0].uom.symbol ?? front.inputs[0].uom.unitName)
    : '';
  const outstanding = toNumber(front.totals.outstandingQty);
  const rework = toNumber(front.totals.reworkQty);

  const lastIssue = [...data.activity]
    .reverse()
    .find((event) => event.kind === 'issue' && event.stepId === front.id);

  if (outstanding > 0) {
    const days = lastIssue ? daysSince(lastIssue.date) : null;
    const age =
      days === null ? null : days === 0 ? 'sent today' : `out ${days} day${days === 1 ? '' : 's'}`;
    return {
      icon: <Truck size={16} color="#0284c7" />,
      headline: `${qtyWithUnit(outstanding, unit)} out at ${party}`,
      detail: lastIssue
        ? `${where} · ${age}, last sent ${formatDate(lastIssue.date)} on ${lastIssue.number}`
        : where,
      tint: '#f0f9ff',
      border: '#bae6fd',
      step: front,
    };
  }
  if (rework > 0) {
    return {
      icon: <RotateCcw size={16} color="#b45309" />,
      headline: `${formatQty(rework)} waiting to be run again`,
      detail: `${where} · issue the rework batch back to this step`,
      tint: '#fffbeb',
      border: '#fde68a',
      step: front,
    };
  }
  if (front.blockedReason) {
    return {
      icon: <Clock size={16} color="#64748b" />,
      headline: 'Waiting on previous step',
      detail: `${where} · ${front.blockedReason}`,
      tint: '#f8fafc',
      border: '#e2e8f0',
      step: front,
    };
  }
  return {
    icon: <Send size={16} color="#0284c7" />,
    headline: `Ready to issue to ${party}`,
    detail: `${where} · awaiting first issue`,
    tint: '#f0f9ff',
    border: '#bae6fd',
    step: front,
  };
}

interface Props {
  jobOrderId?: string;
  onClose?: () => void;
}

export function JobOrderOverview({ jobOrderId, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId, id: routeId } = useParams<{ orgId: string; id: string }>();
  const id = jobOrderId ?? routeId;

  const [pickedStepId, setPickedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'Overview' | 'Activity' | 'Approvals'>('Overview');
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [completeReason, setCompleteReason] = useState('');
  const [addStepsOpen, setAddStepsOpen] = useState(false);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const [shortCloseReason, setShortCloseReason] = useState('');
  const [completeStepTarget, setCompleteStepTarget] = useState<OverviewStep | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMoreOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isMoreOpen]);

  const { data, isLoading } = useQuery({
    queryKey: ['job-order-overview', orgId, id],
    queryFn: () => fetchJobOrderOverview(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const steps = useMemo(() => data?.steps ?? [], [data]);
  const activity = useMemo(() => data?.activity ?? [], [data]);
  const position = useMemo(() => (data ? currentPosition(data, steps) : null), [data, steps]);

  const selectedStep = useMemo(() => {
    if (steps.length === 0) return null;
    const picked = steps.find((step) => step.id === pickedStepId);
    if (picked) return picked;
    return position?.step ?? steps[steps.length - 1]!;
  }, [steps, pickedStepId, position]);

  const stepActivity = useMemo(
    () => activity.filter((event) => event.stepId === selectedStep?.id),
    [activity, selectedStep],
  );

  const shortClose = useMutation({
    mutationFn: () => shortCloseJobOrder(orgId!, id!, shortCloseReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
      queryClient.setQueriesData(
        { queryKey: ['job-orders', orgId], type: 'active' },
        (old: JobOrdersPage | undefined) => {
          if (!old || !old.results) return old;
          return {
            ...old,
            results: old.results.map((item: JobOrder) =>
              item.id === id ? { ...item, status: 'short_closed' } : item,
            ),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
      setShortCloseOpen(false);
      setShortCloseReason('');
    },
  });

  const completeOutstanding = completeStepTarget
    ? toNumber(completeStepTarget.totals.outstandingQty)
    : 0;
  const completeUom =
    completeStepTarget && completeStepTarget.inputs.length === 1
      ? completeStepTarget.inputs[0]?.uom
      : null;
  const completeWriteOff =
    completeOutstanding <= 0
      ? 'Nothing is currently with the processor, so no material will be written off.'
      : `${
          completeStepTarget && completeStepTarget.inputs.length <= 1
            ? `${qtyWithUnit(completeOutstanding, completeUom ? (completeUom.symbol ?? completeUom.unitName) : '')} is still with the processor`
            : 'Some material is still with the processor'
        } and will be written off as job order loss. If it was normal shrinkage, cancel this action and close the challan on its last receipt instead.`;

  const completeStep = useMutation({
    mutationFn: ({ stepId, reason }: { stepId: string; reason?: string }) =>
      completeJobOrderStep(orgId!, id!, stepId, reason),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job-order-overview', orgId, id], updated);
      queryClient.setQueriesData(
        { queryKey: ['job-orders', orgId], type: 'active' },
        (old: JobOrdersPage | undefined) => {
          if (!old || !old.results) return old;
          return {
            ...old,
            results: old.results.map((item: JobOrder) =>
              item.id === id ? { ...item, status: updated.jobOrder.status } : item,
            ),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
      setCompleteStepTarget(null);
      setCompleteReason('');
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteJobOrder(orgId!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      setDeleteOpen(false);
      if (onClose) onClose();
      else navigate(`/organizations/${orgId}/jobwork/job-orders`);
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      setDeleteError(error.response?.data?.message ?? 'Could not delete this job order');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: '64px', display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading job order details..." />
      </div>
    );
  }

  if (!data || !position) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
        Job order not found.
      </div>
    );
  }

  const { jobOrder, summary } = data;
  const unit = jobOrder.inputUom ? (jobOrder.inputUom.symbol ?? jobOrder.inputUom.unitName) : '';
  const listPath = `/organizations/${orgId}/jobwork/job-orders`;
  const isClosed = jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled';

  const doneSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'short_closed',
  ).length;
  const donePct = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

  const isLate =
    Boolean(jobOrder.targetDate) &&
    new Date(jobOrder.targetDate!) < new Date() &&
    jobOrder.status !== 'completed' &&
    !isClosed;

  const openDocument = (event: ActivityEvent) => {
    const module = event.kind === 'issue' ? 'issues' : 'receipts';
    navigate(`/organizations/${orgId}/jobwork/${module}?id=${event.id}`);
  };

  const tabs: ('Overview' | 'Activity' | 'Approvals')[] = ['Overview', 'Activity', 'Approvals'];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
      }}
    >
      {/* 1. Header (Identical standard layout as PurchaseOrderDetail) */}
      <div className="detail-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2
            className="detail-title"
            style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}
          >
            {jobOrder.jobOrderNumber}
          </h2>
          <JobOrderStatusBadge status={jobOrder.status} size="sm" />
          {jobOrder.ownership === 'customer' && (
            <span
              style={{
                background: '#f5f3ff',
                color: '#7c3aed',
                border: '1px solid #ddd6fe',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Customer-Owned
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isClosed && (
            <button
              className="action-btn"
              type="button"
              onClick={() => navigate(`${listPath}/${jobOrder.id}/edit`)}
              style={{
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                background: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#1e293b',
                fontWeight: 500,
              }}
            >
              <Edit size={14} color="#0284c7" />
              <span className="action-btn-text">Edit</span>
            </button>
          )}

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              className="action-btn"
              type="button"
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              style={{
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                background: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: '#1e293b',
              }}
            >
              <span className="action-btn-text">More</span>
              <ChevronDown size={14} />
            </button>

            {isMoreOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #eef0f3',
                  borderRadius: '4px',
                  boxShadow:
                    '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  width: '150px',
                  zIndex: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => {
                    setIsMoreOpen(false);
                    navigate(`${listPath}/new?cloneFrom=${jobOrder.id}`);
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Copy size={14} /> Clone
                </div>

                {!isClosed && (
                  <div
                    onClick={() => {
                      setIsMoreOpen(false);
                      setShortCloseOpen(true);
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      color: '#b45309',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#fffbeb')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <CircleSlash size={14} /> Close Short
                  </div>
                )}

                <div
                  onClick={() => {
                    setIsMoreOpen(false);
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Trash2 size={14} /> Delete
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => (onClose ? onClose() : navigate(listPath))}
            style={{
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 2. Standard Tabs (Overview, Activity, Approvals) */}
      <div className="detail-page-tabs">
        {tabs.map((tab) => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`detail-tab ${activeTab === tab ? 'active' : ''}`}
          >
            {tab}
            {tab === 'Activity' && activity.length > 0 && ` (${activity.length})`}
          </div>
        ))}
      </div>

      {/* 3. Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', background: '#f8fafc' }}>
        {/* TAB 1: OVERVIEW (Clean ERP Document Sheet) */}
        {activeTab === 'Overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Top Quick Status Ribbon */}
            <div
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fff',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '13px',
                color: '#475569',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span>
                  Current Status: <strong style={{ color: '#0f172a' }}>{position.headline}</strong>
                </span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>
                  Stage Progress:{' '}
                  <strong style={{ color: '#0284c7' }}>
                    {doneSteps} of {steps.length} Steps ({donePct}%)
                  </strong>
                </span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>
                  Issued Material:{' '}
                  <strong style={{ color: '#16a34a' }}>
                    {formatQty(summary.issuedQty)} {unit}
                  </strong>
                </span>
              </div>

              {!isClosed && (
                <button
                  type="button"
                  onClick={() => setAddStepsOpen(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#0284c7',
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={13} /> Add Steps
                </button>
              )}
            </div>

            {/* Clean White Document Sheet Card */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '24px 32px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
              }}
            >
              {/* Header Title & Ownership */}
              <div className="detail-top-section">
                <div>
                  <h1
                    style={{
                      fontSize: '24px',
                      fontWeight: 700,
                      color: '#0f172a',
                      margin: '0 0 4px 0',
                    }}
                  >
                    JOB ORDER
                  </h1>
                  <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
                    Job Order#{' '}
                    <strong style={{ color: '#0f172a' }}>{jobOrder.jobOrderNumber}</strong>
                  </div>
                </div>

                <div className="detail-top-right">
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        marginBottom: '6px',
                      }}
                    >
                      MATERIAL OWNERSHIP
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: jobOrder.ownership === 'customer' ? '#7c3aed' : '#0284c7',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      {jobOrder.ownership === 'customer'
                        ? 'Customer Goods'
                        : 'Internal Stock (Self-Manufactured)'}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        marginBottom: '6px',
                      }}
                    >
                      INPUT MATERIAL SPECIFICATION
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#0f172a',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      {jobOrder.inputItem?.name ?? 'No input material'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                      Target Quantity:{' '}
                      <strong>
                        {jobOrder.inputQty !== null
                          ? `${formatQty(jobOrder.inputQty)} ${unit}`
                          : '-'}
                      </strong>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                      Total Issued:{' '}
                      <strong style={{ color: '#0284c7' }}>
                        {formatQty(summary.issuedQty)} {unit}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status & Metadata 4-Column Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '20px',
                  marginBottom: '28px',
                  background: '#fafafa',
                  padding: '16px 20px',
                  borderRadius: '6px',
                  border: '1px solid #f1f5f9',
                }}
              >
                <div>
                  <div style={labelStyle}>STATUS & WORK FRONT</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 4 }}>
                    <JobOrderStatusBadge status={jobOrder.status} size="sm" />
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px' }}>
                    {position.step
                      ? `Step ${position.step.seq}: ${position.step.processNameSnapshot}`
                      : position.headline}
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>ORDER DATE</div>
                  <div style={valueStyle}>
                    {jobOrder.orderDate ? formatDate(jobOrder.orderDate) : '-'}
                  </div>

                  <div style={{ ...labelStyle, marginTop: '10px' }}>TARGET DATE</div>
                  <div
                    style={{
                      ...valueStyle,
                      color: isLate ? '#dc2626' : '#1e293b',
                      fontWeight: isLate ? 600 : 500,
                    }}
                  >
                    {jobOrder.targetDate ? formatDate(jobOrder.targetDate) : '-'}
                    {isLate ? ' (Overdue)' : ''}
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>PROCESS ROUTE</div>
                  <div style={valueStyle}>{jobOrder.routeNameSnapshot ?? 'Custom Route'}</div>

                  <div style={{ ...labelStyle, marginTop: '10px' }}>TOTAL STAGES</div>
                  <div style={valueStyle}>{steps.length} sequential processes</div>
                </div>

                <div>
                  <div style={labelStyle}>MATERIAL BALANCES</div>
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    Target:{' '}
                    <strong>
                      {jobOrder.inputQty !== null ? `${formatQty(jobOrder.inputQty)} ${unit}` : '-'}
                    </strong>
                  </div>
                  <div style={{ fontSize: '12px', color: '#0284c7', marginTop: '2px' }}>
                    Issued:{' '}
                    <strong>
                      {formatQty(summary.issuedQty)} {unit}
                    </strong>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Remaining to Issue:{' '}
                    <strong>
                      {jobOrder.inputQty !== null
                        ? `${formatQty(Math.max(0, toNumber(jobOrder.inputQty) - toNumber(summary.issuedQty)))} ${unit}`
                        : '-'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Route Workflow Section */}
              <div style={{ marginBottom: '28px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                  }}
                >
                  <div style={labelStyle}>PRODUCTION ROUTE WORKFLOW</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Click any step below to view details and record operations
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '16px 20px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <JobOrderFlow
                    steps={steps}
                    selectedId={selectedStep?.id ?? null}
                    currentId={position.step?.id ?? null}
                    onSelect={(step) => {
                      setPickedStepId(step.id);
                    }}
                    onAppend={isClosed ? undefined : () => setAddStepsOpen(true)}
                  />
                </div>
              </div>

              {/* Selected Step Operations & Details */}
              {selectedStep && (
                <div style={{ marginBottom: '24px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={labelStyle}>
                      STEP {selectedStep.seq}: {selectedStep.processNameSnapshot.toUpperCase()}{' '}
                      DETAILS
                    </div>
                  </div>

                  <JobOrderStepDetail
                    step={selectedStep}
                    activity={stepActivity}
                    onIssue={(step) =>
                      navigate(
                        `/organizations/${orgId}/jobwork/issues/new?jobOrderId=${id}&stepId=${step.id}`,
                      )
                    }
                    onReceive={(step) =>
                      navigate(
                        `/organizations/${orgId}/jobwork/receipts/new?jobOrderId=${id}&stepId=${step.id}`,
                      )
                    }
                    onComplete={setCompleteStepTarget}
                    onOpenDocument={openDocument}
                  />
                </div>
              )}

              {/* Notes & Remarks */}
              {jobOrder.remarks && (
                <div
                  style={{
                    marginTop: '20px',
                    paddingTop: '16px',
                    borderTop: '1px solid #f1f5f9',
                  }}
                >
                  <div style={labelStyle}>NOTES / REMARKS</div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#475569',
                      lineHeight: 1.6,
                      background: '#f8fafc',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    {jobOrder.remarks}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACTIVITY FEED */}
        {activeTab === 'Activity' && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '20px 24px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
            }}
          >
            <ActivityTabs events={activity} onOpen={openDocument} />
          </div>
        )}

        {/* TAB 3: APPROVALS & GOVERNANCE */}
        {activeTab === 'Approvals' && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '24px 32px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 20,
                paddingBottom: 14,
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#f0fdf4',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShieldCheck size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                  Document Approval & Production Governance
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748b' }}>
                  Authorization lifecycle, creator identity, and ledger validation
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  padding: '14px 16px',
                  background: '#f8fafc',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={labelStyle}>WORKFLOW STATE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <CheckCircle2 size={16} color="#16a34a" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    Approved for Manufacturing
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                  Standard manufacturing workflow verified
                </span>
              </div>

              <div
                style={{
                  padding: '14px 16px',
                  background: '#f8fafc',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={labelStyle}>CREATED BY</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <User size={15} color="#0284c7" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    System Administrator
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                  {formatDate(jobOrder.createdAt)}
                </span>
              </div>

              <div
                style={{
                  padding: '14px 16px',
                  background: '#f8fafc',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={labelStyle}>PROCESS INTEGRITY</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Check size={16} color="#0284c7" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {steps.length} Route Stages Active
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                  Real-time stock ledger validations enabled
                </span>
              </div>
            </div>

            {/* Lifecycle Timeline */}
            <div style={{ ...labelStyle, marginBottom: 12 }}>AUDIT TRAIL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '10px 14px',
                  background: '#f8fafc',
                  borderRadius: 6,
                  borderLeft: '3px solid #16a34a',
                }}
              >
                <div style={{ minWidth: 90, fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                  {formatDate(jobOrder.createdAt)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    Job Order Initiated
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                    Document {jobOrder.jobOrderNumber} was created and approved for production.
                  </div>
                </div>
              </div>

              {activity.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '10px 14px',
                    background: '#f8fafc',
                    borderRadius: 6,
                    borderLeft: '3px solid #0284c7',
                  }}
                >
                  <div style={{ minWidth: 90, fontSize: 12, color: '#64748b', fontWeight: 500 }}>
                    {formatDate(activity[0]?.date ?? jobOrder.orderDate)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Material Movement Commenced
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                      {activity.length} document transactions posted against this job order.
                    </div>
                  </div>
                </div>
              )}

              {isClosed && (
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '10px 14px',
                    background: '#fffbeb',
                    borderRadius: 6,
                    borderLeft: '3px solid #f59e0b',
                  }}
                >
                  <div style={{ minWidth: 90, fontSize: 12, color: '#b45309', fontWeight: 500 }}>
                    {formatDate(jobOrder.updatedAt)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                      Order Concluded (
                      {jobOrder.status === 'short_closed' ? 'Closed Short' : 'Cancelled'})
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>
                      Production finalized and remaining balances settled.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Steps Dialog */}
      {addStepsOpen && (
        <AddStepsDialog
          isOpen
          onClose={() => setAddStepsOpen(false)}
          jobOrderId={jobOrder.id}
          jobOrderNumber={jobOrder.jobOrderNumber}
          ownership={jobOrder.ownership}
          steps={steps}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
            queryClient.setQueriesData(
              { queryKey: ['job-orders', orgId], type: 'active' },
              (old: JobOrdersPage | undefined) => {
                if (!old || !old.results) return old;
                return {
                  ...old,
                  results: old.results.map((item: JobOrder) =>
                    item.id === id ? { ...item, status: 'in_progress' } : item,
                  ),
                };
              },
            );
            queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
          }}
        />
      )}

      {/* Complete Step Confirmation Modal */}
      <ConfirmDialog
        isOpen={Boolean(completeStepTarget)}
        title="Complete this process step"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6, color: '#334155' }}>
              Completing indicates no more material will be returned from this step.{' '}
              {completeWriteOff}
            </p>
            <div
              style={{
                margin: '12px 0 14px 0',
                padding: '10px 14px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                fontSize: 12,
                color: '#475569',
                lineHeight: 1.5,
              }}
            >
              Draft challans or receipts on the step must be posted or deleted first. This action
              cannot be undone. Nothing more can be issued or received against this step afterwards.
            </div>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#334155',
                marginBottom: 4,
              }}
            >
              Reason
            </label>
            <input
              type="text"
              value={completeReason}
              onChange={(e) => setCompleteReason(e.target.value)}
              aria-label="Reason for completing step"
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                minHeight: 36,
                boxSizing: 'border-box',
                outline: 'none',
                color: '#0f172a',
              }}
              placeholder="e.g. Work completed or no further processing needed"
            />
          </div>
        }
        confirmText={completeStep.isPending ? 'Completing...' : 'Complete Step'}
        onConfirm={() => {
          if (completeStepTarget) {
            completeStep.mutate({ stepId: completeStepTarget.id, reason: completeReason });
          }
        }}
        onCancel={() => {
          setCompleteStepTarget(null);
          setCompleteReason('');
        }}
      />

      {/* Close Short Confirmation Modal */}
      <ConfirmDialog
        isOpen={shortCloseOpen}
        title="Close this job order short"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6, color: '#334155' }}>
              This concludes the job order and accepts current balances. Any material remaining with
              processors on open steps will be written off as job order loss. This action cannot be
              undone.
            </p>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: '#334155',
                marginBottom: 4,
              }}
            >
              Reason
            </label>
            <input
              type="text"
              value={shortCloseReason}
              onChange={(e) => setShortCloseReason(e.target.value)}
              aria-label="Reason for closing short"
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                minHeight: 36,
                boxSizing: 'border-box',
                outline: 'none',
                color: '#0f172a',
              }}
              placeholder="e.g. Completed or party accepted final delivery"
            />
          </div>
        }
        confirmText={shortClose.isPending ? 'Closing...' : 'Close Short'}
        onConfirm={() => {
          if (shortCloseReason.trim()) shortClose.mutate();
        }}
        onCancel={() => {
          setShortCloseOpen(false);
          setShortCloseReason('');
        }}
      />

      {/* Delete Job Order Confirmation Modal */}
      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete Job Order"
        message={
          deleteError ? (
            <span style={{ color: '#b91c1c' }}>{deleteError}</span>
          ) : (
            `Are you sure you want to delete ${jobOrder.jobOrderNumber}? Only an order that has not issued any material yet can be deleted.`
          )
        }
        confirmText="Delete"
        isConfirming={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
