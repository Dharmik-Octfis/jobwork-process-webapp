import { AlertTriangle, PackageCheck, Send } from 'lucide-react';
import { rateBasisLabel } from '../processes/processes.schemas';
import {
  STEP_STATUS_META,
  formatQty,
  processorTypeLabel,
  statusMeta,
  toNumber,
} from '../jobwork.schemas';
import type { OverviewStep } from './jobOrders.schemas';

interface Props {
  step: OverviewStep;
  onIssue: (step: OverviewStep) => void;
  onReceive: (step: OverviewStep) => void;
  onViewIssues: (step: OverviewStep) => void;
  onViewReceipts: (step: OverviewStep) => void;
}

const metaLabel: React.CSSProperties = { fontSize: 11, color: '#94a3b8', display: 'block' };
const metaValue: React.CSSProperties = { fontSize: 13, color: '#111' };

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

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  color: '#0062ff',
  cursor: 'pointer',
};

interface FlowRow {
  key: string;
  name: string;
  unit: string | null;
  tag: string;
  values: string[];
}

/**
 * One side of a step's movement, item by item.
 *
 * A real `<table>` rather than a grid of divs: these are rows of numbers with
 * column headings, which is what a table is for, and it is what makes a screen
 * reader announce "Thread, still out, 5" instead of reading eleven loose numbers
 * in a row.
 *
 * It scrolls inside itself. Five numeric columns plus a name will not fit a
 * phone, and the alternative — dropping columns at narrow widths — hides the
 * number somebody opened the page for.
 */
function FlowTable({
  title,
  columns,
  rows,
  empty,
}: {
  title: string;
  columns: string[];
  rows: FlowRow[];
  empty: string;
}) {
  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, background: '#fcfcfd' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid #eef0f3',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: '#64748b',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, padding: '10px' }}>{empty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...flowTh, textAlign: 'left' }}>Item</th>
                {columns.map((column) => (
                  <th key={column} style={flowTh}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td style={{ ...flowTd, textAlign: 'left' }}>
                    <span style={{ color: '#111', fontWeight: 500 }}>{row.name}</span>
                    {row.unit && <span style={{ color: '#94a3b8' }}> · {row.unit}</span>}
                    <span style={{ display: 'block', fontSize: 10, color: '#94a3b8' }}>
                      {row.tag}
                    </span>
                  </td>
                  {row.values.map((value, index) => (
                    <td key={index} style={{ ...flowTd, color: '#334155' }}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const flowTh: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const flowTd: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  borderTop: '1px solid #f1f5f9',
};

/**
 * The one step you are working on — everything the rail deliberately left out.
 *
 * 🔴 `[+ Issue]` IS NOT ENABLED BY THE STATUS. A step can be perfectly ready on
 * paper and have nothing to send. It used to require a positive ledger balance;
 * while Purchase Received is missing that rule is relaxed (see `canIssue` in
 * `jobOrders.service.ts`), but the CHAIN still holds — a step fed by an earlier
 * one cannot issue until that step has returned something.
 *
 * Whenever it is off, the reason is printed beside it. A greyed-out button with
 * no explanation is how someone concludes the software is broken.
 *
 * `[+ Receive]` appears only once something is actually out there — an
 * outstanding balance against this step. Offering it before anything was issued
 * invites a receipt of goods that never left.
 */
export function JobOrderStepDetail({
  step,
  onIssue,
  onReceive,
  onViewIssues,
  onViewReceipts,
}: Props) {
  const meta = statusMeta(STEP_STATUS_META, step.status);
  const issued = toNumber(step.totals.issuedQty);
  const received = toNumber(step.totals.receivedQty);
  const returned = toNumber(step.totals.returnedQty);
  const tolerance = step.tolerancePct === null ? null : toNumber(step.tolerancePct);

  // The primary output's unit, read off the PRODUCES list — the four scalars
  // that used to mirror it went with Migration B (2026-08-12).
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
  /**
   * 🔴 One item in, one item out, same unit — otherwise there is no subtraction
   * to do. "Issued − received" across three inputs and two outputs is not a
   * quantity at all, and a number printed here would be acted on.
   */
  const comparable =
    step.itemTotals.inputs.length <= 1 &&
    step.itemTotals.outputs.length <= 1 &&
    (!primaryOutput?.uomId || primaryOutput.uomId === step.inputs[0]?.uomId);
  const lost = issued - received - returned;
  const wastagePct = settled && comparable && issued > 0 ? (lost / issued) * 100 : null;
  const overTolerance = wastagePct !== null && tolerance !== null ? wastagePct > tolerance : false;

  // Mirrors `processCharge` in jobReceipts.service.ts — keep the two in step, or
  // this preview disagrees with what the receipt actually bills. The `lump_sum`
  // case went with that basis on 2026-08-10.
  const rate = step.rate === null ? null : toNumber(step.rate);
  const chargeQty = step.rateBasis === 'per_received_unit' ? received : issued;
  const amount = rate === null ? null : rate * chargeQty;

  const reworkPending = toNumber(step.totals.reworkQty) > 0;

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, background: '#fff' }}>
      <div
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
              {/* 🔴 The REASON, not just a disabled button. A greyed-out control
                  with no explanation is how somebody concludes the software is
                  broken. */}
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
        </div>
      </div>

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
              marginBottom: 12,
            }}
          >
            <AlertTriangle size={14} color="#b45309" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
              {formatQty(step.totals.reworkQty)} {receiveUnit} came back needing rework. It sits in
              its own lot — issue it back to this step to run it again.
            </span>
          </div>
        )}

        {/*
          🔴 ONE ROW PER ITEM, each in its OWN unit (§5.7, §6.5).
          A step consumes a set and returns a set, and the two are unrelated in
          length and in unit — three items in and two out is normal. A single
          "Issued / Received" pair could only ever describe one of them, so it
          described the principal one and quietly hid the rest.
        */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {/*
            🔴 WHAT HAPPENED, not what was meant to happen.
            The plan is not repeated here. It is on the step when you edit the
            order, and — where it actually matters — in the Issue dialog, which
            shows planned, already issued, remaining and the tolerance ceiling at
            the moment somebody decides how much to send. Carrying it here as well
            is the same number in two places, free to be read as a target the step
            is failing.
          */}
          <FlowTable
            title="Consumed"
            columns={['Issued']}
            rows={step.itemTotals.inputs.map((row) => ({
              key: row.itemId,
              name: row.itemName,
              unit: row.uomSymbol,
              tag: row.planned ? (row.fromStock ? 'From stock' : 'From earlier step') : 'Rework',
              values: [formatQty(row.issuedQty)],
            }))}
            empty="Nothing issued yet."
          />
          <FlowTable
            title="Produced"
            columns={['Received']}
            rows={step.itemTotals.outputs.map((row) => ({
              key: row.itemId,
              name: row.itemName,
              unit: row.uomSymbol,
              tag: row.isPrimary ? 'Main' : row.planned ? 'By-product' : 'Unplanned',
              values: [formatQty(row.receivedQty)],
            }))}
            empty="Nothing back yet."
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
            marginTop: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <span style={metaLabel}>Wastage</span>
              <span
                style={{ ...metaValue, color: overTolerance ? '#b91c1c' : '#111' }}
                title={
                  comparable
                    ? undefined
                    : 'Not comparable — this step moves more than one item, or returns a different unit from the one it issues.'
                }
              >
                {wastagePct === null ? '—' : `${wastagePct.toFixed(2)}%`}
                {tolerance !== null && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}> / {formatQty(tolerance)}%</span>
                )}
              </span>
            </div>
            <div>
              <span style={metaLabel}>Charge</span>
              <span style={metaValue}>
                {amount === null ? '—' : formatQty(amount)}
                {rate !== null && (
                  <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
                    {formatQty(rate)} · {rateBasisLabel(step.rateBasis)}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button type="button" onClick={() => onViewIssues(step)} style={linkButton}>
              {step.totals.issueCount} issue{step.totals.issueCount === 1 ? '' : 's'}
            </button>
            <span style={{ color: '#cbd5e1' }}>·</span>
            <button type="button" onClick={() => onViewReceipts(step)} style={linkButton}>
              {step.totals.receiptCount} receipt{step.totals.receiptCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
