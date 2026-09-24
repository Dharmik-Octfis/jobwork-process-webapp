import { useEffect, useRef } from 'react';
import { Check, Plus } from 'lucide-react';
import { STEP_STATUS_META, formatQty, qtyWithUnit, statusMeta, toNumber } from '../jobwork.schemas';
import type { OverviewStep } from './jobOrders.schemas';

interface Props {
  steps: OverviewStep[];
  selectedId: string | null;
  /**
   * Where the material actually is — the first unsettled step, the same one the
   * state bar names. Distinct from `selectedId` on purpose: reading step 1 of an
   * order sitting at step 4 must not make step 1 look like where it is.
   */
  currentId?: string | null;
  onSelect: (step: OverviewStep) => void;
  /**
   * Opens the append dialog. Omitted when the order is closed, which is the only
   * state that refuses more work — no step's status is consulted, because
   * appending never renumbers and the chain rule already sequences the new step.
   */
  onAppend?: () => void;
}

const NODE = 32;

/**
 * The route as a TRACK, not a row of cards.
 *
 * 🔴 A NODE CARRIES ITS NUMBER, ITS NAME, AND WHAT IT IS WAITING ON. Nothing
 * else. The cards this replaced carried five lines each and a progress bar
 * apiece, so six steps filled the screen and the shape of the order — the only
 * thing a rail exists to show — was the thing you could not see.
 *
 * 🔴 THE NUMBER NEVER LEAVES THE CIRCLE, not even when the step is done. A tick
 * that replaces the numeral answers "is it finished" and destroys "which one is
 * it", and on a twelve-step route the second question is the one being asked —
 * you cannot count four ticks and a halo faster than you can read "7". Done is
 * carried by the FILL plus a small tick badge on the rim, so both facts are
 * legible at once.
 *
 * The line between two nodes fills when the LEFT one completes: how far the
 * material has physically travelled, read left to right without counting.
 *
 * 🔴 KEYBOARD — roving tabindex, because a twelve-step route must not be twelve
 * tab stops. Only the selected node sits in the page's tab order; ← → move
 * between steps and select as they go, Home/End jump to the ends. This is the
 * same contract every stepper on the web has, and without it a long route is
 * reachable only by mouse.
 */
export function JobOrderFlow({ steps, selectedId, currentId, onSelect, onAppend }: Props) {
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = steps.findIndex((step) => step.id === selectedId);

  // A long route does not fit, so the one being read must be brought into view —
  // otherwise selecting a step off-screen appears to do nothing.
  useEffect(() => {
    if (selectedIndex >= 0) {
      nodeRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [selectedIndex]);

  if (steps.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
          This order has no steps yet. Edit it to add the work it runs through.
        </p>
        {onAppend && <AppendNode onClick={onAppend} />}
      </div>
    );
  }

  /** ← → Home End, with focus following selection so the panel below keeps up. */
  const moveTo = (index: number) => {
    const step = steps[index];
    if (!step) return;
    onSelect(step);
    nodeRefs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(Math.min(index + 1, steps.length - 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(Math.max(index - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(steps.length - 1);
    }
  };

  return (
    <div
      role="group"
      aria-label="Route steps"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        overflowX: 'auto',
        padding: '4px 2px 2px 2px',
      }}
    >
      {steps.map((step, index) => {
        const meta = statusMeta(STEP_STATUS_META, step.status);
        const settled = step.status === 'completed' || step.status === 'short_closed';
        const isSelected = step.id === selectedId;
        const isCurrent = step.id === currentId;

        const issued = toNumber(step.totals.issuedQty);
        const outstanding = toNumber(step.totals.outstandingQty);
        const rework = toNumber(step.totals.reworkQty);
        // The principal input's unit — row 1 of CONSUMES, which is what the
        // step's own totals are counted in.
        const issueUom = step.inputs[0]?.uom;
        const unit = issueUom ? (issueUom.symbol ?? issueUom.unitName) : '';
        const primaryOut =
          step.itemTotals.outputs.find((row) => row.isPrimary) ?? step.itemTotals.outputs[0];

        /**
         * ONE line, and it is whatever the step is waiting on. Ordered by what
         * somebody would act on first: rework beats an outstanding balance, which
         * beats a block, which beats a plain invitation to start.
         */
        const note =
          rework > 0
            ? `${formatQty(rework)} to rework`
            : outstanding > 0
              ? `${qtyWithUnit(outstanding, unit)} still out`
              : settled && primaryOut
                ? `${qtyWithUnit(primaryOut.receivedQty, primaryOut.uomSymbol)} back`
                : step.blockedReason
                  ? 'Blocked'
                  : step.canIssue && issued === 0
                    ? 'Ready to issue'
                    : '—';

        return (
          <div
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {index > 0 && <Connector filled={steps[index - 1]!.status === 'completed'} />}

            <button
              type="button"
              ref={(element) => {
                nodeRefs.current[index] = element;
              }}
              // 🔴 Roving tabindex. Nothing but the selected node is a tab stop.
              tabIndex={isSelected || (selectedIndex < 0 && index === 0) ? 0 : -1}
              onClick={() => onSelect(step)}
              onKeyDown={(event) => onKeyDown(event, index)}
              /* `aria-current="step"` is WHERE THE ORDER IS, not what the mouse
                 last touched — the selected step is announced by the panel that
                 opens beneath it. */
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Step ${step.seq} of ${steps.length}, ${step.processNameSnapshot}, ${
                meta.label
              }, ${note}${isCurrent ? ', current step' : ''}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                width: 136,
                flexShrink: 0,
                padding: '6px 8px 10px 8px',
                border: 'none',
                borderRadius: 10,
                background: isSelected ? '#fff' : 'transparent',
                boxShadow: isSelected
                  ? '0 2px 8px rgba(2, 132, 199, 0.12), inset 0 0 0 1px rgba(2, 132, 199, 0.35)'
                  : 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
            >
              <span aria-hidden style={{ position: 'relative', flexShrink: 0 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: NODE,
                    height: NODE,
                    borderRadius: '50%',
                    fontSize: 13,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    background: settled ? '#10b981' : isCurrent ? '#fff' : '#f8fafc',
                    color: settled ? '#fff' : isCurrent ? '#0284c7' : '#94a3b8',
                    border: `${isCurrent ? 2 : 1}px solid ${
                      settled ? '#10b981' : isCurrent ? '#0284c7' : '#cbd5e1'
                    }`,
                    boxShadow: isCurrent ? '0 0 0 4px rgba(2, 132, 199, 0.2)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {step.seq}
                </span>
                {settled && (
                  <span
                    style={{
                      position: 'absolute',
                      right: -3,
                      bottom: -2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#10b981',
                      color: '#fff',
                      border: '2px solid #ffffff',
                    }}
                  >
                    <Check size={8} strokeWidth={4} />
                  </span>
                )}
              </span>
              <span style={{ textAlign: 'center', minWidth: 0, width: '100%' }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: isCurrent || isSelected ? 600 : 500,
                    color: settled || isCurrent || isSelected ? '#0f172a' : '#64748b',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={step.processNameSnapshot}
                >
                  {step.processNameSnapshot}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: '#94a3b8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {step.processorNameSnapshot ?? step.workCentre?.name ?? 'Not assigned'}
                </span>
                <span
                  style={{
                    display: 'block',
                    marginTop: 3,
                    fontSize: 11,
                    fontWeight: 500,
                    color: rework > 0 ? '#ea580c' : outstanding > 0 ? '#0284c7' : '#94a3b8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {note}
                </span>
              </span>
            </button>
          </div>
        );
      })}

      {/* The rail is where "and then what?" gets asked, so it is where the answer
          belongs. Outside the roving group, so it keeps its own tab stop. */}
      {onAppend && (
        <div style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
          <Connector filled={false} dashed />
          <AppendNode onClick={onAppend} />
        </div>
      )}
    </div>
  );
}

function Connector({ filled, dashed }: { filled: boolean; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 30,
        height: 2,
        marginTop: 4 + NODE / 2,
        flexShrink: 0,
        borderRadius: 1,
        background: dashed
          ? 'repeating-linear-gradient(90deg, #cbd5e1 0 4px, transparent 4px 8px)'
          : filled
            ? '#10b981'
            : '#e2e8f0',
      }}
    />
  );
}

function AppendNode({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        width: 96,
        flexShrink: 0,
        padding: '6px 8px 10px 8px',
        border: 'none',
        background: 'transparent',
        color: '#0284c7',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: NODE,
          height: NODE,
          borderRadius: '50%',
          border: '1.5px dashed #38bdf8',
          background: '#f0f7fd',
          flexShrink: 0,
          color: '#0284c7',
          transition: 'all 0.15s ease',
        }}
      >
        <Plus size={15} />
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#0284c7' }}>Add step</span>
    </button>
  );
}
