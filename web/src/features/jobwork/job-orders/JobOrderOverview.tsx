import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Pencil,
  RotateCcw,
  Send,
  Truck,
  X,
} from 'lucide-react';
import type { AxiosError } from 'axios';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { formatDate } from '../../../lib/formatDate';
import { IssueDialog } from '../issues/IssueDialog';
import { ReceiveDialog } from '../receipts/ReceiveDialog';
import {
  JOB_ORDER_STATUS_META,
  daysSince,
  formatQty,
  qtyWithUnit,
  statusMeta,
  stepCharge,
  toNumber,
} from '../jobwork.schemas';
import {
  deleteJobOrder,
  fetchJobOrderOverview,
  shortCloseJobOrder,
  completeJobOrderStep,
} from './jobOrders.api';
import { AddStepsDialog } from './AddStepsDialog';
import { ActivityTimeline } from './ActivityTimeline';
import { JobOrderFlow } from './JobOrderFlow';
import { JobOrderStepDetail } from './JobOrderStepDetail';
import type {
  ActivityEvent,
  JobOrderOverviewData,
  OverviewStep,
  JobOrder,
  JobOrdersPage,
} from './jobOrders.schemas';

const metaItem: React.CSSProperties = { fontSize: 12, color: '#64748b' };

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  margin: 0,
};

interface MenuAction {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The ▾ beside Edit — Clone / Close short / Delete.
 *
 * Plain buttons rather than `downshift` (CLAUDE.md: native first), but keyboard
 * complete all the same: the trigger opens on ↓/Enter/Space, ↑↓ move between the
 * rows with focus following, Enter runs one, Esc closes and hands focus back. The
 * rows carry `tabIndex={-1}` because focus is driven here — only the trigger sits
 * in the page's tab order, which is what keeps Tab walking this header the same
 * way it walks every other one.
 */
function ActionsMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) itemRefs.current[activeIndex]?.focus();
  }, [isOpen, activeIndex]);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const open = (index: number) => {
    setActiveIndex(index);
    setIsOpen(true);
  };

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={label}
        title={label}
        onClick={() => (isOpen ? setIsOpen(false) : open(0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            open(0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            open(actions.length - 1);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 8px',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: '#fff',
          cursor: 'pointer',
          color: '#333',
        }}
      >
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % actions.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => (index - 1 + actions.length) % actions.length);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'Tab') {
              // Closing mid-Tab would unmount the focused row and drop focus to
              // the body, restarting the walk at the top of the page. Park it on
              // the trigger instead; the next Tab carries on from there.
              event.preventDefault();
              close();
            }
          }}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 180,
            padding: '4px 0',
            background: '#fff',
            border: '1px solid #eef0f3',
            borderRadius: 6,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            zIndex: 20,
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                // Focus back on the trigger BEFORE the action runs: the row is
                // about to unmount, and an action that opens a dialog would
                // otherwise leave focus on the body with nothing to come back to.
                close();
                action.onSelect();
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                border: 'none',
                background:
                  index === activeIndex ? (action.danger ? '#fef2f2' : '#f8fafc') : '#fff',
                color: action.danger ? '#dc2626' : '#1e293b',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 400,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One number on the strip. */
function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
}) {
  return (
    <div style={{ minWidth: 92 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          display: 'block',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
        {value}
        {unit && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 3 }}>{unit}</span>}
      </span>
      {note && (
        <span style={{ display: 'block', fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * 🔴 WHERE THE ORDER IS, RIGHT NOW — one sentence, at the top, before any number.
 *
 * This is the question every person opening the page came to answer, and until
 * this existed they answered it by reading five tiles and a rail of six boxes and
 * inferring it. A derived sentence cannot disagree with the tiles beneath it: it
 * is built from the same steps and the same documents, in the same request.
 *
 * The FRONT is the first step not yet settled, which is where the material
 * physically is. A finished or abandoned order has no front and says so instead.
 */
interface Position {
  icon: React.ReactNode;
  headline: string;
  detail: string | null;
  tint: string;
  border: string;
  /** The step the sentence is about, so the page can open on it. */
  step: OverviewStep | null;
}

function currentPosition(data: JobOrderOverviewData, steps: OverviewStep[]): Position {
  const { jobOrder } = data;
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'short_closed').length;

  if (jobOrder.status === 'cancelled') {
    return {
      icon: <CircleSlash size={18} color="#b91c1c" />,
      headline: 'Cancelled',
      detail: 'Nothing further will move on this order.',
      tint: '#fef2f2',
      border: '#fecaca',
      step: null,
    };
  }
  if (jobOrder.status === 'short_closed') {
    return {
      icon: <CircleSlash size={18} color="#b45309" />,
      headline: 'Closed short',
      detail: `Ended after ${done} of ${steps.length} steps — the numbers were accepted as they stood.`,
      tint: '#fffbeb',
      border: '#fde68a',
      step: null,
    };
  }
  if (jobOrder.status === 'completed') {
    return {
      icon: <CheckCircle2 size={18} color="#15803d" />,
      headline: 'Complete',
      detail: `All ${steps.length} step${steps.length === 1 ? '' : 's'} finished.`,
      tint: '#f0fdf4',
      border: '#bbf7d0',
      step: steps[steps.length - 1] ?? null,
    };
  }
  if (steps.length === 0) {
    return {
      icon: <Clock size={18} color="#64748b" />,
      headline: 'No work planned yet',
      detail: 'Edit this order to add the steps the material runs through.',
      tint: '#f8fafc',
      border: '#e2e8f0',
      step: null,
    };
  }

  const front =
    steps.find((s) => s.status !== 'completed' && s.status !== 'short_closed') ??
    steps[steps.length - 1]!;
  const where = `Step ${front.seq} of ${steps.length} · ${front.processNameSnapshot}`;
  const party = front.processorNameSnapshot ?? front.workCentre?.name ?? 'the processor';
  const unit = front.inputs[0]?.uom
    ? (front.inputs[0].uom.symbol ?? front.inputs[0].uom.unitName)
    : '';
  const outstanding = toNumber(front.totals.outstandingQty);
  const rework = toNumber(front.totals.reworkQty);

  // When it went out, off the step's own last issue — "out since" is the fact
  // people chase a processor with, and it is not derivable from a total.
  const lastIssue = [...data.activity]
    .reverse()
    .find((event) => event.kind === 'issue' && event.stepId === front.id);

  if (outstanding > 0) {
    // 🔴 HOW LONG it has been out, not just when it went. "Sent on the 12th" is
    // a date somebody then has to subtract from today; "out 9 days" is the fact
    // they were going to work out anyway, and it is what a processor gets
    // chased on.
    const days = lastIssue ? daysSince(lastIssue.date) : null;
    const age =
      days === null ? null : days === 0 ? 'sent today' : `out ${days} day${days === 1 ? '' : 's'}`;
    return {
      icon: <Truck size={18} color="#1d4ed8" />,
      headline: `${qtyWithUnit(outstanding, unit)} out at ${party}`,
      detail: lastIssue
        ? `${where} · ${age}, last sent ${formatDate(lastIssue.date)} on ${lastIssue.number}`
        : where,
      tint: '#eff6ff',
      border: '#bfdbfe',
      step: front,
    };
  }
  if (rework > 0) {
    return {
      icon: <RotateCcw size={18} color="#b45309" />,
      headline: `${formatQty(rework)} waiting to be run again`,
      detail: `${where} · issue the rework batch back to this step`,
      tint: '#fffbeb',
      border: '#fde68a',
      step: front,
    };
  }
  if (front.blockedReason) {
    return {
      icon: <Clock size={18} color="#64748b" />,
      headline: 'Waiting on the step before it',
      detail: `${where} · ${front.blockedReason}`,
      tint: '#f8fafc',
      border: '#e2e8f0',
      step: front,
    };
  }
  return {
    icon: <Send size={18} color="#1d4ed8" />,
    headline: `Ready to issue to ${party}`,
    detail: `${where} · nothing has gone out yet`,
    tint: '#eff6ff',
    border: '#bfdbfe',
    step: front,
  };
}

/**
 * The Job Order Overview — the page the module exists for.
 *
 * 🔴 IT ANSWERS THREE QUESTIONS, IN THIS ORDER, AND NOTHING ELSE.
 *
 *   1. Where is this order right now?  → the state bar, one sentence.
 *   2. How far has it got?             → the rail, one box per step.
 *   3. What actually happened?         → the timeline, one row per document.
 *
 * Every number is DERIVED — from the ledger and the child documents, never from
 * stored totals, because a stored balance is a balance that can disagree with its
 * own history (§5.6) and this is the page people are meant to believe. It is one
 * request, so all of it describes the same moment; four fetches would render
 * four.
 *
 * 🔴 THE ROUTE IS THE PAGE. It reads as a rail of steps left to right, and only
 * the step you pick opens in full underneath. Every step expanded at once was the
 * shape before that: six screens of tables, no way to see where the material had
 * got to, and the one step needing action buried three scrolls down.
 */
interface Props {
  /**
   * Panel mode — the list page renders this beside its own rows, so the id comes
   * from the selection rather than the URL and the back arrow closes the panel
   * instead of navigating away. Omitted on the standalone `/job-orders/:id`
   * route, which keeps working exactly as before.
   */
  jobOrderId?: string;
  onClose?: () => void;
}

export function JobOrderOverview({ jobOrderId, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId, id: routeId } = useParams<{ orgId: string; id: string }>();
  const id = jobOrderId ?? routeId;

  const [issueStep, setIssueStep] = useState<OverviewStep | null>(null);
  const [receiveStep, setReceiveStep] = useState<OverviewStep | null>(null);
  const [pickedStepId, setPickedStepId] = useState<string | null>(null);
  const [view, setView] = useState<'step' | 'history'>('step');
  const [addStepsOpen, setAddStepsOpen] = useState(false);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const [shortCloseReason, setShortCloseReason] = useState('');
  const [completeStepTarget, setCompleteStepTarget] = useState<OverviewStep | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['job-order-overview', orgId, id],
    queryFn: () => fetchJobOrderOverview(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const steps = useMemo(() => data?.steps ?? [], [data]);
  const activity = useMemo(() => data?.activity ?? [], [data]);

  const position = useMemo(() => (data ? currentPosition(data, steps) : null), [data, steps]);

  /**
   * The step the order is actually sitting on — the one the state bar just named.
   * Opening on step 1 of a five-step order that finished it a week ago wastes the
   * click everybody makes next. A step the user picked always wins.
   */
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

  /** `stepId → "2 · Dyeing"`, for the whole-order timeline, which interleaves them. */
  const stepLabels = useMemo(
    () => new Map(steps.map((step) => [step.id, `${step.seq} · ${step.processNameSnapshot}`])),
    [steps],
  );

  const shortClose = useMutation({
    mutationFn: () => shortCloseJobOrder(orgId!, id!, shortCloseReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
      queryClient.setQueriesData({ queryKey: ['job-orders', orgId], type: 'active' }, (old: JobOrdersPage | undefined) => {
        if (!old || !old.results) return old;
        return {
          ...old,
          results: old.results.map((item: JobOrder) =>
            item.id === id ? { ...item, status: 'short_closed' } : item
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
      setShortCloseOpen(false);
      setShortCloseReason('');
    },
  });

  const completeStep = useMutation({
    mutationFn: (stepId: string) => completeJobOrderStep(orgId!, id!, stepId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job-order-overview', orgId, id], updated);
      queryClient.setQueriesData({ queryKey: ['job-orders', orgId], type: 'active' }, (old: JobOrdersPage | undefined) => {
        if (!old || !old.results) return old;
        return {
          ...old,
          results: old.results.map((item: JobOrder) =>
            item.id === id ? { ...item, status: updated.jobOrder.status } : item
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
      setCompleteStepTarget(null);
    },
  });

  /**
   * Only an order that has issued nothing can go (`deleteJobOrderById`) — past
   * that the ledger rows behind it have to stay, and the server says so in words.
   * The refusal is shown in the dialog rather than swallowed: a Delete that
   * quietly does nothing is the worse failure.
   */
  const remove = useMutation({
    mutationFn: () => deleteJobOrder(orgId!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      setDeleteOpen(false);
      // The panel is showing a row that no longer exists; the standalone page is
      // showing a document that no longer exists. Both leave.
      if (onClose) onClose();
      else navigate(`/organizations/${orgId}/jobwork/job-orders`);
    },
    onError: (error: AxiosError<{ message?: string }>) => {
      setDeleteError(error.response?.data?.message ?? 'Could not delete this job order');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading job order" />
      </div>
    );
  }

  if (!data || !position) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Job order not found.</div>;
  }

  const { jobOrder, summary } = data;
  const status = statusMeta(JOB_ORDER_STATUS_META, jobOrder.status);
  const unit = jobOrder.inputUom ? (jobOrder.inputUom.symbol ?? jobOrder.inputUom.unitName) : '';
  const listPath = `/organizations/${orgId}/jobwork/job-orders`;
  const isClosed = jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled';

  const doneSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'short_closed',
  ).length;
  const donePct = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

  /**
   * What the whole order costs to have made — the per-step charges added up.
   *
   * Money is the one figure on this page that CAN be summed across steps: every
   * step bills in the same currency, unlike the quantities, which are metres and
   * pieces and cones and must never be added (§6.5). `null` when no step has a
   * rate at all, which is different from a total of zero.
   */
  const charges = steps
    .map((step) =>
      stepCharge({
        rate: step.rate,
        rateBasis: step.rateBasis,
        issuedQty: step.totals.issuedQty,
        receivedQty: step.totals.receivedQty,
      }),
    )
    .filter((amount): amount is number => amount !== null);
  const totalCharge = charges.length > 0 ? charges.reduce((sum, n) => sum + n, 0) : null;

  // Late only while there is still work to do — a finished order is not overdue,
  // it is finished.
  const isLate =
    Boolean(jobOrder.targetDate) &&
    new Date(jobOrder.targetDate!) < new Date() &&
    jobOrder.status !== 'completed' &&
    !isClosed;

  /** A document is a real thing with its own page; reading its number and wanting
   * to open it is the same impulse. */
  const openDocument = (event: ActivityEvent) => {
    const module = event.kind === 'issue' ? 'issues' : 'receipts';
    navigate(`/organizations/${orgId}/jobwork/${module}?id=${event.id}`);
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #eef0f3', position: 'sticky', top: 0, zIndex: 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: '13px 24px 3px 24px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
                  {jobOrder.jobOrderNumber}
                </h1>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 500,
                    color: status.color,
                    background: status.bg,
                  }}
                >
                  {status.label}
                </span>
                {jobOrder.ownership === 'customer' && (
                  <span
                    style={{
                      padding: '2px 10px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 500,
                      color: '#7c3aed',
                      background: '#f5f3ff',
                    }}
                  >
                    Customer-owned
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 14, whiteSpace: 'nowrap', overflow: 'hidden', marginTop: 5 }}>
                <span style={metaItem}>
                  {jobOrder.inputItem?.name ?? 'No item yet'}
                  {jobOrder.inputQty !== null && ` · ${formatQty(jobOrder.inputQty)} ${unit}`}
                </span>
                {/* The frozen name, not a join — the route may have been renamed
                    or deleted since this order was raised. */}
                <span style={metaItem}>{jobOrder.routeNameSnapshot ?? 'No route'}</span>
                <span style={metaItem}>Raised {formatDate(jobOrder.orderDate)}</span>
                {jobOrder.targetDate && (
                  <span style={{ ...metaItem, color: isLate ? '#b91c1c' : '#64748b' }}>
                    Due {formatDate(jobOrder.targetDate)}
                    {isLate ? ' · overdue' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Offered on a running order too (§6.6): the steps past the work
                front are still a plan. Only a CLOSED order has nothing editable
                left, which is the same line `isClosed` already draws for Add
                work and Close short. */}
            {!isClosed && (
              <button
                type="button"
                onClick={() => navigate(`${listPath}/${jobOrder.id}/edit`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#333',
                }}
              >
                <Pencil size={14} /> Edit
              </button>
            )}
            {/* Clone and Delete apply to a closed order too — the first is the
                usual reason anyone opens a finished one, and the second is the
                server's call, not this page's. Close short is the exception: it
                is the one action a closed order has already had. */}
            <ActionsMenu
              label={`More actions for ${jobOrder.jobOrderNumber}`}
              actions={[
                {
                  key: 'clone',
                  label: 'Clone',
                  onSelect: () => navigate(`${listPath}/new?cloneFrom=${jobOrder.id}`),
                },
                ...(isClosed
                  ? []
                  : [
                      {
                        key: 'short-close',
                        label: 'Close short',
                        onSelect: () => setShortCloseOpen(true),
                      },
                    ]),
                {
                  key: 'delete',
                  label: 'Delete',
                  danger: true,
                  onSelect: () => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  },
                },
              ]}
            />

            <button
              type="button"
              onClick={() => (onClose ? onClose() : navigate(listPath))}
              aria-label={onClose ? 'Close job order' : 'Back to job orders'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                border: '1px solid #e2e8f0',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
                color: '#64748b',
                marginLeft: 8,
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

        {/* 🔴 THE ANSWER FIRST. The sentence on the left is what the page is for;
            the four numbers on the right are what somebody checks once they have
            read it. Putting the tiles above this was the old order, and it made
            every reader derive the sentence themselves. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            flexWrap: 'wrap',
            padding: '12px 24px',
            background: position.tint,
            borderTop: `1px solid ${position.border}`,
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 260 }}>
            <span style={{ marginTop: 1, flexShrink: 0 }}>{position.icon}</span>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111' }}>
                {position.headline}
              </p>
              {position.detail && (
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#475569' }}>
                  {position.detail}
                </p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <Tile label="Issued" value={formatQty(summary.issuedQty)} unit={unit} />
            <Tile
              label="In hand"
              value={formatQty(summary.inHandQty)}
              note={
                summary.costPerUnit === null ? null : `${formatQty(summary.costPerUnit)} per unit`
              }
            />
            <Tile
              label="Wastage"
              value={summary.wastagePct === null ? '—' : `${summary.wastagePct}%`}
              note="across closed steps"
            />
            <Tile
              label="Charges"
              value={totalCharge === null ? '—' : formatQty(totalCharge)}
              note={
                totalCharge === null
                  ? 'no rates agreed'
                  : `${charges.length} of ${steps.length} steps rated`
              }
            />
          </div>
        </div>

      <div style={{ padding: '18px 24px' }}>
        {/* 🔴 The scale and the position, ALWAYS visible. A twelve-step route
            scrolls, so on any given screenful the rail alone cannot say how many
            steps there are or which one you are looking at. This line can, and
            it costs one row. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={sectionLabel}>Route</h2>
          <div
            aria-hidden
            style={{
              width: 132,
              height: 4,
              borderRadius: 2,
              background: '#e6e9ee',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${donePct}%`, height: '100%', background: '#15803d' }} />
          </div>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {doneSteps} of {steps.length} step{steps.length === 1 ? '' : 's'} done
            {position.step && !isClosed && jobOrder.status !== 'completed' && (
              <span style={{ color: '#94a3b8' }}> · now at step {position.step.seq}</span>
            )}
          </span>
        </div>
        <JobOrderFlow
          steps={steps}
          selectedId={view === 'step' ? (selectedStep?.id ?? null) : null}
          currentId={position.step?.id ?? null}
          onSelect={(step) => {
            setPickedStepId(step.id);
            // Picking a step is a request to read that step — staying on the
            // whole-order timeline would make the click do nothing visible.
            setView('step');
          }}
          /* Offered whatever the steps are doing — appending renumbers nothing,
             so a step at a processor is no reason to withhold it. A closed order
             is: the server refuses those, and a button that only ever 409s is
             worse than no button. */
          onAppend={isClosed ? undefined : () => setAddStepsOpen(true)}
        />

        {steps.length > 0 && (
          <>
            <div
              style={{
                display: 'inline-flex',
                gap: 2,
                margin: '20px 0 10px 0',
                padding: 3,
                background: '#eef1f5',
                borderRadius: 999,
                maxWidth: '100%',
              }}
            >
              <ViewTab
                isActive={view === 'step'}
                onClick={() => setView('step')}
                label={
                  selectedStep
                    ? `Step ${selectedStep.seq} · ${selectedStep.processNameSnapshot}`
                    : 'Step'
                }
              />
              <ViewTab
                isActive={view === 'history'}
                onClick={() => setView('history')}
                label={`Full history (${activity.length})`}
              />
            </div>

            {view === 'step' && selectedStep && (
              <JobOrderStepDetail
                step={selectedStep}
                activity={stepActivity}
                onIssue={setIssueStep}
                onReceive={setReceiveStep}
                onComplete={setCompleteStepTarget}
                onOpenDocument={openDocument}
              />
            )}

            {view === 'history' && (
              <div
                style={{
                  border: '1px solid #eef0f3',
                  borderRadius: 10,
                  background: '#fff',
                  padding: '14px 16px',
                }}
              >
                {/* 🔴 Every step, in one column, oldest first. The per-step view
                    above answers "what is happening here"; this answers "what has
                    this order been through" — and the two orders of the same
                    documents are genuinely different readings. */}
                <ActivityTimeline
                  events={activity}
                  stepLabels={stepLabels}
                  onOpen={openDocument}
                  empty="Nothing has moved on this order yet. Issue material to the first step, and every challan and receipt across every step will be listed here in the order it happened."
                />
              </div>
            )}
          </>
        )}
      </div>

      {addStepsOpen && (
        <AddStepsDialog
          isOpen
          onClose={() => setAddStepsOpen(false)}
          jobOrderId={jobOrder.id}
          jobOrderNumber={jobOrder.jobOrderNumber}
          ownership={jobOrder.ownership}
          steps={steps}
          onAdded={() => {
            // The list too: appending to a completed order reopens it as
            // in_progress, and the row would otherwise keep saying "Completed".
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
            queryClient.setQueriesData({ queryKey: ['job-orders', orgId], type: 'active' }, (old: JobOrdersPage | undefined) => {
              if (!old || !old.results) return old;
              return {
                ...old,
                results: old.results.map((item: JobOrder) =>
                  item.id === id ? { ...item, status: 'in_progress' } : item
                ),
              };
            });
            queryClient.invalidateQueries({ queryKey: ['job-orders', orgId], type: 'inactive' });
          }}
        />
      )}

      {issueStep && (
        <IssueDialog
          isOpen
          onClose={() => setIssueStep(null)}
          jobOrder={jobOrder}
          step={steps.find((s) => s.id === issueStep.id) ?? issueStep}
          onIssued={() =>
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] })
          }
        />
      )}

      {receiveStep && (
        <ReceiveDialog
          isOpen
          onClose={() => setReceiveStep(null)}
          jobOrder={jobOrder}
          step={steps.find((s) => s.id === receiveStep.id) ?? receiveStep}
          onReceived={() =>
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] })
          }
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(completeStepTarget)}
        title="Complete this step"
        message="Are you sure you want to manually complete this step? You won't be able to undo this action."
        confirmText={completeStep.isPending ? 'Completing…' : 'Complete Step'}
        onConfirm={() => {
          if (completeStepTarget) completeStep.mutate(completeStepTarget.id);
        }}
        onCancel={() => setCompleteStepTarget(null)}
      />

      <ConfirmDialog
        isOpen={shortCloseOpen}
        title="Close this job order short"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
              This ends the order even though the numbers do not balance — which is a normal
              outcome, not an error. It cannot be reopened, and a later receipt will not undo it.
            </p>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
              Reason
            </label>
            <input
              type="text"
              value={shortCloseReason}
              onChange={(e) => setShortCloseReason(e.target.value)}
              aria-label="Reason for closing short"
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                minHeight: 32,
              }}
              placeholder="Finished 150 m light — party accepted"
            />
          </div>
        }
        confirmText={shortClose.isPending ? 'Closing…' : 'Close short'}
        onConfirm={() => {
          if (shortCloseReason.trim()) shortClose.mutate();
        }}
        onCancel={() => {
          setShortCloseOpen(false);
          setShortCloseReason('');
        }}
      />

      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete Job Order"
        message={
          deleteError ? (
            <span style={{ color: '#b91c1c' }}>{deleteError}</span>
          ) : (
            `Delete ${jobOrder.jobOrderNumber}? Only a job order that has not issued anything yet can be deleted.`
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

/**
 * One of the two readings of the same documents. Plain buttons with
 * `aria-pressed` rather than a tablist: nothing here is a tab panel that hides
 * content — both views render the same feed, filtered or not — and a real
 * `role="tablist"` would then owe arrow-key navigation for two controls Tab
 * already reaches in order.
 */
function ViewTab({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        padding: '5px 14px',
        fontSize: 12,
        fontWeight: isActive ? 600 : 500,
        color: isActive ? '#111' : '#64748b',
        background: isActive ? '#fff' : 'transparent',
        border: 'none',
        borderRadius: 999,
        boxShadow: isActive ? '0 1px 2px rgba(15,23,42,0.10)' : 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
