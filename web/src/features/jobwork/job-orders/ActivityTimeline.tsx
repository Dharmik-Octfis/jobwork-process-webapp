import { ArrowDownLeft, ArrowUpRight, History, RotateCcw } from 'lucide-react';
import { formatDate } from '../../../lib/formatDate';
import { formatQty, qtyWithUnit, toNumber } from '../jobwork.schemas';
import type { ActivityEvent, ActivityIssue, ActivityReceipt } from './jobOrders.schemas';

/**
 * 🔴 WHAT HAPPENED, in the order it happened.
 *
 * The totals elsewhere on the page answer "how much". This answers "how", and
 * they are different questions: `issued 4,800 / received 4,650` is silent about
 * whether that was one delivery or four, which batches it left in, who signed it
 * out, and that 100 of the shortfall came back as rework on the Thursday. Every
 * line here is printed off a document that already exists — nothing is
 * recomputed, and nothing is summarised twice.
 *
 * ONE ROW PER DOCUMENT, and the row is a button. A challan is a real thing with
 * its own page; reading its number and wanting to open it is the same impulse.
 *
 * 🔴 The quantities are NOT added up across items. A challan carrying 4,800 M of
 * fabric and 12 cones of thread has no total (§6.5) — the header shows the
 * document's own stored figure only where every line shares a unit, and the
 * per-item rows carry the rest.
 */
interface Props {
  events: ActivityEvent[];
  /**
   * `stepId → "2 · Dyeing"`. Supplied only by the whole-order view, which
   * interleaves several steps and would otherwise print rows nobody can place.
   */
  stepLabels?: Map<string, string>;
  onOpen: (event: ActivityEvent) => void;
  empty: string;
}

const ISSUE_COLOR = '#1d4ed8';
const RECEIPT_COLOR = '#15803d';

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

export function ActivityTimeline({ events, stepLabels, onOpen, empty }: Props) {
  if (events.length === 0) {
    // 🔴 Said in full, not as a grey half-line. "Nothing here" and "this screen
    // is broken" look identical when the answer is four faint words, and the
    // difference is the whole question somebody is asking at that moment.
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '28px 16px',
          textAlign: 'center',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#f1f5f9',
            color: '#94a3b8',
          }}
        >
          <History size={17} />
        </span>
        <p style={{ margin: 0, fontSize: 13, color: '#475569', maxWidth: 420, lineHeight: 1.6 }}>
          {empty}
        </p>
      </div>
    );
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((event, index) => (
        <Entry
          key={`${event.kind}-${event.id}`}
          event={event}
          stepLabel={stepLabels?.get(event.stepId) ?? null}
          isLast={index === events.length - 1}
          onOpen={onOpen}
        />
      ))}
    </ol>
  );
}

function Entry({
  event,
  stepLabel,
  isLast,
  onOpen,
}: {
  event: ActivityEvent;
  stepLabel: string | null;
  isLast: boolean;
  onOpen: (event: ActivityEvent) => void;
}) {
  const isIssue = event.kind === 'issue';
  const accent = isIssue ? ISSUE_COLOR : RECEIPT_COLOR;
  const cancelled = event.status === 'cancelled';
  // A cancelled document still happened, so it stays on the rail — greyed and
  // struck through rather than removed, because deleting it leaves two numbers
  // that no longer explain each other.
  const dotColor = cancelled ? '#cbd5e1' : accent;

  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      {/* The rail. A flex column so the connector stretches to whatever the row
          beside it turned out to be, rather than a guessed height. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24 }}>
        <span
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            marginTop: 10,
            borderRadius: '50%',
            background: cancelled ? '#f8fafc' : isIssue ? '#eff6ff' : '#f0fdf4',
            border: `1px solid ${cancelled ? '#e2e8f0' : dotColor}`,
            color: dotColor,
            flexShrink: 0,
          }}
        >
          {isIssue ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
        </span>
        {!isLast && <span style={{ flex: 1, width: 1, background: '#e6e9ee', minHeight: 8 }} />}
      </div>

      <button
        type="button"
        onClick={() => onOpen(event)}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'block',
          textAlign: 'left',
          font: 'inherit',
          padding: '10px 12px',
          margin: '4px 0 8px 0',
          border: '1px solid #eef0f3',
          borderLeft: `2px solid ${cancelled ? '#e2e8f0' : accent}`,
          borderRadius: 6,
          background: '#fff',
          cursor: 'pointer',
          opacity: cancelled ? 0.65 : 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ ...label, color: accent }}>{isIssue ? 'Issued' : 'Received'}</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#111',
                textDecoration: cancelled ? 'line-through' : 'none',
              }}
            >
              {event.number}
            </span>
            {stepLabel && (
              <span
                style={{
                  fontSize: 10,
                  color: '#64748b',
                  background: '#f1f5f9',
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                {stepLabel}
              </span>
            )}
            {event.kind === 'issue' && event.isRework && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  color: '#b45309',
                  background: '#fffbeb',
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                <RotateCcw size={9} /> Rework · attempt {event.attemptNo}
              </span>
            )}
            {cancelled && (
              <span
                style={{
                  fontSize: 10,
                  color: '#b91c1c',
                  background: '#fef2f2',
                  padding: '1px 6px',
                  borderRadius: 8,
                }}
              >
                Cancelled
              </span>
            )}
          </span>
          <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
            {formatDate(event.date)}
          </span>
        </div>

        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {isIssue ? 'to' : 'from'} {event.partyName ?? 'processor'}
          {event.kind === 'receipt' && event.againstChallans.length > 0 && (
            <> · against {event.againstChallans.join(', ')}</>
          )}
        </div>

        <div style={{ marginTop: 8 }}>
          {event.kind === 'issue' ? <IssueLines event={event} /> : <ReceiptLines event={event} />}
        </div>

        {event.remarks && (
          <p style={{ fontSize: 11, color: '#64748b', margin: '8px 0 0 0', lineHeight: 1.5 }}>
            “{event.remarks}”
          </p>
        )}

        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>by {event.actorName}</div>
      </button>
    </li>
  );
}

/** One line per item that left, each in its own unit and naming its batch. */
function IssueLines({ event }: { event: ActivityIssue }) {
  if (event.lines.length === 0) {
    return <MovementRow name="Nothing on this challan" detail={null} qty={null} />;
  }
  return (
    <>
      {event.lines.map((line) => (
        <MovementRow
          key={line.id}
          name={line.itemName}
          detail={line.batchRef ?? 'Untracked stock'}
          qty={qtyWithUnit(line.qty, line.uomSymbol)}
        />
      ))}
    </>
  );
}

/**
 * One line per item that came back — and the disposition beneath it, which is the
 * whole reason somebody opens a receipt.
 *
 * 🔴 The split is only printed when it is not the whole quantity. "4,650
 * received, 4,650 accepted" is the ordinary case and saying it twice trains
 * people to stop reading the line that matters — the one where 100 went to
 * rework.
 */
function ReceiptLines({ event }: { event: ActivityReceipt }) {
  return (
    <>
      {event.outputs.map((output) => {
        const received = toNumber(output.receivedQty);
        const accepted = toNumber(output.acceptedQty);
        const rework = toNumber(output.reworkQty);
        const scrap = toNumber(output.scrapQty);
        const split = rework > 0 || scrap > 0 || accepted !== received;
        const batchRefs = output.batches
          .map((batch) => batch.batchRef)
          .filter((ref): ref is string => Boolean(ref));

        return (
          <div key={output.id} style={{ marginBottom: 4 }}>
            <MovementRow
              name={output.itemName}
              detail={batchRefs.length > 0 ? `→ ${[...new Set(batchRefs)].join(', ')}` : null}
              qty={qtyWithUnit(received, output.uomSymbol)}
            />
            {split && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 11,
                  marginTop: 2,
                  paddingLeft: 2,
                }}
              >
                <Disposition color="#15803d" text={`${formatQty(accepted)} accepted`} />
                {rework > 0 && <Disposition color="#b45309" text={`${formatQty(rework)} rework`} />}
                {scrap > 0 && <Disposition color="#b91c1c" text={`${formatQty(scrap)} scrap`} />}
                {output.reason && <span style={{ color: '#94a3b8' }}>· {output.reason}</span>}
              </div>
            )}
          </div>
        );
      })}
      {toNumber(event.returnedQty) > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {/* It never entered our stock, so it has no batch and no ledger row —
              which is exactly why it has to be said in words. */}
          {formatQty(event.returnedQty)} sent straight back — never taken into stock
        </div>
      )}
    </>
  );
}

function Disposition({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color }}>
      <span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      {text}
    </span>
  );
}

function MovementRow({
  name,
  detail,
  qty,
}: {
  name: string;
  detail: string | null;
  qty: string | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
        fontSize: 12,
      }}
    >
      <span style={{ color: '#334155', minWidth: 0 }}>
        {name}
        {detail && <span style={{ color: '#94a3b8', fontSize: 11 }}> · {detail}</span>}
      </span>
      {qty && <span style={{ color: '#111', fontWeight: 500, whiteSpace: 'nowrap' }}>{qty}</span>}
    </div>
  );
}
