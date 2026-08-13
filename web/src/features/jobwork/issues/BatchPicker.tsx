import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { Fragment } from 'react';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatch } from '../batches/batches.api';

export interface BatchSelection {
  /** Typed quantity for a batch-level pick. */
  qty: number;
}

interface Props {
  batches: AvailableBatch[];
  selection: Record<string, BatchSelection>;
  onChange: (selection: Record<string, BatchSelection>) => void;
  uomLabel: string;
  /** When the process demands one batch, picking a second is refused with the
   * reason shown rather than silently ignored. */
  singleBatchOnly: boolean;
  onSingleBatchBlocked: () => void;
  isLoading: boolean;
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#333' };

const qtyInput: React.CSSProperties = {
  width: 110,
  padding: '5px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  minHeight: 30,
};

/**
 * 🔴 THE CORE OF THE ISSUE DIALOG. Every row here came from an availability query
 * over the stock ledger — this is not a batch master, filtered.
 *
 * Granularity stops at the BATCH. Material is issued as a typed quantity checked
 * against the batch's own available balance. Per-taka checkboxes went with
 * package-level tracking on 2026-08-12.
 */

export function BatchPicker({
  batches,
  selection,
  onChange,
  uomLabel,
  singleBatchOnly,
  onSingleBatchBlocked,
  isLoading,
}: Props) {
  /**
   * 🔴 Scoped to the batches THIS picker renders — i.e. to one item (§5.7).
   *
   * The dialog shows a section per input item and they share one selection map,
   * so counting the whole map would make picking fabric block picking thread on
   * any single-batch process. Two items are necessarily two batches; the rule is
   * about two batches of the SAME item, which is what shade variation means, and
   * the server checks it exactly this way.
   */
  const renderedBatchIds = new Set(batches.map((batch) => batch.batchId));
  const selectedBatchIds = Object.entries(selection)
    .filter(([batchId, sel]) => renderedBatchIds.has(batchId) && sel.qty > 0)
    .map(([batchId]) => batchId);

  /** True when picking from this batch would break the single-batch rule. */
  const blockedByBatchRule = (batchId: string) =>
    singleBatchOnly && selectedBatchIds.length > 0 && !selectedBatchIds.includes(batchId);

  const setBatch = (batchId: string, patch: Partial<BatchSelection>) => {
    const current = selection[batchId] ?? { qty: 0, packageIds: [] };
    onChange({ ...selection, [batchId]: { ...current, ...patch } });
  };

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
        Looking up available stock…
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div
        style={{
          padding: '20px 24px',
          background: '#f8fafc',
          border: '1px dashed #cbd5e1',
          borderRadius: 4,
          color: '#475569',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        No stock of this item is available at that location for this job order&rsquo;s ownership.
        Either the material has not been received yet, or it has already been issued.
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 4, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
            <th style={th} scope="col">
              Batch
            </th>
            <th style={th} scope="col">
              Available
            </th>
            <th style={th} scope="col">
              Cost / unit
            </th>
            <th style={{ ...th, width: 150 }} scope="col">
              Qty to issue
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => {
            const sel = selection[batch.batchId] ?? { qty: 0 };
            const blocked = blockedByBatchRule(batch.batchId);

            return (
              // A batch renders as its own row PLUS one row per taka, so the two
              // have to share a keyed parent — otherwise React re-creates the
              // expanded rows on every render and a half-ticked list resets.
              <Fragment key={batch.batchId}>
                <tr
                  style={{
                    borderBottom: '1px solid #eef0f3',
                    background: blocked ? '#fafafa' : undefined,
                    opacity: blocked ? 0.55 : 1,
                  }}
                >
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>{batch.batchNumber}</td>
                  <td style={td}>
                    {formatQty(batch.availableQty)} {uomLabel}
                  </td>
                  <td style={td}>
                    {batch.costPerUnit === null ? '-' : formatQty(batch.costPerUnit)}
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      max={toNumber(batch.availableQty)}
                      value={sel.qty || ''}
                      onChange={(e) => {
                        if (blocked) {
                          onSingleBatchBlocked();
                          return;
                        }
                        setBatch(batch.batchId, { qty: Number(e.target.value) });
                      }}
                      onFocus={() => {
                        if (blocked) onSingleBatchBlocked();
                      }}
                      aria-label={`Quantity to issue from batch ${batch.batchNumber}`}
                      style={{
                        ...qtyInput,
                        background: blocked ? '#f1f5f9' : '#fff',
                        cursor: blocked ? 'not-allowed' : 'text',
                      }}
                      readOnly={blocked}
                    />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
