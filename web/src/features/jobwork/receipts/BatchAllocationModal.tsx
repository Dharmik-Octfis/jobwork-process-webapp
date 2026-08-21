import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Search, Truck, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { ReceiptBatchOption } from './jobReceipts.schemas';

/**
 * ADD BATCHES (RECEIVE) — which batches the goods coming back land in.
 *
 * 🔴 THIS IS NOT THE ISSUE DIALOG'S GRID, and the difference is the whole point.
 * `issues/AddBatchesModal.tsx` asks "which existing stock am I taking, and is
 * there enough" — every row is bounded by a balance at one godown. This one asks
 * "what shall this new stock be called", and there is no ceiling at all: the
 * receipt CREATES the quantity. Sharing one component is precisely how the
 * availability logic leaks into a screen that has no availability.
 *
 * A row is one of two things:
 *
 *   · a NEW batch under a label somebody types — the normal case, because what a
 *     processor returns is physically new and has no number of its own;
 *   · an EXISTING batch to add to — the second half of a split delivery. 500 m of
 *     dye lot 23 today, 500 m tomorrow. Without it the second delivery can only
 *     become a second batch carrying the same label, and a recall on lot 23 then
 *     finds half the stock.
 *
 * 🔴 THE LIST OF EXISTING BATCHES IS SCOPED BY PROVENANCE, NOT BY LOCATION. The
 * batch a follow-up delivery continues has often already been issued onward, so
 * "what is in this godown" hides exactly the row that is wanted — and offers
 * every unrelated batch of the item that happens to be sitting there. Where each
 * batch IS shows on the row instead, which is the fact the location filter was
 * reaching for, without it ever removing the right answer.
 */

/** Same ceiling as the issue grid — a hundred allocation rows on one line is
 * already past what anyone reconciles by eye. */
const MAX_ROWS = 100;

/** Blank rows the grid opens with, so allocating three batches is type-Tab-type
 * and never a trip back to "+ Add row" between each one. */
const DEFAULT_BLANK_ROWS = 3;

export interface BatchAllocation {
  /** Set when an existing batch was picked. */
  batchId: string | null;
  /** The label — typed for a new batch, copied from the picked one otherwise. */
  batchReference: string;
  qty: number;
  /** The picked batch, kept whole rather than by id: the option list is a search
   * result and a chosen batch can drop out of it on the next keystroke, leaving
   * the row with nothing to render. */
  option: ReceiptBatchOption | null;
}

interface DraftRow extends BatchAllocation {
  id: string;
}

let rowSeq = 0;
const blankRow = (): DraftRow => ({
  id: `alloc-${rowSeq++}`,
  batchId: null,
  batchReference: '',
  qty: 0,
  option: null,
});

function seedRows(existing: readonly BatchAllocation[]): DraftRow[] {
  const rows = existing.map((row) => ({ ...row, id: `alloc-${rowSeq++}` }));
  const blanks = Math.max(DEFAULT_BLANK_ROWS - rows.length, rows.length > 0 ? 1 : 0);
  return [...rows, ...Array.from({ length: blanks }, blankRow)];
}

/** A row counts once it has a label — either typed or inherited from a pick. */
const isFilled = (row: DraftRow) => row.batchReference.trim().length > 0 || row.batchId !== null;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** `accepted` or `rework`. Only the wording and the target change; the two are
   * otherwise the same grid, and they must never share a batch. */
  kind: 'accepted' | 'rework';
  itemName: string;
  uomLabel: string;
  /** Where this receipt is being received into. Stated once above the grid: every
   * batch on the grid lands here, whatever it already holds elsewhere. */
  locationName: string | null;
  /** The quantity this grid has to account for, exactly. */
  targetQty: number;
  /** True when the item is batch-tracked, so every row needs a real label. An
   * untracked item's batches are ledger plumbing nobody ever sees. */
  requiresReference: boolean;
  rows: BatchAllocation[];
  onSave: (rows: BatchAllocation[]) => void;
  /** Batches already spoken for by the OTHER side of this item — accepted and
   * rework may never land in the same batch. */
  blockedBatchIds: readonly string[];
  options: ReceiptBatchOption[];
  otherOptions: ReceiptBatchOption[];
  isOtherCapped: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  isLoading: boolean;
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 10.5,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  color: '#334155',
  verticalAlign: 'top',
};

export function BatchAllocationModal({
  isOpen,
  onClose,
  kind,
  itemName,
  uomLabel,
  locationName,
  targetQty,
  requiresReference,
  rows: initialRows,
  onSave,
  blockedBatchIds,
  options,
  otherOptions,
  isOtherCapped,
  search,
  onSearchChange,
  isLoading,
}: Props) {
  /** Seeded once, on mount — so the caller mounts this only while open and keys
   * it on the row, the same contract the issue grid carries. */
  const [rows, setRows] = useState<DraftRow[]>(() => seedRows(initialRows));
  const [expanded, setExpanded] = useState<string | null>(null);

  const allocated = useMemo(
    () => rows.reduce((sum, row) => (isFilled(row) ? sum + row.qty : sum), 0),
    [rows],
  );
  const remaining = Number((targetQty - allocated).toFixed(4));
  /**
   * 🔴 WITH NO QUANTITY TYPED YET, THIS GRID SETS IT.
   *
   * The same contract as the issue dialog's Add Batches: the operator opens the
   * picker first, names the batches the delivery arrived in, and the quantity
   * follows from them. Checking against a target of zero would refuse every row
   * and leave the link on the grid opening a dialog that can never save — which
   * is what a `qty > 0` gate on the link was hiding.
   *
   * Once a quantity exists it is both the ceiling and the floor, unchanged.
   */
  const definesTarget = targetQty <= 0;
  const matches = definesTarget ? allocated > 0 : Math.abs(remaining) < 0.00005;

  const setRow = (id: string, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  /**
   * Picking a batch fills the row with everything still unallocated, so the
   * common case — one batch for the whole quantity — is one click and no typing.
   * Measured against the OTHER rows, so re-picking a row that already held 200
   * offers the full outstanding amount again rather than subtracting itself.
   */
  const pickBatch = (id: string, option: ReceiptBatchOption) =>
    setRows((prev) => {
      const elsewhere = prev.reduce(
        (sum, row) => (row.id !== id && isFilled(row) ? sum + row.qty : sum),
        0,
      );
      const fill = Math.max(0, Number((targetQty - elsewhere).toFixed(4)));
      return prev.map((row) =>
        row.id === id
          ? {
              ...row,
              batchId: option.batchId,
              batchReference: option.supplierBatchRef ?? '',
              option,
              qty: row.qty > 0 ? row.qty : fill,
            }
          : row,
      );
    });

  /** Typing a label makes the row a NEW batch, which means dropping any batch it
   * was pointing at — the two are alternatives, never a label ON an existing
   * batch (that would be renaming somebody else's batch from inside a receipt). */
  const typeReference = (id: string, batchReference: string) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              batchReference,
              batchId: null,
              option: null,
              qty:
                row.qty > 0
                  ? row.qty
                  : Math.max(
                      0,
                      Number(
                        (
                          targetQty -
                          prev.reduce(
                            (sum, other) =>
                              other.id !== id && isFilled(other) ? sum + other.qty : sum,
                            0,
                          )
                        ).toFixed(4),
                      ),
                    ),
            }
          : row,
      ),
    );

  /** Clear, don't delete — a control that yanks a row out from under the cursor
   * moves every row below it mid-entry. An already-blank row has nothing to
   * clear, so there the same control drops it. */
  const clearOrRemoveRow = (id: string) =>
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row && isFilled(row)) {
        return prev.map((r) =>
          r.id === id ? { ...r, batchId: null, batchReference: '', option: null, qty: 0 } : r,
        );
      }
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [blankRow()];
    });

  const filledRows = rows.filter(isFilled);

  /** Rows a batch-tracked item cannot save: a quantity against no label at all. */
  const unlabelled = requiresReference
    ? rows.filter((row) => row.qty > 0 && !row.batchReference.trim())
    : [];

  /** The same batch twice, or one already taken by the other disposition. */
  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const row of rows) {
      if (!row.batchId) continue;
      if (seen.has(row.batchId) || blockedBatchIds.includes(row.batchId)) dupes.add(row.id);
      seen.add(row.batchId);
    }
    return dupes;
  }, [rows, blockedBatchIds]);

  /**
   * 🔴 A SOFT WARNING, NEVER A BLOCK. `supplierBatchRef` is deliberately not
   * unique — two processors can both call their lot "23", and two genuine
   * deliveries of one supplier batch are normal. But once "create new" and "pick
   * existing" sit in one grid, somebody will type a label that already exists and
   * make a twin without meaning to. Naming it and offering the switch is what
   * prevents that; refusing it would be wrong about a third of the time.
   */
  const lookalikes = useMemo(() => {
    const byRef = new Map<string, ReceiptBatchOption>();
    for (const option of [...options, ...otherOptions]) {
      const ref = option.supplierBatchRef?.trim().toLowerCase();
      if (ref) byRef.set(ref, option);
    }
    const hits = new Map<string, ReceiptBatchOption>();
    for (const row of rows) {
      if (row.batchId) continue;
      const match = byRef.get(row.batchReference.trim().toLowerCase());
      if (match) hits.set(row.id, match);
    }
    return hits;
  }, [rows, options, otherOptions]);

  const canSave = matches && unlabelled.length === 0 && duplicateIds.size === 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave(
      filledRows
        .filter((row) => row.qty > 0)
        .map(({ batchId, batchReference, qty, option }) => ({
          batchId,
          batchReference: batchReference.trim(),
          qty,
          option,
        })),
    );
    onClose();
  };

  const noun = kind === 'accepted' ? 'accepted' : 'rework';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={kind === 'accepted' ? 'Add Batches' : 'Add Rework Batches'}
      width={1040}
      footer={
        <>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              padding: '6px 20px',
              background: canSave ? '#15803d' : '#f1f5f9',
              color: canSave ? '#fff' : '#94a3b8',
              border: 'none',
              borderRadius: 4,
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 20px',
              background: '#fff',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          {!canSave && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#b91c1c' }}>
              {duplicateIds.size > 0
                ? 'A batch is used twice, or is already taken by the other disposition.'
                : unlabelled.length > 0
                  ? 'Every batch of a tracked item needs a reference.'
                  : definesTarget
                    ? 'Name at least one batch and how much of it came back.'
                    : `The batches must add up to the ${noun} quantity.`}
            </span>
          )}
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#f8fafc',
          border: '1px solid #eef0f3',
          borderRadius: 4,
          fontSize: 13,
          color: '#334155',
        }}
      >
        <Truck size={14} color="#64748b" />
        <span style={{ color: '#64748b' }}>Received into :</span>
        <span style={{ fontWeight: 500 }}>{locationName ?? '—'}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          — every batch below lands here, whatever it already holds elsewhere.
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
          padding: '14px 2px 16px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <div>
          <div style={{ fontSize: 15, color: '#111' }}>{itemName}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {kind === 'accepted' ? 'Accepted goods' : 'Rework — kept in its own batch'}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, color: '#334155' }}>
          {definesTarget ? (
            <>
              <span style={{ color: '#64748b' }}>
                {kind === 'accepted' ? 'Accepted' : 'Rework'} quantity :
              </span>{' '}
              <span style={{ fontWeight: 600 }}>
                {formatQty(allocated)} {uomLabel}
              </span>
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>
                Taken from the batches below — nothing was typed on the row yet.
              </div>
            </>
          ) : (
            <>
              <span style={{ color: '#64748b' }}>
                {kind === 'accepted' ? 'Accepted' : 'Rework'} quantity :
              </span>{' '}
              {formatQty(targetQty)} {uomLabel}
              <span style={{ color: '#e2e8f0', margin: '0 10px' }}>|</span>
              <span style={{ color: '#64748b' }}>Still to allocate :</span>{' '}
              <span style={{ color: matches ? '#15803d' : '#b45309', fontWeight: 600 }}>
                {formatQty(remaining)} {uomLabel}
              </span>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {/* No minWidth and no overflow: the columns below are percentages that add
            up to 100%, so the grid fits the dialog at every size instead of
            growing a horizontal scrollbar inside it. */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '32%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid #eef0f3' }}>
              <th style={{ ...th, ...(requiresReference ? { color: '#b91c1c' } : {}) }} scope="col">
                Batch Reference{requiresReference ? '*' : ''}
              </th>
              <th style={th} scope="col">
                Type
              </th>
              <th style={th} scope="col">
                Where it is now
              </th>
              <th style={{ ...th, textAlign: 'right', color: '#b91c1c' }} scope="col">
                Quantity*
              </th>
              <th style={th} scope="col">
                <span style={{ position: 'absolute', left: -9999 }}>Clear row</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lookalike = lookalikes.get(row.id);
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...td, padding: '8px 10px 8px 0' }}>
                    <BatchCell
                      row={row}
                      onPick={(option) => pickBatch(row.id, option)}
                      onType={(value) => typeReference(row.id, value)}
                      focusAfterPickId={`alloc-qty-${row.id}`}
                      options={options.filter(
                        (option) =>
                          !blockedBatchIds.includes(option.batchId) &&
                          !rows.some(
                            (other) => other.id !== row.id && other.batchId === option.batchId,
                          ),
                      )}
                      otherOptions={otherOptions.filter(
                        (option) =>
                          !blockedBatchIds.includes(option.batchId) &&
                          !rows.some(
                            (other) => other.id !== row.id && other.batchId === option.batchId,
                          ),
                      )}
                      isOtherCapped={isOtherCapped}
                      uomLabel={uomLabel}
                      search={search}
                      onSearchChange={onSearchChange}
                      isLoading={isLoading}
                      isInvalid={
                        duplicateIds.has(row.id) ||
                        (requiresReference && row.qty > 0 && !row.batchReference.trim())
                      }
                    />
                    {lookalike && (
                      <button
                        type="button"
                        onClick={() => pickBatch(row.id, lookalike)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          marginTop: 6,
                          padding: '4px 6px',
                          fontSize: 11.5,
                          textAlign: 'left',
                          color: '#92400e',
                          background: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>A batch with this reference already exists. Add to it instead?</span>
                      </button>
                    )}
                  </td>

                  <td style={td}>
                    {!isFilled(row) ? (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 999,
                          background: row.batchId ? '#eff6ff' : '#f0fdf4',
                          color: row.batchId ? '#1d4ed8' : '#15803d',
                        }}
                      >
                        {row.batchId ? 'Existing' : 'New'}
                      </span>
                    )}
                  </td>

                  <td style={td}>
                    {row.option ? (
                      <LocationBreakdown
                        option={row.option}
                        uomLabel={uomLabel}
                        isExpanded={expanded === row.id}
                        onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                      />
                    ) : (
                      <span style={{ color: '#94a3b8' }}>
                        {isFilled(row) ? 'New batch — nothing yet' : '—'}
                      </span>
                    )}
                  </td>

                  <td style={{ ...td, textAlign: 'right' }}>
                    <input
                      id={`alloc-qty-${row.id}`}
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      disabled={!isFilled(row)}
                      value={row.qty || ''}
                      onChange={(e) => setRow(row.id, { qty: Number(e.target.value) || 0 })}
                      aria-label={
                        isFilled(row)
                          ? `Quantity into batch ${row.batchReference || 'this batch'}`
                          : 'Quantity — name or pick a batch first'
                      }
                      style={{
                        width: 130,
                        padding: '6px 8px',
                        fontSize: 13,
                        textAlign: 'right',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        minHeight: 32,
                        background: isFilled(row) ? '#fff' : '#f8fafc',
                      }}
                    />
                  </td>

                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => clearOrRemoveRow(row.id)}
                      title={isFilled(row) ? 'Clear this row' : 'Remove this row'}
                      aria-label={isFilled(row) ? 'Clear this row' : 'Remove this row'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        border: 'none',
                        borderRadius: '50%',
                        background: 'transparent',
                        color: '#cbd5e1',
                        cursor: 'pointer',
                      }}
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginTop: 16,
        }}
      >
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, blankRow()])}
          disabled={rows.length >= MAX_ROWS}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 2px',
            fontSize: 13,
            fontWeight: 500,
            color: rows.length >= MAX_ROWS ? '#94a3b8' : '#0062ff',
            background: 'none',
            border: 'none',
            cursor: rows.length >= MAX_ROWS ? 'not-allowed' : 'pointer',
          }}
        >
          <Plus size={14} /> Add another batch
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Batches: {filledRows.length}/{MAX_ROWS}
        </span>
      </div>
    </Modal>
  );
}

/**
 * WHERE A BATCH IS, collapsed to one line with the detail behind a real button.
 *
 * 🔴 Internal and external are shown apart, never as one total. Goods at a
 * processor are our stock at their location (§5.4), so they arrive here as a
 * balance like any other — and "700 m" that is really 500 in the godown and 200
 * still at the dyer's reads as stock on hand when it is not.
 *
 * A `<button>` rather than a hover tooltip: a control you cannot reach with Tab
 * is not done, and nothing in `tsc -b` or a screenshot would say so.
 */
function LocationBreakdown({
  option,
  uomLabel,
  isExpanded,
  onToggle,
}: {
  option: ReceiptBatchOption;
  uomLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const rows = option.byLocation;
  const external = toNumber(option.externalQty);

  if (rows.length === 0) {
    return (
      <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
        Nothing on hand — issued onward, and continuing here
      </span>
    );
  }

  const first = rows[0]!;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 4px 2px 0',
          fontSize: 12.5,
          color: '#334155',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>
          {formatQty(first.qty)} {uomLabel} in {first.locationName ?? 'a location'}
          {rows.length > 1 ? ` +${rows.length - 1}` : ''}
        </span>
      </button>

      {external > 0 && !isExpanded && (
        <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 2 }}>
          {formatQty(external)} {uomLabel} still out with a processor
        </div>
      )}

      {isExpanded && (
        <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
          {rows.map((location) => (
            <li
              key={location.locationId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: 12,
                color: location.isExternal ? '#b45309' : '#475569',
                padding: '2px 0',
              }}
            >
              <span>
                {location.locationName ?? '—'}
                {location.isExternal ? ' (with processor)' : ''}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatQty(location.qty)} {uomLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MENU_WIDTH = 420;
const MENU_MAX_HEIGHT = 320;
/** Above `Modal`'s overlay (1100) — the menu is a sibling of it on `document.body`. */
const MENU_Z_INDEX = 1200;
const MENU_MIN_HEIGHT = 190;

/** What a batch is called on screen. `batchNumber` is internal and never a
 * fallback (2026-08-14); a batch with no reference gets a dated placeholder. */
function optionLabel(option: ReceiptBatchOption): string {
  const date = new Date(option.createdAt);
  const stamp = Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return option.supplierBatchRef?.trim() || `Batch of ${stamp}`;
}

/**
 * THE ONE CELL THAT DOES BOTH JOBS: type a label to create a batch, or open the
 * list and pick one to add to.
 *
 * A combobox rather than two separate controls, because the two answers are
 * alternatives to the same question and a New/Existing toggle would make the
 * common case (type a name, move on) two interactions instead of one. Typing is
 * always allowed; the list is advice, and picking from it converts the row.
 *
 * `useCombobox` earns its place here exactly as CLAUDE.md describes — ↑↓, Enter,
 * Esc, active-option tracking and open/close state would otherwise be hand-written.
 */
function BatchCell({
  row,
  onPick,
  onType,
  focusAfterPickId,
  options,
  otherOptions,
  isOtherCapped,
  uomLabel,
  search,
  onSearchChange,
  isLoading,
  isInvalid,
}: {
  row: DraftRow;
  onPick: (option: ReceiptBatchOption) => void;
  onType: (value: string) => void;
  focusAfterPickId: string;
  options: ReceiptBatchOption[];
  otherOptions: ReceiptBatchOption[];
  isOtherCapped: boolean;
  uomLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  isLoading: boolean;
  isInvalid: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const uid = useId();
  const inputId = `${uid}-alloc-batch`;
  const toggleButtonId = `${uid}-alloc-toggle`;

  /** One flat list for downshift's index maths; the headings are rendered around
   * it. Two `<ul>`s would need the indices offset by hand, which is the kind of
   * arithmetic that silently highlights the wrong row. */
  const flat = useMemo(() => [...options, ...otherOptions], [options, otherOptions]);

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    getItemProps,
    highlightedIndex,
    closeMenu,
  } = useCombobox({
    items: flat,
    inputId,
    toggleButtonId,
    inputValue: search,
    selectedItem: row.option,
    itemToString: (option) => (option ? optionLabel(option) : ''),
    onInputValueChange: ({ inputValue }) => onSearchChange(inputValue ?? ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      onPick(selectedItem);
      requestAnimationFrame(() => document.getElementById(focusAfterPickId)?.focus());
    },
    stateReducer: (state, { type, changes }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          // One batch per row, so a pick closes the panel. The shared search is
          // cleared with it, or the next row opens pre-filtered to the batch just
          // taken — which is no longer on offer, so it opens on an empty list.
          return { ...changes, inputValue: '', isOpen: false };
        case useCombobox.stateChangeTypes.InputBlur:
          // Downshift selects the highlighted item on blur. Clicking away from a
          // half-open list is not a choice.
          return { ...changes, selectedItem: state.selectedItem, inputValue: '', isOpen: false };
        default:
          return changes;
      }
    },
  });

  useEffect(() => {
    if (isOpen) document.getElementById(inputId)?.focus();
  }, [isOpen, inputId]);

  /**
   * 🔴 Escape belongs to the dropdown while the dropdown is open. `Modal` listens
   * on `document` in the capture phase and this panel is portalled to
   * `document.body`, so without this one Escape over the list closes the whole
   * dialog and throws the allocation away. `window` is ahead of `document` in the
   * capture path, which is what lets this run first.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeMenu();
      document.getElementById(toggleButtonId)?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, closeMenu, toggleButtonId]);

  /**
   * 🔴 The menu is portalled out of the dialog and positioned `fixed`. The grid is
   * an `overflow-x: auto` box and `Modal`'s body is the vertical scroller, so an
   * absolutely positioned menu is clipped to the table. Re-measured on scroll in
   * the CAPTURE phase — `scroll` does not bubble, so a `window` listener never
   * hears the dialog body scrolling and the menu hangs in mid-air.
   */
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, MENU_WIDTH), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const openUp = below < MENU_MIN_HEIGHT && above > below;
      setMenuPosition({
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(openUp ? above : below, MENU_MIN_HEIGHT)),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen]);

  const renderOption = (option: ReceiptBatchOption, index: number) => {
    const active = highlightedIndex === index;
    return (
      <li
        key={option.batchId}
        {...getItemProps({ item: option, index })}
        style={{
          padding: '8px 12px',
          fontSize: 13,
          cursor: 'pointer',
          background: active ? '#0062ff' : '#fff',
          color: active ? '#fff' : '#111',
        }}
      >
        <div style={{ fontWeight: 500 }}>{optionLabel(option)}</div>
        <div style={{ fontSize: 11.5, color: active ? '#e0edff' : '#64748b' }}>
          {/* 🔴 Internal and external apart, here too — the picker is where the
              operator decides, so it is where the distinction has to be legible. */}
          {toNumber(option.internalQty) > 0
            ? `${formatQty(option.internalQty)} ${uomLabel} on hand`
            : 'None on hand'}
          {toNumber(option.externalQty) > 0
            ? ` · ${formatQty(option.externalQty)} ${uomLabel} with a processor`
            : ''}
          {option.byLocation.length > 0
            ? ` · ${option.byLocation.map((l) => l.locationName ?? '—').join(', ')}`
            : ''}
        </div>
        {option.source === 'other' && (
          <div style={{ fontSize: 11, color: active ? '#fde68a' : '#b45309', marginTop: 2 }}>
            From a different job order — adding to it blends this receipt&rsquo;s cost into it.
          </div>
        )}
      </li>
    );
  };

  return (
    <div ref={anchorRef} style={{ position: 'relative', width: 290, maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Typing is the primary path — most batches are new — so the input, not
            the button, carries the focus and the tab stop. */}
        <input
          type="text"
          value={row.batchReference}
          onChange={(e) => onType(e.target.value)}
          readOnly={row.batchId !== null}
          placeholder="Enter a new reference, or select"
          aria-label="Batch reference"
          title={
            row.batchId
              ? 'This row adds to an existing batch. Clear the row to name a new one instead.'
              : undefined
          }
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 10px',
            fontSize: 13,
            border: `1px solid ${isInvalid ? '#fca5a5' : '#d1d5db'}`,
            borderRight: 'none',
            borderRadius: '4px 0 0 4px',
            minHeight: 34,
            boxSizing: 'border-box',
            background: row.batchId ? '#f8fafc' : '#fff',
            color: row.batchId ? '#475569' : '#111',
          }}
        />
        <button
          /**
           * 🔴 `tabIndex: 0` is load-bearing — downshift returns -1 here, because
           * `useCombobox` assumes the input beside it is the anchor. That is right
           * for `ui/ComboBox.tsx`; here the input is a free-text field that does
           * NOT open the list, so the button is the only way in and the default
           * would make it unreachable by Tab with nothing to say so.
           */
          {...getToggleButtonProps({ tabIndex: 0, 'aria-label': 'Select an existing batch' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 8px',
            fontSize: 12,
            border: `1px solid ${isOpen ? '#0062ff' : isInvalid ? '#fca5a5' : '#d1d5db'}`,
            borderRadius: '0 4px 4px 0',
            background: '#f8fafc',
            color: '#475569',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Select
          <ChevronDown size={13} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
      </div>

      {/* Kept mounted while closed: downshift needs `getMenuProps`' ref on a live
          element to tell a click inside its own menu from one outside it. */}
      {createPortal(
        <div
          style={{
            position: 'fixed',
            zIndex: MENU_Z_INDEX,
            display: isOpen ? 'flex' : 'none',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
            overflow: 'hidden',
            ...menuPosition,
          }}
        >
          <div style={{ position: 'relative', padding: 8, flexShrink: 0 }}>
            <Search
              size={14}
              color="#94a3b8"
              style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              {...getInputProps({
                placeholder: 'Search other batches of this item',
                'aria-label': 'Search batches',
                onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
                  // Tab must not walk into the portal, which lives outside the
                  // focus trap — the next Tab would escape into browser chrome.
                  if (event.key !== 'Tab') return;
                  event.preventDefault();
                  closeMenu();
                  document.getElementById(toggleButtonId)?.focus();
                },
                style: {
                  width: '100%',
                  padding: '7px 10px 7px 30px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  minHeight: 32,
                },
              })}
            />
          </div>

          <ul
            {...getMenuProps()}
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
            }}
          >
            {isOpen && (
              <>
                <li style={sectionHeadingStyle}>From this job order</li>
                {options.length === 0 ? (
                  <li style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>
                    {isLoading
                      ? 'Looking…'
                      : 'This job order has not produced any batch of this item yet.'}
                  </li>
                ) : (
                  options.map((option, index) => renderOption(option, index))
                )}

                <li style={sectionHeadingStyle}>Other batches of this item</li>
                {otherOptions.length === 0 ? (
                  <li style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>
                    {search
                      ? 'Nothing else matches that.'
                      : 'Type above to search every batch of this item.'}
                  </li>
                ) : (
                  otherOptions.map((option, index) => renderOption(option, options.length + index))
                )}
                {isOtherCapped && (
                  <li style={{ padding: '8px 12px', fontSize: 11, color: '#92400e' }}>
                    Only the first {otherOptions.length} matches are listed — type to narrow.
                  </li>
                )}
              </>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

const sectionHeadingStyle: React.CSSProperties = {
  padding: '8px 12px 4px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#94a3b8',
  background: '#f8fafc',
};
