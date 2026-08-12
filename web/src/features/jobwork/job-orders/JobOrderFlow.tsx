import { useEffect, useRef } from 'react';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { STEP_STATUS_META, formatQty, statusMeta, toNumber } from '../jobwork.schemas';
import type { OverviewStep } from './jobOrders.schemas';

interface Props {
  steps: OverviewStep[];
  selectedId: string | null;
  onSelect: (step: OverviewStep) => void;
  /**
   * Opens the append dialog. Omitted when the order is closed, which is the only
   * state that refuses more work — no step's status is consulted, because
   * appending never renumbers and the chain rule already sequences the new step.
   */
  onAppend?: () => void;
}

/**
 * The route, as the shop floor draws it — one box per step, left to right, in the
 * order the material actually travels.
 *
 * 🔴 A NODE CARRIES FOUR FACTS AND NO MORE: which process, who has it, how much
 * went out, how much is still out. Everything else — the item-by-item tables, the
 * charge, the tolerance, the buttons — belongs to the step you selected, not to
 * all of them at once. Six stacked cards of full detail is the version this
 * replaced, and nobody could see the shape of the order in it.
 *
 * The bar is `consumed / issued`, never `received / issued`: consumed is the only
 * figure denominated in the INPUT's unit, so it is the only one that can be
 * divided by what went out (§5.1). A step that turns metres into pieces would
 * otherwise draw a bar out of a subtraction the domain refuses to make.
 */
export function JobOrderFlow({ steps, selectedId, onSelect, onAppend }: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Six steps do not fit a panel, so the one being read must be brought into
  // view — otherwise selecting a later step appears to do nothing.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  if (steps.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
          This order has no steps yet. Edit it to add the work it runs through.
        </p>
        {onAppend && <AppendTile onClick={onAppend} />}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 4,
        overflowX: 'auto',
        padding: '2px 0',
      }}
    >
      {steps.map((step, index) => {
        const meta = statusMeta(STEP_STATUS_META, step.status);
        const issued = toNumber(step.totals.issuedQty);
        const consumed = toNumber(step.totals.consumedQty);
        const outstanding = toNumber(step.totals.outstandingQty);
        const rework = toNumber(step.totals.reworkQty);
        const pct = issued > 0 ? Math.min(100, Math.round((consumed / issued) * 100)) : 0;

        // The principal input's unit — row 1 of CONSUMES, which is what the
        // step's own totals are counted in.
        const issueUom = step.inputs[0]?.uom;
        const issueUnit = issueUom ? (issueUom.symbol ?? issueUom.unitName) : '';
        const primaryOut =
          step.itemTotals.outputs.find((row) => row.isPrimary) ?? step.itemTotals.outputs[0];

        const isSelected = step.id === selectedId;
        /* What this step is waiting for, in three words. The rail is read at a
           glance; "Awaiting return" is the whole reason somebody opens it. */
        const waiting = step.blockedReason
          ? 'Blocked'
          : outstanding > 0
            ? 'Awaiting return'
            : step.canIssue && issued === 0
              ? 'Ready to issue'
              : null;

        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelect(step)}
              aria-current={isSelected ? 'step' : undefined}
              aria-label={`Step ${step.seq}, ${step.processNameSnapshot}, ${meta.label}`}
              style={{
                display: 'block',
                textAlign: 'left',
                width: 208,
                flexShrink: 0,
                padding: '10px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isSelected ? '#fff' : '#fcfcfd',
                border: `1px solid ${isSelected ? meta.color : '#e6e9ee'}`,
                boxShadow: isSelected ? `0 0 0 2px ${meta.bg}` : 'none',
                borderLeft: `3px solid ${meta.color}`,
                font: 'inherit',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                  }}
                >
                  Step {step.seq}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: meta.color,
                    background: meta.bg,
                    padding: '1px 6px',
                    borderRadius: 8,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meta.label}
                </span>
              </div>

              {/* The snapshots, not a join — a process or vendor renamed since
                  must not retitle work whose challans are already printed. */}
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111',
                  marginTop: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {step.processNameSnapshot}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {step.processorNameSnapshot ?? step.workCentre?.name ?? 'Not assigned'}
              </div>

              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <NodeLine
                  label="Out"
                  value={issued > 0 ? `${formatQty(issued)} ${issueUnit}` : '—'}
                />
                <NodeLine
                  label="Back"
                  value={
                    primaryOut && toNumber(primaryOut.receivedQty) > 0
                      ? `${formatQty(primaryOut.receivedQty)} ${primaryOut.uomSymbol ?? ''}`
                      : '—'
                  }
                />
              </div>

              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: '#eef0f3',
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: meta.color }} />
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 5,
                  minHeight: 14,
                  fontSize: 10,
                }}
              >
                {rework > 0 && <AlertTriangle size={11} color="#b45309" />}
                <span style={{ color: rework > 0 ? '#b45309' : '#94a3b8' }}>
                  {rework > 0
                    ? `${formatQty(rework)} to rework`
                    : outstanding > 0
                      ? `${formatQty(outstanding)} ${issueUnit} still out`
                      : (waiting ?? `${pct}% accounted`)}
                </span>
              </div>
            </button>

            {(index < steps.length - 1 || onAppend) && (
              <ChevronRight size={16} color="#cbd5e1" style={{ flexShrink: 0, margin: '0 2px' }} />
            )}
          </div>
        );
      })}

      {/* The rail is where "and then what?" gets asked, so it is where the answer
          belongs. Dashed, because it is not a step — it is the offer to add one. */}
      {onAppend && <AppendTile onClick={onAppend} />}
    </div>
  );
}

function AppendTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        width: 132,
        flexShrink: 0,
        alignSelf: 'stretch',
        minHeight: 132,
        padding: '10px 12px',
        border: '1px dashed #cbd5e1',
        borderRadius: 6,
        background: '#fff',
        color: '#0062ff',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12,
      }}
    >
      <Plus size={16} />
      Add step
      <span style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 1.4 }}>
        goes on the end
      </span>
    </button>
  );
}

function NodeLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span
        style={{
          color: '#334155',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}
