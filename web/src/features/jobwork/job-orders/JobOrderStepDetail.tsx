import { useState } from 'react';
import { AlertTriangle, PackageCheck, Send, Check } from 'lucide-react';
import { formatDate } from '../../../lib/formatDate';
import {
  STEP_STATUS_META,
  formatQty,
  processorTypeLabel,
  qtyWithUnit,
  statusMeta,
  toNumber,
} from '../jobwork.schemas';
import type { ActivityEvent, OverviewStep } from './jobOrders.schemas';

interface Props {
  step: OverviewStep;
  /**
   * This step's documents only — the SERVER filtered by `stepId`, and this is
   * one page of the result, oldest-first. It is no longer the whole history:
   * `hasOlderActivity` says whether there is more behind it.
   */
  activity: ActivityEvent[];
  activityLoading?: boolean;
  hasOlderActivity?: boolean;
  isLoadingOlderActivity?: boolean;
  onLoadOlderActivity?: () => void;
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
  activityLoading = false,
  hasOlderActivity = false,
  isLoadingOlderActivity = false,
  onLoadOlderActivity,
  onIssue,
  onReceive,
  onComplete,
  onOpenDocument,
}: Props) {
  const meta = statusMeta(STEP_STATUS_META, step.status);

  // The principal input's and primary output's units, read off the two lists —
  // the four scalars that used to mirror them went with Migration B (2026-08-12).

  const primaryOutput = step.outputs.find((row) => row.isPrimary) ?? step.outputs[0];
  const receiveUom = primaryOutput?.uom;
  const receiveUnit = receiveUom ? (receiveUom.symbol ?? receiveUom.unitName) : '';

  const settled = step.status === 'completed' || step.status === 'short_closed';

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
            <span style={columnLabel}>Material Issue</span>
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
                remaining: row.remainingQty
                  ? qtyWithUnit(row.remainingQty, row.uomSymbol)
                  : undefined,
              }))}
              empty="Nothing issued yet."
            />
          </div>
          <div style={{ width: 1, background: '#e2e8f0' }} />
          <div>
            <span style={columnLabel}>Material Receive</span>
            <MovementList
              actionLabel="Received"
              rows={step.itemTotals.outputs.map((row) => ({
                key: row.itemId,
                name: row.itemName,
                note: row.isPrimary ? 'main output' : row.planned ? 'by-product' : 'unplanned',
                qty: qtyWithUnit(row.receivedQty, row.uomSymbol),
                muted: toNumber(row.receivedQty) === 0,
                planned: row.expectedQty ? qtyWithUnit(row.expectedQty, row.uomSymbol) : undefined,
                remaining: row.remainingQty
                  ? qtyWithUnit(row.remainingQty, row.uomSymbol)
                  : undefined,
              }))}
              empty="Nothing back yet."
            />
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px', borderTop: '1px solid #eef0f3', background: '#fcfcfd' }}>
        {hasOlderActivity && onLoadOlderActivity && (
          <ShowEarlierActivity onClick={onLoadOlderActivity} isLoading={isLoadingOlderActivity} />
        )}
        {activityLoading ? (
          <div style={{ fontSize: 13, color: '#64748b' }}>Loading activity…</div>
        ) : (
          <ActivityTabs events={activity} onOpen={onOpenDocument} />
        )}
      </div>
    </section>
  );
}

/**
 * Sits ABOVE the feed, because that is where the events it loads appear — the
 * feed is paged from the newest end, so "earlier" means further up.
 *
 * A real `<button>`, so it is in the tab order and answers Enter and Space
 * without a keydown handler (CLAUDE.md, "Tab navigation is mandatory").
 */
export function ShowEarlierActivity({
  onClick,
  isLoading,
}: {
  onClick: () => void;
  isLoading: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 10px 0' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isLoading}
        style={{
          border: '1px solid #e2e8f0',
          background: '#fff',
          borderRadius: 999,
          padding: '5px 14px',
          fontSize: 12,
          color: '#475569',
          cursor: isLoading ? 'default' : 'pointer',
        }}
      >
        {isLoading ? 'Loading…' : 'Show earlier activity'}
      </button>
    </div>
  );
}

export function ActivityTabs({
  events,
  onOpen,
}: {
  events: ActivityEvent[];
  onOpen: (event: ActivityEvent) => void;
}) {
  const [activeTab, setActiveTab] = useState<'issue' | 'receipt' | null>(null);
  const issues = events.filter((e) => e.kind === 'issue');
  const receipts = events.filter((e) => e.kind === 'receipt');

  const activeEvents = activeTab === 'issue' ? issues : activeTab === 'receipt' ? receipts : [];

  const handleToggle = () => {
    if (activeTab) {
      setActiveTab(null);
    } else {
      setActiveTab(issues.length > 0 ? 'issue' : 'receipt');
    }
  };

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, background: '#fff' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'stretch',
          borderBottom: activeTab ? '1px solid #eef0f3' : '1px solid transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'issue' ? null : 'issue')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'issue' ? '3px solid #2563eb' : '3px solid transparent',
              fontSize: 14,
              fontWeight: 600,
              color: activeTab === 'issue' ? '#1e293b' : '#64748b',
              cursor: 'pointer',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            Issues
            <span
              style={{
                fontSize: 12,
                background: '#f1f5f9',
                color: '#3b82f6',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              {issues.length}
            </span>
          </button>

          <div style={{ width: 2, background: '#e2e8f0', margin: '12px 0', borderRadius: 2 }} />

          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'receipt' ? null : 'receipt')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'receipt' ? '3px solid #2563eb' : '3px solid transparent',
              fontSize: 14,
              fontWeight: 600,
              color: activeTab === 'receipt' ? '#1e293b' : '#64748b',
              cursor: 'pointer',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            Receives
            <span
              style={{
                fontSize: 12,
                background: '#f1f5f9',
                color: '#3b82f6',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              {receipts.length}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          style={{
            background: 'none',
            border: 'none',
            padding: '0 16px',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            style={{
              transform: activeTab ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {activeTab && (
        <div style={{ padding: '0 16px 16px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    fontSize: 12,
                    color: '#64748b',
                    paddingBottom: 8,
                    fontWeight: 500,
                    borderBottom: '1px solid #eef0f3',
                  }}
                >
                  Date
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    fontSize: 12,
                    color: '#64748b',
                    paddingBottom: 8,
                    fontWeight: 500,
                    borderBottom: '1px solid #eef0f3',
                  }}
                >
                  {activeTab === 'issue' ? 'Issue Number' : 'Receive Number'}
                </th>
              </tr>
            </thead>
            <tbody>
              {activeEvents.map((event) => (
                <tr key={event.id}>
                  <td
                    style={{
                      padding: '12px 0',
                      fontSize: 13,
                      color: '#334155',
                      borderBottom: '1px solid #f8fafc',
                    }}
                  >
                    {formatDate(event.date)}
                  </td>
                  <td
                    style={{ padding: '12px 0', fontSize: 13, borderBottom: '1px solid #f8fafc' }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(event)}
                      style={{
                        color: '#2563eb',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {event.number}
                    </button>
                  </td>
                </tr>
              ))}
              {activeEvents.length === 0 && (
                <tr>
                  <td
                    colSpan={2}
                    style={{
                      padding: '24px 0',
                      textAlign: 'center',
                      fontSize: 13,
                      color: '#94a3b8',
                    }}
                  >
                    No {activeTab === 'issue' ? 'issues' : 'receives'} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
            <td
              style={{
                padding: '6px 8px 6px 0',
                verticalAlign: 'top',
                textAlign: 'center',
                fontSize: 12,
                color: '#475569',
              }}
            >
              {row.planned || '—'}
            </td>
            <td
              style={{
                padding: '6px 8px 6px 0',
                verticalAlign: 'top',
                textAlign: 'center',
                fontSize: 12,
                color: row.muted ? '#cbd5e1' : '#475569',
                whiteSpace: 'nowrap',
              }}
            >
              {row.qty}
            </td>
            <td
              style={{
                padding: '6px 0',
                verticalAlign: 'top',
                textAlign: 'center',
                fontSize: 12,
                color: '#475569',
              }}
            >
              {row.remaining || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
