import { AlertTriangle, PackageCheck, Send, Check } from 'lucide-react';
import { rateBasisLabel } from '../processes/processes.schemas';
import {
  STEP_STATUS_META,
  formatQty,
  processorTypeLabel,
  qtyWithUnit,
  statusMeta,
  stepCharge,
  toNumber,
} from '../jobwork.schemas';
import { ActivityTimeline } from './ActivityTimeline';
import type { ActivityEvent, OverviewStep } from './jobOrders.schemas';

interface Props {
  step: OverviewStep;
  /** This step's documents only — the caller has already filtered by `stepId`. */
  activity: ActivityEvent[];
  onIssue: (step: OverviewStep) => void;
  onReceive: (step: OverviewStep) => void;
  onComplete?: (step: OverviewStep) => void;
  onOpenDocument: (event: ActivityEvent) => void;
}

const actionButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 13,
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
};

const columnLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: '#94a3b8',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 6,
};

/**
 * The one step you are working on — everything the rail deliberately left out,
 * and now the documents behind the numbers as well.
 *
 * 🔴 IN AND OUT, THEN WHAT HAPPENED. The two lists say where the step stands;
 * the timeline underneath says how it got there, challan by challan. They used to
 * be separated by a page navigation — the counts at the bottom of this card were
 * links to a filtered Issues list, which is where the order's context went to
 * die. A step's history is part of the step.
 *
 * 🔴 `[+ Issue]` IS NOT ENABLED BY THE STATUS. A step can be perfectly ready on
 * paper and have nothing to send. It used to require a positive ledger balance;
 * while Purchase Received is missing that rule is relaxed (see `canIssue` in
 * `jobOrders.service.ts`), but the CHAIN still holds — a step fed by an earlier
 * one cannot issue until that step has returned something. Whenever it is off,
 * the reason is printed beside it: a greyed-out control with no explanation is
 * how somebody concludes the software is broken.
 *
 * `[+ Receive]` appears only once something is actually out there — an
 * outstanding balance against this step. Offering it before anything was issued
 * invites a receipt of goods that never left.
 */
export function JobOrderStepDetail({
  step,
  activity,
  onIssue,
  onReceive,
  onComplete,
  onOpenDocument,
}: Props) {
  const meta = statusMeta(STEP_STATUS_META, step.status);
  const issued = toNumber(step.totals.issuedQty);
  const received = toNumber(step.totals.receivedQty);
  const returned = toNumber(step.totals.returnedQty);
  const outstanding = toNumber(step.totals.outstandingQty);
  const tolerance = step.tolerancePct === null ? null : toNumber(step.tolerancePct);

  // The principal input's and primary output's units, read off the two lists —
  // the four scalars that used to mirror them went with Migration B (2026-08-12).
  const issueUom = step.inputs[0]?.uom;
  const issueUnit = issueUom ? (issueUom.symbol ?? issueUom.unitName) : '';
  const primaryOutput = step.outputs.find((row) => row.isPrimary) ?? step.outputs[0];
  const receiveUom = primaryOutput?.uom;
  const receiveUnit = receiveUom ? (receiveUom.symbol ?? receiveUom.unitName) : '';

  /**
   * Wastage is shown only when it means something. Two conditions:
   *
   *   - the step has closed. One still out at the dyer has issued everything and
   *     received nothing, which reads as 100% and says nothing at all.
   *   - 🔴 the units match. `issued − received` across a step that turns metres
   *     into pieces is not a quantity, and printing a number there would invite
   *     somebody to act on it.
   */
  const settled = step.status === 'completed' || step.status === 'short_closed';
  const comparable =
    step.itemTotals.inputs.length <= 1 &&
    step.itemTotals.outputs.length <= 1 &&
    (!primaryOutput?.uomId || primaryOutput.uomId === step.inputs[0]?.uomId);
  const lost = issued - received - returned;
  const wastagePct = settled && comparable && issued > 0 ? (lost / issued) * 100 : null;
  const overTolerance = wastagePct !== null && tolerance !== null ? wastagePct > tolerance : false;

  // 🔴 The SAME helper the header's Charges tile sums, so the step and the order
  // can never disagree about what this step costs.
  const rate = step.rate === null ? null : toNumber(step.rate);
  const amount = stepCharge({
    rate: step.rate,
    rateBasis: step.rateBasis,
    issuedQty: step.totals.issuedQty,
    receivedQty: step.totals.receivedQty,
  });

  const reworkPending = toNumber(step.totals.reworkQty) > 0;

  return (
    <section style={{ border: '1px solid #eef0f3', borderRadius: 10, background: '#fff' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          padding: '12px 16px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: meta.bg,
              color: meta.color,
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {step.seq}
          </span>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', margin: 0 }}>
              {step.processNameSnapshot}
            </h3>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {step.processorNameSnapshot ??
                step.workCentre?.name ??
                processorTypeLabel(step.processorType)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!step.canIssue && (
            <span style={{ fontSize: 11, color: '#94a3b8', maxWidth: 320 }}>
              {/* 🔴 The REASON, not just a disabled button. */}
              {step.blockedReason ?? 'This step has nothing listed to issue.'}
            </span>
          )}
          <button
            type="button"
            onClick={() => onIssue(step)}
            disabled={!step.canIssue}
            style={{
              ...actionButton,
              background: step.canIssue ? '#0062ff' : '#f1f5f9',
              color: step.canIssue ? '#fff' : '#94a3b8',
              border: 'none',
              cursor: step.canIssue ? 'pointer' : 'not-allowed',
            }}
          >
            <Send size={14} /> Issue
          </button>
          {step.canReceive && (
            <button
              type="button"
              onClick={() => onReceive(step)}
              style={{
                ...actionButton,
                background: '#fff',
                color: '#186337',
                border: '1px solid #186337',
              }}
            >
              <PackageCheck size={14} /> Receive
            </button>
          )}
          {!settled && onComplete && (
            <button
              type="button"
              onClick={() => onComplete(step)}
              style={{
                ...actionButton,
                background: '#fff',
                color: '#2563eb',
                border: '1px solid #2563eb',
              }}
            >
              <Check size={14} /> Mark as complete
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: '14px 16px' }}>
        {reworkPending && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 4,
              padding: '8px 10px',
              marginBottom: 14,
            }}
          >
            <AlertTriangle size={14} color="#b45309" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
              {formatQty(step.totals.reworkQty)} {receiveUnit} came back needing rework. It sits in
              its own batch — issue it back to this step to run it again.
            </span>
          </div>
        )}

        {/*
          🔴 ONE ROW PER ITEM, each in its OWN unit (§5.7, §6.5). A step consumes
          a set and returns a set, and the two are unrelated in length and in unit
          — three items in and two out is normal. A single "Issued / Received"
          pair could only ever describe one of them.

          🔴 WHAT HAPPENED, not what was meant to happen. The plan is not repeated
          here: it is on the step when you edit the order, and — where it actually
          matters — in the Issue dialog, which shows planned, already issued,
          remaining and the tolerance ceiling at the moment somebody decides how
          much to send.
        */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            gap: 24,
          }}
        >
          <div>
            <span style={columnLabel}>Material in</span>
            <MovementList
              actionLabel="Issued"
              rows={step.itemTotals.inputs.map((row) => ({
                key: row.itemId,
                name: row.itemName,
                note: row.planned
                  ? row.fromStock
                    ? 'from stock'
                    : 'from an earlier step'
                  : 'rework',
                qty: qtyWithUnit(row.issuedQty, row.uomSymbol),
                muted: toNumber(row.issuedQty) === 0,
                planned: row.plannedQty ? qtyWithUnit(row.plannedQty, row.uomSymbol) : undefined,
                remaining: row.remainingQty ? qtyWithUnit(row.remainingQty, row.uomSymbol) : undefined,
              }))}
              empty="Nothing issued yet."
            />
          </div>
          <div style={{ width: 1, background: '#e2e8f0' }} />
          <div>
            <span style={columnLabel}>Material out</span>
            <MovementList
              actionLabel="Received"
              rows={step.itemTotals.outputs.map((row) => ({
                key: row.itemId,
                name: row.itemName,
                note: row.isPrimary ? 'main output' : row.planned ? 'by-product' : 'unplanned',
                qty: qtyWithUnit(row.receivedQty, row.uomSymbol),
                muted: toNumber(row.receivedQty) === 0,
                planned: row.expectedQty ? qtyWithUnit(row.expectedQty, row.uomSymbol) : undefined,
                remaining: row.remainingQty ? qtyWithUnit(row.remainingQty, row.uomSymbol) : undefined,
              }))}
              empty="Nothing back yet."
            />
          </div>
        </div>

        {/* Three facts, on one line, in the order they are asked about: what is
            still out there, how much was lost, what it costs. */}
        <dl
          style={{
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
            margin: '14px 0 0 0',
            paddingTop: 12,
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <Fact
            term="Still out"
            value={outstanding > 0 ? qtyWithUnit(outstanding, issueUnit) : '—'}
            tone={outstanding > 0 ? '#1d4ed8' : '#111'}
          />
          <Fact
            term="Wastage"
            value={wastagePct === null ? '—' : `${wastagePct.toFixed(2)}%`}
            suffix={tolerance === null ? null : `/ ${formatQty(tolerance)}%`}
            tone={overTolerance ? '#b91c1c' : '#111'}
            hint={
              comparable
                ? undefined
                : 'Not comparable — this step moves more than one item, or returns a different unit from the one it issues.'
            }
          />
          <Fact
            term="Charge"
            value={amount === null ? '—' : formatQty(amount)}
            suffix={rate === null ? null : `${formatQty(rate)} · ${rateBasisLabel(step.rateBasis)}`}
          />
        </dl>
      </div>

      <div style={{ padding: '14px 16px', borderTop: '1px solid #eef0f3', background: '#fcfcfd' }}>
        <h4 style={{ ...columnLabel, marginBottom: 10 }}>
          What happened
          <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
            {step.totals.issueCount} issue{step.totals.issueCount === 1 ? '' : 's'} ·{' '}
            {step.totals.receiptCount} receipt{step.totals.receiptCount === 1 ? '' : 's'}
          </span>
        </h4>
        <ActivityTimeline
          events={activity}
          onOpen={onOpenDocument}
          empty="Nothing has moved on this step yet. Every challan out and every receipt back will appear here, with the items and batches each one carried."
        />
      </div>
    </section>
  );
}

interface MovementRow {
  key: string;
  name: string;
  note: string;
  qty: string;
  muted: boolean;
  planned?: string;
  remaining?: string;
}

/**
 * A table layout showing planned, remaining, and actual quantities per item.
 */
function MovementList({
  actionLabel,
  rows,
  empty,
}: {
  actionLabel: string;
  rows: MovementRow[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>{empty}</p>;
  }

  const thStyle: React.CSSProperties = {
    padding: '0 0 6px 0',
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: 500,
    textTransform: 'uppercase',
    textAlign: 'center',
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Item</th>
          <th style={{ ...thStyle }}>Plan</th>
          <th style={{ ...thStyle }}>{actionLabel}</th>
          <th style={{ ...thStyle }}>Rem</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>
              <div style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>{row.name}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>{row.note}</div>
            </td>
            <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top', textAlign: 'center', fontSize: 12, color: '#475569' }}>
              {row.planned || '—'}
            </td>
            <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top', textAlign: 'center', fontSize: 12, color: row.muted ? '#cbd5e1' : '#475569', whiteSpace: 'nowrap' }}>
              {row.qty}
            </td>
            <td style={{ padding: '6px 0', verticalAlign: 'top', textAlign: 'center', fontSize: 12, color: '#475569' }}>
              {row.remaining || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Fact({
  term,
  value,
  suffix,
  tone,
  hint,
}: {
  term: string;
  value: string;
  suffix?: string | null;
  tone?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <dt style={{ fontSize: 11, color: '#94a3b8' }}>{term}</dt>
      <dd style={{ margin: 0, fontSize: 13, color: tone ?? '#111', fontWeight: 500 }}>
        {value}
        {suffix && (
          <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>
            {suffix}
          </span>
        )}
      </dd>
    </div>
  );
}
