import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { formatDate } from '../../../lib/formatDate';
import { notify } from '../../../lib/notify';
import { useBatchUnitLabel, useTrackingLabel } from '../../../hooks/useTrackingLabel';
import { RecordApprovalBanner } from '../../approvals/components/RecordApprovalBanner';
import { RecordApprovalHistoryTimeline } from '../../approvals/components/RecordApprovalHistoryTimeline';
import { useRecordApproval } from '../../approvals/useRecordApproval';
import { formatMoney, formatQty, toNumber } from '../../jobwork/jobwork.schemas';
import { adjustAdjustment, fetchAdjustment, removeAdjustment } from './adjustments.api';
import {
  ADJUSTMENT_APPROVAL_MODULE,
  adjustmentTypeLabel,
  adjustmentStatusMeta,
  isUnposted,
  type StockAdjustmentDetail,
  type StockAdjustmentDetailLine,
} from './adjustments.schemas';
import { headerButton } from './adjustmentButtons';
import { announceOutcome, refreshAfterAdjustment } from './adjustmentSave';
import { ValueAdjustmentLines } from './ValueAdjustmentLines';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { formatCustomFieldValue } from '../../custom-fields/formatCustomFieldValue';

interface AdjustmentDetailProps {
  orgId: string;
  adjustmentId: string;
  onClose: () => void;
}

const cellStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  color: '#334155',
  verticalAlign: 'top',
};
const headStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};
const rightCell: React.CSSProperties = { ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#111', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

/** What a line's batches read as — the real rows once posted, the form's until then. */
function batchNames(
  line: StockAdjustmentDetailLine,
  labels: StockAdjustmentDetail['draftLabels'],
  showUnits: boolean,
): string[] {
  if (line.batches.length > 0) {
    return line.batches
      .filter((row) => row.batch.supplierBatchRef)
      .map(
        (row) =>
          `${row.batch.supplierBatchRef}${
            showUnits && row.batchUnit ? ` / ${row.batchUnit.label}` : ''
          } · ${formatQty(row.qty)}`,
      );
  }
  return (line.draftBatches ?? []).map((row) => {
    const name = row.supplierBatchRef || (row.batchId ? labels.batches[row.batchId] : '') || '-';
    const unit = showUnits && row.batchUnitId ? labels.units[row.batchUnitId] : '';
    return `${name}${unit ? ` / ${unit}` : ''} · ${formatQty(row.quantity)}`;
  });
}

/**
 * One adjustment. What can be done to it depends on where it is:
 *
 *   draft / rejected / approved — edit, Adjust, delete (it holds no stock);
 *   pending approval — the shared approval banner decides;
 *   adjusted — Cancel, which reverses the stock and keeps the record.
 */
export function AdjustmentDetail({ orgId, adjustmentId, onClose }: AdjustmentDetailProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tracking = useTrackingLabel();
  const unitLabel = useBatchUnitLabel();
  const [confirming, setConfirming] = useState<'cancel' | 'delete' | null>(null);

  const { data: adjustment, isLoading } = useQuery({
    queryKey: ['stockAdjustment', orgId, adjustmentId],
    queryFn: () => fetchAdjustment(orgId, adjustmentId),
  });
  // Rendered only when an approval request exists — an organization with no
  // approval process for adjustments sees none of it.
  const approval = useRecordApproval(orgId, ADJUSTMENT_APPROVAL_MODULE, adjustmentId);
  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId, 'stock_adjustment');

  const itemIds = adjustment?.lines.map((line) => line.itemId) ?? [];
  const refresh = () => refreshAfterAdjustment(queryClient, itemIds);

  const adjustMutation = useMutation({
    mutationFn: () => adjustAdjustment(orgId, adjustmentId),
    onSuccess: (result) => {
      announceOutcome(result);
      refresh();
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removeAdjustment(orgId, adjustmentId),
    onSuccess: (result) => {
      setConfirming(null);
      notify.success(`${result.adjustmentNumber} ${result.deleted ? 'deleted' : 'cancelled'}.`);
      refresh();
      if (result.deleted) onClose();
    },
    onError: () => setConfirming(null),
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

  const status = adjustmentStatusMeta(adjustment.status);
  const posted = adjustment.status === 'adjusted' || adjustment.status === 'cancelled';
  const editable = isUnposted(adjustment.status);
  const showUnits = unitLabel.enabled;
  const anyBatches = adjustment.lines.some(
    (line) => batchNames(line, adjustment.draftLabels, showUnits).length > 0,
  );
  const busy = adjustMutation.isPending || removeMutation.isPending;
  const isValue = adjustment.adjustmentType === 'value';

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
              whiteSpace: 'nowrap',
            }}
          >
            {status.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {editable && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => adjustMutation.mutate()}
                style={headerButton('primary', busy)}
              >
                {adjustMutation.isPending ? 'Adjusting…' : 'Adjust'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  navigate(`/organizations/${orgId}/inventory/adjustments/${adjustmentId}/edit`)
                }
                style={headerButton('plain', busy)}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming('delete')}
                style={headerButton('danger', busy)}
              >
                Delete
              </button>
            </>
          )}
          {adjustment.status === 'adjusted' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming('cancel')}
              style={headerButton('danger', busy)}
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
        <RecordApprovalBanner
          organizationId={orgId}
          moduleId={ADJUSTMENT_APPROVAL_MODULE}
          recordId={adjustmentId}
          onActionComplete={refresh}
        />

        {adjustment.status === 'approved' && (
          <div
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              borderRadius: 4,
              fontSize: 13,
              color: '#1e3a8a',
            }}
          >
            Approved, but the stock has not been adjusted yet. Press Adjust to see why.
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 20,
          }}
        >
          <Fact label="Mode">{adjustmentTypeLabel(adjustment.adjustmentType)}</Fact>
          <Fact label="Date">{formatDate(adjustment.adjustmentDate)}</Fact>
          <Fact label="Location">{adjustment.location.name}</Fact>
          <Fact label="Reason">{adjustment.reason.name}</Fact>
          <Fact label="Reference Number">{adjustment.referenceNumber || '-'}</Fact>
          {posted && <Fact label="Value">{formatMoney(adjustment.value)}</Fact>}
          <Fact label="Created By">{adjustment.createdByUser?.fullName || '-'}</Fact>
          {customFieldDefs.map((def) => (
            <Fact key={def.id} label={def.label}>
              {formatCustomFieldValue(adjustment.customFields[def.key], def)}
            </Fact>
          ))}
        </div>

        {adjustment.description && (
          <div style={{ marginTop: 20 }}>
            <Fact label="Description">{adjustment.description}</Fact>
          </div>
        )}

        {isValue ? (
          <ValueAdjustmentLines adjustment={adjustment} posted={posted} />
        ) : (
          <div style={{ marginTop: 24 }}>
            <div className="responsive-table-wrapper">
              <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={headStyle}>Item</th>
                    {/* A balance exists only once it posts; a draft has no honest "before". */}
                    {posted && <th style={{ ...headStyle, textAlign: 'right' }}>Before</th>}
                    <th style={{ ...headStyle, textAlign: 'right' }}>Adjusted</th>
                    {posted && <th style={{ ...headStyle, textAlign: 'right' }}>After</th>}
                    <th style={{ ...headStyle, textAlign: 'right' }}>Cost Price</th>
                    {posted && <th style={{ ...headStyle, textAlign: 'right' }}>Value</th>}
                    {anyBatches && <th style={headStyle}>{tracking.plural}</th>}
                  </tr>
                </thead>
                <tbody>
                  {adjustment.lines.map((line) => {
                    const quantity = toNumber(line.quantityAdjusted);
                    const before = toNumber(line.quantityBefore);
                    return (
                      <tr key={line.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                        <td style={cellStyle}>
                          {line.item.name}
                          {line.item.sku && (
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              SKU: {line.item.sku}
                            </div>
                          )}
                        </td>
                        {posted && <td style={rightCell}>{formatQty(before)}</td>}
                        <td
                          style={{
                            ...rightCell,
                            color: quantity > 0 ? '#166534' : '#b91c1c',
                            fontWeight: 500,
                          }}
                        >
                          {quantity > 0 ? '+' : '−'}
                          {formatQty(Math.abs(quantity))}
                        </td>
                        {posted && <td style={rightCell}>{formatQty(before + quantity)}</td>}
                        <td style={rightCell}>
                          {line.costPrice === null ? '-' : formatMoney(line.costPrice)}
                        </td>
                        {posted && <td style={rightCell}>{formatMoney(line.value)}</td>}
                        {anyBatches && (
                          <td style={cellStyle}>
                            {batchNames(line, adjustment.draftLabels, showUnits).map((name) => (
                              <div key={name}>{name}</div>
                            ))}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {approval.allRequests.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <RecordApprovalHistoryTimeline
              organizationId={orgId}
              moduleId={ADJUSTMENT_APPROVAL_MODULE}
              recordId={adjustmentId}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirming === 'cancel'}
        title="Cancel Adjustment"
        message={
          isValue
            ? `${adjustment.adjustmentNumber} will be reversed: the stock goes back to the value it had before. The adjustment stays in the list as cancelled.`
            : `${adjustment.adjustmentNumber} will be reversed: the stock it added is taken back and the stock it removed is put back. The adjustment stays in the list as cancelled.`
        }
        confirmText="Cancel Adjustment"
        cancelText="Keep"
        onConfirm={() => removeMutation.mutate()}
        onCancel={() => setConfirming(null)}
        isConfirming={removeMutation.isPending}
      />
      <ConfirmDialog
        isOpen={confirming === 'delete'}
        title="Delete Adjustment"
        message={`${adjustment.adjustmentNumber} has not adjusted any stock. Deleting it removes it from the list.`}
        confirmText="Delete"
        cancelText="Keep"
        onConfirm={() => removeMutation.mutate()}
        onCancel={() => setConfirming(null)}
        isConfirming={removeMutation.isPending}
      />
    </div>
  );
}
