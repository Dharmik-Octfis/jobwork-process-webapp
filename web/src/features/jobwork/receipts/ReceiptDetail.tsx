import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { formatQty, toNumber } from '../jobwork.schemas';
import { cancelJobReceipt, fetchJobReceiptById } from './jobReceipts.api';

interface Props {
  receiptId: string;
  onClose: () => void;
  onOpenJobOrder: (jobOrderId: string) => void;
}

const rowLabel: React.CSSProperties = { fontSize: 12, color: '#64748b', paddingRight: 16 };
const rowValue: React.CSSProperties = { fontSize: 13, color: '#111', padding: '6px 0' };

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
};

const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#333' };

/**
 * A lot number, as a chip.
 *
 * 🔴 It is an IDENTIFIER, not a footnote — somebody reads it off a physical tag
 * and types it into a search box, so it needs to be findable at a glance and
 * copyable without selecting half a sentence. Monospaced for the same reason:
 * LOT-00011 and LOT-000ll are one glyph apart in a proportional face.
 *
 * Green is stock you can issue onward; amber is rework, kept in its own lot so
 * the pieces stay countable.
 */
function LotChip({ lot, tone }: { lot: string; tone: 'good' | 'rework' }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        background: tone === 'good' ? '#f0fdf4' : '#fffbeb',
        color: tone === 'good' ? '#15803d' : '#b45309',
        border: `1px solid ${tone === 'good' ? '#bbf7d0' : '#fde68a'}`,
      }}
      title={
        tone === 'good'
          ? 'Lot created — ready to issue onward'
          : 'Rework lot — re-issue to this same step'
      }
    >
      {tone === 'rework' && <span style={{ fontFamily: 'inherit', opacity: 0.8 }}>↻</span>}
      {lot}
    </span>
  );
}

export function ReceiptDetail({ receiptId, onClose, onOpenJobOrder }: Props) {
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: receipt, isLoading } = useQuery({
    queryKey: ['job-receipt', orgId, receiptId],
    queryFn: () => fetchJobReceiptById(orgId!, receiptId),
    enabled: Boolean(orgId && receiptId),
  });

  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId!, 'job_receipt');

  const cancelMutation = useMutation({
    mutationFn: () => cancelJobReceipt(orgId!, receiptId, cancelReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-receipts', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-receipt', orgId, receiptId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      setCancelOpen(false);
      setCancelReason('');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not cancel this receipt');
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading receipt" />
      </div>
    );
  }

  if (!receipt) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Receipt not found.</div>;
  }

  /* The six header totals are the PRIMARY output's, so the unit is that row's —
     read off `isPrimary` rather than a header column (dropped 2026-08-12). */
  const primaryOutput = receipt.outputs.find((row) => row.isPrimary) ?? receipt.outputs[0];
  const unit = primaryOutput?.uom ? (primaryOutput.uom.symbol ?? primaryOutput.uom.unitName) : '';

  /** The challans this receipt closes, deduplicated — several consumed lines
   * usually point at the same one. */
  const closedChallans = [
    ...new Set(
      receipt.lines.flatMap((line) => (line.jobIssue ? [line.jobIssue.challanNumber] : [])),
    ),
  ];

  /** What it consumed, per item. The lines are per challan LINE, so several
   * usually share an item. */
  const consumedByItem = (() => {
    const totals = new Map<string, { name: string; qty: number }>();
    for (const line of receipt.lines) {
      const name = line.jobIssueLine?.item?.name;
      if (!name) continue;
      const existing = totals.get(name) ?? { name, qty: 0 };
      existing.qty += toNumber(line.issuedQty);
      totals.set(name, existing);
    }
    return [...totals.values()];
  })();
  const issued = toNumber(receipt.totalIssuedQty);
  const received = toNumber(receipt.totalReceivedQty);
  const actualYield = issued > 0 ? received / issued : null;

  return (
    <div style={{ background: '#fff', minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}>
              {receipt.receiptNumber}
            </h2>
            <span
              style={{
                padding: '2px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 500,
                color: receipt.status === 'cancelled' ? '#b91c1c' : '#15803d',
                background: receipt.status === 'cancelled' ? '#fef2f2' : '#f0fdf4',
              }}
            >
              {receipt.status === 'cancelled' ? 'Cancelled' : 'Posted'}
            </span>
          </div>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {new Date(receipt.receiptDate).toLocaleDateString()} ·{' '}
            {receipt.processorNameSnapshot ?? 'in-house'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {receipt.status !== 'cancelled' && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                border: '1px solid #fecaca',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
                color: '#b91c1c',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
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
            }}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {error && (
        <p
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '10px 24px',
            margin: 0,
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div style={{ padding: '20px 24px' }}>
        <table style={{ borderCollapse: 'collapse', marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={rowLabel}>Job order</td>
              <td style={rowValue}>
                <button
                  type="button"
                  onClick={() => onOpenJobOrder(receipt.jobOrderId)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: '#0062ff',
                    cursor: 'pointer',
                  }}
                >
                  {receipt.jobOrder?.jobOrderNumber ?? 'Open'}
                </button>
                {receipt.step && ` · step ${receipt.step.seq}, ${receipt.step.processNameSnapshot}`}
              </td>
            </tr>
            <tr>
              {/* Where it landed. WHAT came back is the table below — a receipt
                  returns several items, and naming only the first here was the
                  header pretending to describe all of them. */}
              <td style={rowLabel}>Received into</td>
              <td style={rowValue}>{receipt.location?.name ?? '-'}</td>
            </tr>
            <tr>
              {/*
                🔴 WHICH CHALLANS THIS SETTLES — at the RECEIPT level, which is
                the level it is known at. It was a per-line column before and sat
                empty: one lot-level line closes several challan lines at once and
                names none of them. The link itself is far from unnecessary — it
                is how anybody gets from goods on the shelf back to the paperwork
                they travelled on.
              */}
              <td style={rowLabel}>Closes</td>
              <td style={rowValue}>
                {closedChallans.length === 0 ? (
                  '-'
                ) : (
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {closedChallans.map((challan) => (
                      <span
                        key={challan}
                        style={{
                          padding: '1px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 600,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                        }}
                      >
                        {challan}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={rowLabel}>Consumed</td>
              <td style={rowValue}>
                {consumedByItem.length === 0
                  ? formatQty(receipt.totalIssuedQty)
                  : consumedByItem.map((row) => (
                      <span key={row.name} style={{ display: 'block' }}>
                        {row.name} · {formatQty(row.qty)}
                      </span>
                    ))}
              </td>
            </tr>
            <tr>
              <td style={rowLabel}>Received</td>
              <td style={rowValue}>
                {formatQty(receipt.totalReceivedQty)} {unit}
              </td>
            </tr>
            <tr>
              <td style={rowLabel}>Yield</td>
              <td style={rowValue}>
                {actualYield === null ? '-' : actualYield.toFixed(4)}
                {receipt.step?.expectedYield && (
                  <span style={{ color: '#94a3b8' }}>
                    {' '}
                    (expected {formatQty(receipt.step.expectedYield)})
                  </span>
                )}
              </td>
            </tr>
            {receipt.outputLot && (
              <tr>
                <td style={rowLabel}>Output lot</td>
                <td style={rowValue}>{receipt.outputLot.lotNumber}</td>
              </tr>
            )}
            {receipt.reworkLot && (
              <tr>
                <td style={rowLabel}>Rework lot</td>
                <td style={{ ...rowValue, color: '#b45309' }}>
                  {receipt.reworkLot.lotNumber} — kept separate so the reworked pieces stay
                  countable
                </td>
              </tr>
            )}
            {receipt.remarks && (
              <tr>
                <td style={rowLabel}>Remarks</td>
                <td style={{ ...rowValue, whiteSpace: 'pre-wrap' }}>{receipt.remarks}</td>
              </tr>
            )}
            {customFieldDefs.map((def) => {
              const value = receipt.customFields?.[def.key];
              return (
                <tr key={def.id}>
                  <td style={rowLabel}>{def.label}</td>
                  <td style={rowValue}>
                    {value === null || value === undefined || value === ''
                      ? '-'
                      : Array.isArray(value)
                        ? value.join(', ')
                        : String(value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ border: '1px solid #eef0f3', borderRadius: 4, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            {/*
              🔴 WHAT CAME BACK, one row per item (§5.7).

              This used to render `receipt.lines` — the CONSUMED side — whose
              disposition columns are all zero at lot level, so the page showed a
              receipt where nothing had been accepted. Three of its columns said
              nothing either: "Taka / line" is always "Bulk" now that receiving is
              lot-level, "Challan" is blank because a bulk line closes several at
              once and names none, and "Issued" is the consumed quantity, which
              the Consumed row above already states.
            */}
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                <th style={th} scope="col">
                  Item
                </th>
                <th style={th} scope="col">
                  Received
                </th>
                <th style={th} scope="col">
                  Good
                </th>
                <th style={th} scope="col">
                  Rework
                </th>
                <th style={th} scope="col">
                  Scrap
                </th>
                <th style={th} scope="col">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.outputs.length === 0 && (
                <tr>
                  <td style={{ ...td, color: '#94a3b8' }} colSpan={6}>
                    Nothing recorded as returned on this receipt.
                  </td>
                </tr>
              )}
              {receipt.outputs.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                    {row.item?.name ?? '-'}
                    {/* 🔴 The lots this row CREATED, as chips rather than grey
                        text — they are identifiers somebody reads off a tag and
                        types into a search box, not a footnote. Green is the
                        stock you can issue onward; amber is the rework, kept in
                        its own lot so the pieces stay countable. */}
                    {(row.outputLot || row.reworkLot) && (
                      <span style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {row.outputLot && <LotChip lot={row.outputLot.lotNumber} tone="good" />}
                        {row.reworkLot && <LotChip lot={row.reworkLot.lotNumber} tone="rework" />}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {formatQty(row.receivedQty)}{' '}
                    <span style={{ color: '#94a3b8' }}>
                      {row.uom?.symbol ?? row.uom?.unitName ?? ''}
                    </span>
                  </td>
                  <td style={td}>{formatQty(row.acceptedQty)}</td>
                  <td style={td}>{formatQty(row.reworkQty)}</td>
                  <td style={td}>{formatQty(row.scrapQty)}</td>
                  <td style={td}>
                    {row.reason?.name ?? '-'}
                    {row.responsibility && (
                      <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
                        {row.responsibility === 'ours' ? 'Our fault' : 'Their fault'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        title="Cancel this receipt"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
              Everything this receipt posted is reversed: the consumed input goes back to the
              processor and the output lots are un-made. It is refused if those lots have already
              been used — there is no way to un-post stock that has moved on.
            </p>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
              Reason
            </label>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              aria-label="Reason for cancelling"
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                minHeight: 32,
              }}
            />
          </div>
        }
        confirmText={cancelMutation.isPending ? 'Cancelling…' : 'Cancel receipt'}
        cancelText="Keep it"
        onConfirm={() => {
          if (cancelReason.trim()) cancelMutation.mutate();
        }}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
      />
    </div>
  );
}
