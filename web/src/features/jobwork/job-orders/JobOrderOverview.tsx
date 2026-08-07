import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { IssueDialog } from '../issues/IssueDialog';
import { ReceiveDialog } from '../receipts/ReceiveDialog';
import { JOB_ORDER_STATUS_META, formatQty, statusMeta } from '../jobwork.schemas';
import { fetchJobOrderOverview, shortCloseJobOrder } from './jobOrders.api';
import { JobOrderStepper } from './JobOrderStepper';
import type { OverviewStep } from './jobOrders.schemas';

const tileStyle: React.CSSProperties = {
  border: '1px solid #eef0f3',
  borderRadius: 6,
  padding: '12px 16px',
  background: '#fff',
  minWidth: 150,
};

const tileLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  display: 'block',
  marginBottom: 4,
};

const tileValue: React.CSSProperties = { fontSize: 18, fontWeight: 600, color: '#111' };

const metaItem: React.CSSProperties = { fontSize: 12, color: '#64748b' };

/**
 * The Job Order Overview — the page the module exists for.
 *
 * 🔴 EVERY NUMBER ON IT IS DERIVED. The tiles come from the ledger and the child
 * documents, not from stored totals, and that is deliberate rather than lazy: a
 * stored balance is a balance that can disagree with its own history (§5.6), and
 * this is the page people are meant to believe. It is one request, so all of it
 * describes the same moment — four separate fetches would render four.
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
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const [shortCloseReason, setShortCloseReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['job-order-overview', orgId, id],
    queryFn: () => fetchJobOrderOverview(orgId!, id!),
    enabled: Boolean(orgId && id),
  });

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

  const { jobOrder, summary, steps, lots } = data;
  const status = statusMeta(JOB_ORDER_STATUS_META, jobOrder.status);
  const unit = jobOrder.inputUom ? (jobOrder.inputUom.symbol ?? jobOrder.inputUom.unitName) : '';
  const listPath = `/organizations/${orgId}/jobwork/job-orders`;
  const isClosed = jobOrder.status === 'short_closed' || jobOrder.status === 'cancelled';

  return (
    <div style={{ background: '#f8fafc', minHeight: '100%' }}>
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid #eef0f3',
          padding: '16px 24px',
        }}
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
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                <span style={metaItem}>{new Date(jobOrder.orderDate).toLocaleDateString()}</span>
                <span style={metaItem}>
                  {jobOrder.inputItem?.name} · {formatQty(jobOrder.inputQty)} {unit}
                </span>
                {/* The frozen name, not a join — the route may have been renamed
                    or deleted since this order was raised. */}
                <span style={metaItem}>{jobOrder.routeNameSnapshot ?? 'No route'}</span>
                {jobOrder.ownership === 'customer' && (
                  <span style={{ ...metaItem, color: '#7c3aed' }}>Customer-owned material</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {jobOrder.status === 'draft' && (
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

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={tileStyle}>
            <span style={tileLabel}>Issued (step 1)</span>
            <span style={tileValue}>
              {formatQty(summary.issuedQty)} <small style={{ fontSize: 12 }}>{unit}</small>
            </span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabel}>In hand</span>
            <span style={tileValue}>{formatQty(summary.inHandQty)}</span>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              this order&rsquo;s lots, wherever they are
            </span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabel}>Wastage</span>
            <span style={tileValue}>
              {summary.wastagePct === null ? '—' : `${summary.wastagePct}%`}
            </span>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              closed steps only
            </span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabel}>Cost / unit</span>
            <span style={tileValue}>
              {summary.costPerUnit === null ? '—' : formatQty(summary.costPerUnit)}
            </span>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              derived, never stored
            </span>
          </div>
        </div>
      </header>

      <div style={{ padding: '20px 24px' }}>
        {lots.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h2
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                margin: '0 0 8px 0',
              }}
            >
              Lots on this order
            </h2>
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

        <JobOrderStepper
          steps={steps}
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
