import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { IssueDialog } from '../issues/IssueDialog';
import { ReceiveDialog } from '../receipts/ReceiveDialog';
import { JOB_ORDER_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import { fetchJobOrderOverview, shortCloseJobOrder } from './jobOrders.api';
import { AddStepsDialog } from './AddStepsDialog';
import { JobOrderFlow } from './JobOrderFlow';
import { JobOrderStepDetail } from './JobOrderStepDetail';
import type { OverviewStep } from './jobOrders.schemas';

const metaItem: React.CSSProperties = { fontSize: 12, color: '#64748b' };

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  margin: '0 0 8px 0',
};

/** One number on the strip. */
function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ padding: '2px 18px 2px 0', minWidth: 120 }}>
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
      <span style={{ fontSize: 17, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
        {value}
        {unit && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

/**
 * The Job Order Overview — the page the module exists for.
 *
 * 🔴 EVERY NUMBER ON IT IS DERIVED. The tiles come from the ledger and the child
 * documents, not from stored totals, and that is deliberate rather than lazy: a
 * stored balance is a balance that can disagree with its own history (§5.6), and
 * this is the page people are meant to believe. It is one request, so all of it
 * describes the same moment — four separate fetches would render four.
 *
 * 🔴 THE ROUTE IS THE PAGE. It reads as a rail of steps left to right, and only
 * the step you pick opens in full underneath. Every step expanded at once was the
 * previous shape: six screens of tables, no way to see where the material had
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
  const [addStepsOpen, setAddStepsOpen] = useState(false);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const [shortCloseReason, setShortCloseReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['job-order-overview', orgId, id],
    queryFn: () => fetchJobOrderOverview(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

  const steps = useMemo(() => data?.steps ?? [], [data]);

  /**
   * The step the order is actually sitting on — the first one not yet settled.
   * Opening on step 1 of a five-step order that finished it a week ago wastes
   * the click everybody makes next. A step the user picked always wins.
   */
  const selectedStep = useMemo(() => {
    if (steps.length === 0) return null;
    const picked = steps.find((step) => step.id === pickedStepId);
    if (picked) return picked;
    return (
      steps.find((step) => step.status !== 'completed' && step.status !== 'short_closed') ??
      steps[steps.length - 1]
    );
  }, [steps, pickedStepId]);

  const shortClose = useMutation({
    mutationFn: () => shortCloseJobOrder(orgId!, id!, shortCloseReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
      queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
      setShortCloseOpen(false);
      setShortCloseReason('');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading job order" />
      </div>
    );
  }

  if (!data) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Job order not found.</div>;
  }

  const { jobOrder, summary, lots } = data;
  const status = statusMeta(JOB_ORDER_STATUS_META, jobOrder.status);
  const unit = jobOrder.inputUom ? (jobOrder.inputUom.symbol ?? jobOrder.inputUom.unitName) : '';
  const listPath = `/organizations/${orgId}/jobwork/job-orders`;
  const isClosed = jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled';

  const doneSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'short_closed',
  ).length;
  const donePct = steps.length > 0 ? Math.round((doneSteps / steps.length) * 100) : 0;

  // Late only while there is still work to do — a finished order is not overdue,
  // it is finished.
  const isLate =
    Boolean(jobOrder.targetDate) &&
    new Date(jobOrder.targetDate!) < new Date() &&
    jobOrder.status !== 'completed' &&
    !isClosed;

  return (
    <div style={{ background: '#f8fafc', minHeight: '100%' }}>
      <header
        style={{ background: '#fff', borderBottom: '1px solid #eef0f3', padding: '14px 24px' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
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
                marginTop: 2,
              }}
            >
              <ArrowLeft size={15} />
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 5 }}>
                <span style={metaItem}>{new Date(jobOrder.orderDate).toLocaleDateString()}</span>
                {jobOrder.targetDate && (
                  <span style={{ ...metaItem, color: isLate ? '#b91c1c' : '#64748b' }}>
                    Due {new Date(jobOrder.targetDate).toLocaleDateString()}
                    {isLate ? ' · overdue' : ''}
                  </span>
                )}
                <span style={metaItem}>
                  {jobOrder.inputItem?.name ?? 'No item yet'}
                  {jobOrder.inputQty !== null && ` · ${formatQty(jobOrder.inputQty)} ${unit}`}
                </span>
                {/* The frozen name, not a join — the route may have been renamed
                    or deleted since this order was raised. */}
                <span style={metaItem}>{jobOrder.routeNameSnapshot ?? 'No route'}</span>
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
            {!isClosed && (
              <button
                type="button"
                onClick={() => setShortCloseOpen(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid #fed7aa',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#b45309',
                }}
              >
                Close short
              </button>
            )}
          </div>
        </div>

        {/* Five numbers, and they are the five the order is judged on: how far
            along, what went in, what is still ours, what was lost, what it cost.
            Anything else belongs to a step, not to the order. */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <div style={{ minWidth: 150, paddingRight: 18 }}>
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
              Progress
            </span>
            <span style={{ fontSize: 17, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
              {doneSteps}
              <span style={{ fontSize: 12, color: '#64748b' }}> / {steps.length} steps</span>
            </span>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: '#eef0f3',
                marginTop: 5,
                overflow: 'hidden',
              }}
            >
              <div style={{ width: `${donePct}%`, height: '100%', background: status.color }} />
            </div>
          </div>
          <Tile label="Issued" value={formatQty(summary.issuedQty)} unit={unit} />
          <Tile label="In hand" value={formatQty(summary.inHandQty)} />
          <Tile
            label="Wastage"
            value={summary.wastagePct === null ? '—' : `${summary.wastagePct}%`}
          />
          <Tile
            label="Cost / unit"
            value={summary.costPerUnit === null ? '—' : formatQty(summary.costPerUnit)}
          />
        </div>
      </header>

      <div style={{ padding: '18px 24px' }}>
        <h2 style={sectionLabel}>Route</h2>
        <JobOrderFlow
          steps={steps}
          selectedId={selectedStep?.id ?? null}
          onSelect={(step) => setPickedStepId(step.id)}
          /* Offered whatever the steps are doing — appending renumbers nothing,
             so a step at a processor is no reason to withhold it. A closed order
             is: the server refuses those, and a button that only ever 409s is
             worse than no button. */
          onAppend={isClosed ? undefined : () => setAddStepsOpen(true)}
        />

        {selectedStep && (
          <div style={{ marginTop: 16 }}>
            <JobOrderStepDetail
              step={selectedStep}
              onIssue={setIssueStep}
              onReceive={setReceiveStep}
              onViewIssues={(step) =>
                navigate(`/organizations/${orgId}/jobwork/issues?stepId=${step.id}`)
              }
              onViewReceipts={(step) =>
                navigate(`/organizations/${orgId}/jobwork/receipts?stepId=${step.id}`)
              }
            />
          </div>
        )}

        {lots.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h2 style={sectionLabel}>Lots on this order</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {lots.map((lot) => (
                <span
                  key={lot.id}
                  style={{
                    padding: '4px 10px',
                    border: '1px solid #e2e8f0',
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#334155',
                    background: '#fff',
                  }}
                >
                  {lot.lotNumber}
                  {lot.supplierLotRef && (
                    <span style={{ color: '#94a3b8' }}> · {lot.supplierLotRef}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {addStepsOpen && (
        <AddStepsDialog
          isOpen
          onClose={() => setAddStepsOpen(false)}
          jobOrderId={jobOrder.id}
          jobOrderNumber={jobOrder.jobOrderNumber}
          steps={steps}
          onAdded={() => {
            // The list too: appending to a completed order reopens it as
            // in_progress, and the row would otherwise keep saying "Completed".
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] });
            queryClient.invalidateQueries({ queryKey: ['job-orders', orgId] });
          }}
        />
      )}

      {issueStep && (
        <IssueDialog
          isOpen
          onClose={() => setIssueStep(null)}
          jobOrder={jobOrder}
          step={issueStep}
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
          step={receiveStep}
          onReceived={() =>
            queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId, id] })
          }
        />
      )}

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
    </div>
  );
}
