import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { X } from 'lucide-react';
import { toApiErrorMessage } from '../../../api/client';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { formatDate } from '../../../lib/formatDate';
import { useBatchUnitLabel, useTrackingLabel } from '../../../hooks/useTrackingLabel';
import { formatMoney, formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import { cancelAdjustment, fetchAdjustment } from './adjustments.api';
import { ADJUSTMENT_STATUS_META, adjustmentReasonLabel } from './adjustments.schemas';

interface AdjustmentDetailProps {
  orgId: string;
  adjustmentId: string;
  onClose: () => void;
}

const cellStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#334155' };
const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#111', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

/**
 * One posted adjustment. Read-only by design — an adjustment is never edited;
 * the only action is Cancel, which reverses its stock movements and leaves the
 * record here as cancelled.
 */
export function AdjustmentDetail({ orgId, adjustmentId, onClose }: AdjustmentDetailProps) {
  const queryClient = useQueryClient();
  const tracking = useTrackingLabel();
  const unitLabel = useBatchUnitLabel();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: adjustment, isLoading } = useQuery({
    queryKey: ['stockAdjustment', orgId, adjustmentId],
    queryFn: () => fetchAdjustment(orgId, adjustmentId),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelAdjustment(orgId, adjustmentId),
    onSuccess: (cancelled) => {
      toast.success(`${cancelled.adjustmentNumber} cancelled.`);
      setConfirmCancel(false);
      // The stock it moved has moved back — every cached figure for the item is stale.
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey.includes(cancelled.itemId) ||
          [
            'items',
            'availableBatches',
            'available-batches',
            'stockAdjustments',
            'stockAdjustment',
          ].includes(String(queryKey[0])),
      });
    },
    onError: (error) => {
      setConfirmCancel(false);
      toast.error(toApiErrorMessage(error));
    },
  });

  if (isLoading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  }
  if (!adjustment) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        Adjustment not found.
      </div>
    );
  }

  const quantity = toNumber(adjustment.quantityAdjusted);
  const before = toNumber(adjustment.quantityBefore);
  const isIncrease = quantity > 0;
  const status = ADJUSTMENT_STATUS_META[adjustment.status] ?? {
    label: adjustment.status,
    color: '#475569',
    bg: '#f1f5f9',
  };
  const isBatchTracked = adjustment.batches.some((row) => row.batch.supplierBatchRef);
  const showUnits = unitLabel.enabled && adjustment.batches.some((row) => row.batchUnit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div className="detail-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <h2
            className="detail-title"
            style={{ fontWeight: 400, fontSize: 22, color: '#222', margin: 0 }}
          >
            {adjustment.adjustmentNumber}
          </h2>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 500,
              background: status.bg,
              color: status.color,
            }}
          >
            {status.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {adjustment.status === 'adjusted' && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              style={{
                minHeight: 32,
                padding: '6px 12px',
                border: '1px solid #fecaca',
                background: '#fff',
                color: '#dc2626',
                borderRadius: 4,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel Adjustment
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="detail-page-content" style={{ padding: 24, overflow: 'auto', minWidth: 0 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 20,
          }}
        >
          <Fact label="Date">{formatDate(adjustment.adjustmentDate)}</Fact>
          <Fact label="Item">
            {adjustment.item.name}
            {adjustment.item.sku ? ` (${adjustment.item.sku})` : ''}
          </Fact>
          <Fact label="Location">{adjustment.location.name}</Fact>
          <Fact label="Reason">{adjustmentReasonLabel(adjustment.reason)}</Fact>
          <Fact label="Quantity Before">{formatQty(before)}</Fact>
          <Fact label="Quantity Adjusted">
            <span style={{ color: isIncrease ? '#166534' : '#b91c1c', fontWeight: 500 }}>
              {isIncrease ? '+' : '−'}
              {formatQty(Math.abs(quantity))}
            </span>
          </Fact>
          <Fact label="Quantity After">{formatQty(before + quantity)}</Fact>
          {isIncrease && <Fact label="Cost Price">{formatMoney(adjustment.costPrice)}</Fact>}
          <Fact label="Value">{formatMoney(adjustment.value)}</Fact>
          <Fact label="Reference Number">{adjustment.referenceNumber || '-'}</Fact>
          <Fact label="Adjusted By">{adjustment.createdByUser?.fullName || '-'}</Fact>
        </div>

        {adjustment.description && (
          <div style={{ marginTop: 20 }}>
            <Fact label="Description">{adjustment.description}</Fact>
          </div>
        )}

        {/* An untracked item's batches are plumbing the user never sees. */}
        {isBatchTracked && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
              {tracking.plural}
            </div>
            <div className="responsive-table-wrapper">
              <table style={{ width: '100%', minWidth: 360, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={headStyle}>{tracking.singular} Reference</th>
                    {showUnits && <th style={headStyle}>{unitLabel.singular}</th>}
                    <th style={{ ...headStyle, textAlign: 'right' }}>
                      Quantity {isIncrease ? 'In' : 'Out'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {adjustment.batches.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                      <td style={cellStyle}>{row.batch.supplierBatchRef || '-'}</td>
                      {showUnits && <td style={cellStyle}>{row.batchUnit?.label || '-'}</td>}
                      <td style={{ ...cellStyle, textAlign: 'right' }}>{formatQty(row.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmCancel}
        title="Cancel Adjustment"
        message={`${adjustment.adjustmentNumber} will be reversed: the stock it ${
          isIncrease ? 'added is taken back' : 'removed is put back'
        }. The adjustment stays in the list as cancelled.`}
        confirmText="Cancel Adjustment"
        cancelText="Keep"
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setConfirmCancel(false)}
        isConfirming={cancelMutation.isPending}
      />
    </div>
  );
}
