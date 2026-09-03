import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';
import { AlertTriangle, ChevronDown, Plus, Search, Truck, X } from 'lucide-react';
import { DateInput } from '../../../components/ui/DateInput';
import { Modal } from '../../../components/ui/Modal';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatDate } from '../../../lib/formatDate';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { ReceiptBatchOption } from './jobReceipts.schemas';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { BatchUnitsModal, BatchUnitsTrigger } from '../../../components/inventory/BatchUnitsModal';
import {
  isSubmittableUnit,
  validateBatchUnits,
  type BatchUnitRow,
  type ExistingBatchUnitOption,
} from '../../../components/inventory/batchUnits';

/**
 * ADD BATCHES (RECEIVE) — which batches the goods coming back land in.
 *
 * 🔴 THIS IS NOT `issues/AddBatchesModal.tsx`, and the difference is the whole
 * point. The issue grid asks "which existing stock am I taking, and is there
 * enough": every row is bounded by a balance at one godown, and every column on
 * it describes a batch that already exists. This one asks "what shall this new
 * stock be called", and there is no ceiling at all, because the receipt CREATES
 * the quantity. Sharing one component is precisely how the availability logic
 * leaks into a screen that has no availability.
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
 *
 * 🔴 THE TWO GROUPS IN THE DROPDOWN ARE THE GUARD RAIL, not decoration, and they
 * are why this is one sectioned list rather than two tabs or one flat list.
 * Continuing this job order's own batch is almost always right; merging into an
 * unrelated one blends cost into a weighted average and makes a recall span two
 * provenances. A heading is a hard separator you cannot pick past without
 * reading it — an icon on an interleaved row is not, and a tab hides half the
 * answer to the question the operator is actually asking ("is it already in this
 * job order, or do I have to look wider?"). Since 2026-08-22 the first group is
 * capped at three rows with an expander and the second pages in on scroll, so
 * neither can bury the other.
 */

/** Same ceiling as the issue grid — a hundred allocation rows on one line is
 * already past what anyone reconciles by eye. */
const MAX_ROWS = 100;

/** Blank rows the grid opens with, so allocating three batches is type-Tab-type
 * and never a trip back to "+ New Batch" between each one. */
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

  /**
   * 🔴 THE NEW BATCH'S OWN ATTRIBUTES — typed on a `new` row and nowhere else.
   *
   * This is the only moment they can be stated. What a processor hands back is
   * physically new, and the person standing at the delivery is the only one who
   * knows what the maker's tag says or when the dye lot was made. Left to the
   * batch's own screen afterwards they were never filled in — and "which batches
   * expire in 30 days" is the entire reason a factory records an expiry.
   *
   * On an `existing` row they stay empty and the picked batch's own values are
   * shown instead: the server REFUSES attributes beside a `batchId`, because a
   * batch is added to and never restamped from inside a receipt.
   *
   * All five held as STRINGS — exactly what the inputs produce. Empty means "not
   * stated", which is a different fact from zero, and a number type cannot carry
   * the difference.
   */
  manufacturerBatch: string;
  /** `yyyy-mm-dd`, straight off `DateInput` — which types `dd-MM-yyyy` but emits
   * this, exactly as the native date input it replaced did. */
  manufacturedDate: string;
  expiryDate: string;
  sellingPrice: string;
  mrp: string;

  /**
   * 🔴 THE PACKAGES THE PROCESSOR PHYSICALLY HANDED BACK — the takas, rolls or
   * bales inside this batch, when the org runs a unit level.
   *
   * Allowed on an `existing` row too, unlike the five attributes above, and the
   * asymmetry is the point: restamping an existing batch's expiry rewrites a fact
   * about goods that already exist, whereas naming packages records goods that
   * have just arrived. The second half of a split delivery is three more rolls,
   * not a correction to the first half's.
   *
   * May total LESS than `qty`. The rest is the batch's untagged remainder, which
   * is legal and posts as one movement with no package on it.
   */
  units: BatchUnitRow[];
}

/**
 * 🔴 THE ROW SAYS WHICH OF THE TWO IT IS, and the control follows from it — a
 * typed box for a new batch, a dropdown for an existing one.
 *
 * One combined cell (type here, or press Select) carried both answers in one
 * control, and a control that does two things says neither: nothing on the row
 * distinguished "I am naming a new lot" from "I have not picked one yet", and
 * the picked-then-read-only input read as a text box that had stopped working.
 * The mode is chosen when the row is added, from the two links under the grid.
 */
type RowMode = 'new' | 'existing';

interface DraftRow extends BatchAllocation {
  id: string;
  mode: RowMode;
}

/** Everything a row forgets when it is cleared, and everything a blank one starts
 * with. Named once so `blankRow` and `clearOrRemoveRow` cannot drift — a field
 * added to one and not the other is an attribute that survives a clear and gets
 * posted against a batch nobody meant to give it to. */
const EMPTY_ROW = {
  batchId: null,
  batchReference: '',
  qty: 0,
  option: null,
  manufacturerBatch: '',
  manufacturedDate: '',
  expiryDate: '',
  sellingPrice: '',
  mrp: '',
  units: [],
} satisfies Omit<DraftRow, 'id' | 'mode'>;

const createEmptyUnit = (): BatchUnitRow => ({
  id: crypto.randomUUID(),
  label: '',
  quantity: '',
});

let rowSeq = 0;
const blankRow = (mode: RowMode): DraftRow => ({
  id: `alloc-${rowSeq++}`,
  mode,
  ...EMPTY_ROW,
});

function seedRows(existing: readonly BatchAllocation[]): DraftRow[] {
  // A saved row already says which it is: it points at a batch, or it carries a
  // label of its own.
  const rows = existing.map((row) => ({
    ...row,
    id: `alloc-${rowSeq++}`,
    mode: (row.batchId ? 'existing' : 'new') as RowMode,
  }));
  const blanks = Math.max(DEFAULT_BLANK_ROWS - rows.length, rows.length > 0 ? 1 : 0);
  // New is the ordinary case — what a processor hands back is physically new —
  // so the rows the grid opens with are blank labels, not empty dropdowns.
  return [...rows, ...Array.from({ length: blanks }, () => blankRow('new'))];
}

/** A row counts once it has been answered: a label typed, or a batch picked. */
const isFilled = (row: DraftRow) =>
  row.mode === 'existing' ? row.batchId !== null : row.batchReference.trim().length > 0;

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
  /** Another page of `otherOptions` exists. */
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  /** The FIRST page is still in flight. Paging in the next one is `isLoadingMore`
   * — treating them alike blanked the list on every scroll. */
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
  hasMore,
  onLoadMore,
  isLoadingMore,
  search,
  onSearchChange,
  isLoading,
}: Props) {
  /** Seeded once, on mount — so the caller mounts this only while open and keys
   * it on the row, the same contract the issue grid carries. */
  const [rows, setRows] = useState<DraftRow[]>(() => seedRows(initialRows));

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
  /** What the row should open at: everything the other rows have not taken. */
  const fillFor = (prev: readonly DraftRow[], id: string) =>
    Math.max(
      0,
      Number(
        (
          targetQty -
          prev.reduce((sum, row) => (row.id !== id && isFilled(row) ? sum + row.qty : sum), 0)
        ).toFixed(4),
      ),
    );

  /** Picking flips the row to `existing` as well as filling it — the lookalike
   * prompt converts a typed row this way, and re-picking has to leave the mode
   * where the pick put it. */
  const pickBatch = (id: string, option: ReceiptBatchOption) =>
    setRows((prev) => {
      const fill = fillFor(prev, id);
      return prev.map((row) =>
        row.id === id
          ? {
              ...row,
              ...EMPTY_ROW,
              /* 🔴 Cleared, not carried over. The lookalike prompt converts a row
                 somebody had already typed dates into, and the server refuses
                 attributes beside a `batchId` — the batch already has its own. */
              mode: 'existing' as RowMode,
              batchId: option.batchId,
              batchReference: option.supplierBatchRef ?? '',
              option,
              qty: row.qty > 0 ? row.qty : fill,
            }
          : row,
      );
    });

  /** A typed label is only ever a NEW batch — never a label ON an existing one,
   * which would be renaming somebody else's batch from inside a receipt. */
  const typeReference = (id: string, batchReference: string) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, batchReference, qty: row.qty > 0 ? row.qty : fillFor(prev, id) }
          : row,
      ),
    );

  /** Clear, don't delete — a control that yanks a row out from under the cursor
   * moves every row below it mid-entry. An already-blank row has nothing to
   * clear, so there the same control drops it. Clearing keeps the row's mode:
   * the slot stays the kind of row it was added as. */
  const clearOrRemoveRow = (id: string) =>
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row && isFilled(row)) {
        return prev.map((r) => (r.id === id ? { ...r, ...EMPTY_ROW } : r));
      }
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [blankRow(row?.mode ?? 'new')];
    });

  const filledRows = rows.filter(isFilled);

  /**
   * Rows a batch-tracked item cannot save: a quantity against no label at all.
   *
   * 🔴 An EXISTING row that was picked is never one of these, even when the batch
   * carries no reference of its own — it is identified by `batchId`, which is
   * what the server writes against. Checking the label alone refused a legitimate
   * pick of an unlabelled batch with a message about typing a reference into a
   * box that is not there.
   */
  const unlabelled = requiresReference
    ? rows.filter((row) => row.qty > 0 && row.batchId === null && !row.batchReference.trim())
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
      if (row.mode !== 'new' || row.batchId) continue;
      const match = byRef.get(row.batchReference.trim().toLowerCase());
      if (match) hits.set(row.id, match);
    }
    return hits;
  }, [rows, options, otherOptions]);

  const noun = kind === 'accepted' ? 'accepted' : 'rework';
  const { singular, plural } = useTrackingLabel();
  /** 🔴 `enabled` gates the whole level: off, and this dialog renders exactly as
   * it did before the feature existed. */
  const unitLabel = useBatchUnitLabel();
  /** Which allocation row's package DIALOG is open — one at a time, so an id and
   * not a set. It was an expanding sub-grid until 2026-09-03; packages are now
   * entered exactly the way the batches above them are. */
  const [unitsFor, setUnitsFor] = useState<string | null>(null);

  const addUnit = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, units: [...row.units, createEmptyUnit()] } : row,
      ),
    );
  };

  /** The same, for a package the batch already holds. A blank `batchUnitId` is
   * what makes the row render a picker instead of a label box; it is filled in
   * when the user picks, and the row is skipped on save until then. */
  const addExistingUnit = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, units: [...row.units, { ...createEmptyUnit(), batchUnitId: '' }] }
          : row,
      ),
    );
  };

  /** Open one row's package dialog, giving an empty row its first package on the
   * way in — a control that reads "Add {plural}" has to add one. */
  const openUnits = (rowId: string) => {
    if (!rows.find((row) => row.id === rowId)?.units.length) addUnit(rowId);
    setUnitsFor(rowId);
  };

  const pickExistingUnit = (rowId: string, unitId: string, option: ExistingBatchUnitOption) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              units: row.units.map((u) =>
                u.id === unitId
                  ? { ...u, batchUnitId: option.batchUnitId, label: option.label }
                  : u,
              ),
            }
          : row,
      ),
    );

  const removeUnit = (rowId: string, unitId: string) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, units: row.units.filter((u) => u.id !== unitId) } : row,
      ),
    );

  const changeUnit = (rowId: string, unitId: string, field: 'label' | 'quantity', value: string) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              units: row.units.map((u) => (u.id === unitId ? { ...u, [field]: value } : u)),
            }
          : row,
      ),
    );

  /**
   * The package rules, checked at the row so the dialog can refuse to save rather
   * than letting the server answer with a 400 against a form the user can no
   * longer see. The same rules are enforced beside the write — this dialog is not
   * the only way a receipt can be posted.
   */
  const unitProblem = unitLabel.enabled
    ? (rows
        .filter((row) => isFilled(row) && row.qty > 0)
        .map((row) =>
          validateBatchUnits({
            units: row.units,
            batchQty: row.qty,
            batchName: row.batchReference.trim() || singular,
            singular: unitLabel.singular,
            plural: unitLabel.plural,
            uomLabel,
          }),
        )
        .find(Boolean) ?? null)
    : null;

  const canSave =
    matches && unlabelled.length === 0 && duplicateIds.size === 0 && unitProblem === null;

  const handleSave = () => {
    if (!canSave) return;
    onSave(
      filledRows
        .filter((row) => row.qty > 0)
        // `id` and `mode` are the grid's own bookkeeping and stop here; everything
        // else is the allocation the dialog holds.
        .map(({ id: _id, mode: _mode, ...allocation }) => ({
          ...allocation,
          batchReference: allocation.batchReference.trim(),
          // Dropped entirely when the level is off, so a setting that was on and
          // is now off cannot leave stale rows riding along in the payload.
          units: unitLabel.enabled
            ? // An "Existing" row is answered by picking; one nobody picked in is
              // dropped exactly as an untouched new row is.
              allocation.units.filter(isSubmittableUnit)
            : [],
        })),
    );
    onClose();
  };

  /** The allocation row whose package dialog is open, re-read from state each
   * render so the dialog shows live rows rather than a snapshot. */
  const unitsRow = rows.find((row) => row.id === unitsFor) ?? null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={kind === 'accepted' ? `Add ${plural}` : `Add Rework ${plural}`}
        width={1240}
        position="fullScreen"
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
                  ? `A ${singular.toLowerCase()} is used twice, or is already taken by the other disposition.`
                  : unlabelled.length > 0
                    ? `Every ${singular.toLowerCase()} of a tracked item needs a reference.`
                    : definesTarget
                      ? `Name at least one ${singular.toLowerCase()} and how much of it came back.`
                      : `The ${plural.toLowerCase()} must add up to the ${noun} quantity.`}
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
            — every {singular.toLowerCase()} below lands here, whatever it already holds elsewhere.
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
              {kind === 'accepted'
                ? 'Accepted goods'
                : `Rework — kept in its own ${singular.toLowerCase()}`}
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
                  Taken from the {plural.toLowerCase()} below — nothing was typed on the row yet.
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

        {/* 🔴 NINE COLUMNS, so this one scrolls sideways INSIDE its own box rather
          than making the dialog do it. Fixed pixel widths, not percentages: five
          of these hold date and money inputs that have a floor below which they
          are unusable, and a percentage grid squeezes them past it on a laptop. */}
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
              <colgroup>
                <col style={{ width: 210 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 145 }} />
                <col style={{ width: 145 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                  <th
                    style={{ ...th, ...(requiresReference ? { color: '#b91c1c' } : {}) }}
                    scope="col"
                  >
                    {singular} Reference{requiresReference ? '*' : ''}
                  </th>
                  {/* 🔴 THE FIVE ATTRIBUTES OF THE BATCH BEING BORN. Editable on a
                  `new` row, read-only facts about the picked batch on an
                  `existing` one — see the note on `BatchAllocation`.

                  They are NOT on the issue grid, and should not be: there every
                  row is existing stock, so all five could only ever be grey text
                  restating the batch master. Here they are the only chance
                  anybody gets to state them. */}
                  <th style={th} scope="col">
                    Manufacturer {singular}#
                  </th>
                  <th style={th} scope="col">
                    Manufactured Date
                  </th>
                  <th style={th} scope="col">
                    Expiry Date
                  </th>
                  <th style={{ ...th, textAlign: 'right' }} scope="col">
                    Selling Price (₹)
                  </th>
                  <th style={{ ...th, textAlign: 'right' }} scope="col">
                    MRP (₹)
                  </th>
                  {/* No "Type" column: the control in the first cell is the answer, a
                  box to type in or a dropdown to pick from, and a badge repeating
                  that was a column spent saying what was already on screen. */}
                  <th style={{ ...th, textAlign: 'right' }} scope="col">
                    Balance
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
                  /* Only a row that has been ANSWERED can hold packages: a blank slot
                 with no label and no batch is not a thing rolls can be inside. */
                  const canHoldUnits = unitLabel.enabled && isFilled(row);
                  return (
                    <Fragment key={row.id}>
                      <tr style={{ borderBottom: canHoldUnits ? 'none' : '1px solid #f1f5f9' }}>
                        <td style={{ ...td, padding: '8px 10px 8px 0' }}>
                          {row.mode === 'new' ? (
                            /* A plain input — native, focusable, and nothing else to
                         learn. `downshift` earns its place on the dropdown beside
                         it, not on a text box (CLAUDE.md). */
                            <input
                              type="text"
                              value={row.batchReference}
                              onChange={(e) => typeReference(row.id, e.target.value)}
                              placeholder={`Enter ${singular}#`}
                              aria-label={`New ${singular.toLowerCase()} reference`}
                              style={{
                                width: '100%',
                                padding: '7px 10px',
                                fontSize: 13,
                                border: `1px solid ${
                                  requiresReference && row.qty > 0 && !row.batchReference.trim()
                                    ? '#fca5a5'
                                    : '#d1d5db'
                                }`,
                                borderRadius: 4,
                                minHeight: 34,
                                boxSizing: 'border-box',
                              }}
                            />
                          ) : (
                            <ExistingBatchCell
                              row={row}
                              onPick={(option) => pickBatch(row.id, option)}
                              focusAfterPickId={`alloc-qty-${row.id}`}
                              options={options.filter(
                                (option) =>
                                  !blockedBatchIds.includes(option.batchId) &&
                                  !rows.some(
                                    (other) =>
                                      other.id !== row.id && other.batchId === option.batchId,
                                  ),
                              )}
                              otherOptions={otherOptions.filter(
                                (option) =>
                                  !blockedBatchIds.includes(option.batchId) &&
                                  !rows.some(
                                    (other) =>
                                      other.id !== row.id && other.batchId === option.batchId,
                                  ),
                              )}
                              hasMore={hasMore}
                              onLoadMore={onLoadMore}
                              isLoadingMore={isLoadingMore}
                              uomLabel={uomLabel}
                              search={search}
                              onSearchChange={onSearchChange}
                              isLoading={isLoading}
                              isInvalid={duplicateIds.has(row.id)}
                              singular={singular}
                              plural={plural}
                            />
                          )}
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
                              <span>
                                A {singular.toLowerCase()} with this reference already exists. Add
                                to it instead?
                              </span>
                            </button>
                          )}
                        </td>

                        <AttributeCell row={row} field="manufacturerBatch" onChange={setRow}>
                          {row.option?.manufacturerBatch?.trim() || '—'}
                        </AttributeCell>
                        <AttributeCell
                          row={row}
                          field="manufacturedDate"
                          type="date"
                          onChange={setRow}
                        >
                          {displayDate(row.option?.manufacturedDate ?? null)}
                        </AttributeCell>
                        <AttributeCell row={row} field="expiryDate" type="date" onChange={setRow}>
                          {displayDate(row.option?.expiryDate ?? null)}
                        </AttributeCell>
                        <AttributeCell
                          row={row}
                          field="sellingPrice"
                          type="money"
                          onChange={setRow}
                        >
                          {money(row.option?.sellingPrice ?? null)}
                        </AttributeCell>
                        <AttributeCell row={row} field="mrp" type="money" onChange={setRow}>
                          {money(row.option?.mrp ?? null)}
                        </AttributeCell>

                        <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>
                          {row.option ? (
                            <>
                              <div>
                                {formatQty(row.option.internalQty)} {uomLabel}
                              </div>
                              {toNumber(row.option.externalQty) > 0 && (
                                <div style={{ fontSize: 11.5, color: '#b45309' }}>
                                  +{formatQty(row.option.externalQty)} with a processor
                                </div>
                              )}
                            </>
                          ) : row.mode === 'new' && isFilled(row) ? (
                            <span style={{ color: '#94a3b8' }}>New {singular.toLowerCase()}</span>
                          ) : (
                            '—'
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
                            placeholder="0.00"
                            aria-label={
                              row.mode === 'existing' || row.batchReference.trim()
                                ? `Quantity into ${singular.toLowerCase()} ${row.batchReference || `this ${singular.toLowerCase()}`}`
                                : `Quantity — name or pick a ${singular.toLowerCase()} first`
                            }
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
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

                      {/* ── The level BELOW this batch ────────────────────────────
                    🔴 DOM order IS tab order, so this sits immediately after the
                    allocation row it belongs to — Tab walks the batch's own
                    fields, then its packages, then the next batch. */}
                      {canHoldUnits && (
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td colSpan={8} style={{ padding: '0 0 10px' }}>
                            <BatchUnitsTrigger
                              count={row.units.length}
                              singular={unitLabel.singular}
                              plural={unitLabel.plural}
                              onOpen={() => openUnits(row.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <AddRowLink
              label={`New ${singular}`}
              onClick={() => setRows((prev) => [...prev, blankRow('new')])}
              disabled={rows.length >= MAX_ROWS}
            />
            <span style={{ color: '#e2e8f0' }}>|</span>
            <AddRowLink
              label={`Existing ${singular}`}
              onClick={() => setRows((prev) => [...prev, blankRow('existing')])}
              disabled={rows.length >= MAX_ROWS}
            />
          </div>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {plural} added: {filledRows.length}/{MAX_ROWS}
          </span>
        </div>
      </Modal>

      {unitsRow && (
        <BatchUnitsModal
          isOpen
          onClose={() => setUnitsFor(null)}
          batchName={unitsRow.batchReference.trim() || singular}
          batchSingular={singular}
          singular={unitLabel.singular}
          plural={unitLabel.plural}
          batchQty={unitsRow.qty}
          uomLabel={uomLabel}
          units={unitsRow.units}
          /* Only a batch that already exists has packages to add to, so a
           "New {batch}" row offers none and the link disables itself. */
          existingOptions={
            unitsRow.mode === 'existing' && unitsRow.option
              ? unitsRow.option.units.map((unit) => ({
                  batchUnitId: unit.batchUnitId,
                  label: unit.label,
                }))
              : []
          }
          onAdd={() => addUnit(unitsRow.id)}
          onAddExisting={() => addExistingUnit(unitsRow.id)}
          onChange={(unitId, field, value) => changeUnit(unitsRow.id, unitId, field, value)}
          onPickExisting={(unitId, option) => pickExistingUnit(unitsRow.id, unitId, option)}
          onRemove={(unitId) => removeUnit(unitsRow.id, unitId)}
        />
      )}
    </>
  );
}

/** `yyyy-mm-dd` → `dd-MM-yyyy`. Split rather than parsed: these are date-only
 * columns, and `new Date('2026-08-12')` is UTC midnight, which renders as the
 * 11th anywhere behind UTC. */
function displayDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}-${m}-${y}` : '—';
}

/** `string | number` because a decimal crosses the wire as a string and zod's
 * `decimalString` accepts either. Null and '' are "not stated", NOT zero. */
function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
}

/** The five attribute fields, held as strings — see the note on `BatchAllocation`. */
type AttributeField =
  'manufacturerBatch' | 'manufacturedDate' | 'expiryDate' | 'sellingPrice' | 'mrp';

/**
 * One attribute cell: an input on a `new` row, the picked batch's own value as
 * flat text on an `existing` one.
 *
 * Five near-identical cells written out five times is five places for the two
 * halves to drift — and the half that matters (which rows may be typed into) is
 * the one the server enforces.
 */
function AttributeCell({
  row,
  field,
  type = 'text',
  onChange,
  children,
}: {
  row: DraftRow;
  field: AttributeField;
  type?: 'text' | 'date' | 'money';
  onChange: (id: string, patch: Partial<DraftRow>) => void;
  /** What to show when the row points at an existing batch. */
  children: React.ReactNode;
}) {
  const isMoney = type === 'money';
  if (row.mode === 'existing') {
    return (
      <td style={{ ...td, color: '#64748b', textAlign: isMoney ? 'right' : 'left' }}>{children}</td>
    );
  }
  const cellStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 10px',
    fontSize: 13,
    textAlign: isMoney ? 'right' : 'left',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    minHeight: 34,
  };
  return (
    <td style={td}>
      {type === 'date' ? (
        // `portal` because this grid lives in a Modal and the row is clipped by it.
        <DateInput
          value={row[field]}
          onChange={(next) => onChange(row.id, { [field]: next })}
          ariaLabel={ATTRIBUTE_LABELS[field]}
          style={cellStyle}
          portal
        />
      ) : (
        <input
          type={isMoney ? 'number' : 'text'}
          {...(isMoney ? { step: '0.0001', min: '0', onWheel: blurOnWheel } : {})}
          value={row[field]}
          onChange={(e) => onChange(row.id, { [field]: e.target.value })}
          placeholder={type === 'text' ? 'Enter MFR Batch#' : '0.00'}
          aria-label={ATTRIBUTE_LABELS[field]}
          style={cellStyle}
        />
      )}
    </td>
  );
}

const ATTRIBUTE_LABELS: Record<AttributeField, string> = {
  manufacturerBatch: 'Manufacturer batch number',
  manufacturedDate: 'Manufactured date',
  expiryDate: 'Expiry date',
  sellingPrice: 'Selling price',
  mrp: 'MRP',
};

function AddRowLink({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        fontSize: 13,
        fontWeight: 500,
        color: disabled ? '#94a3b8' : '#0062ff',
        background: 'none',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Plus size={14} /> {label}
    </button>
  );
}

const MENU_WIDTH = 420;
/** 320 before 2026-08-22, which put the second heading exactly at the fold once
 * the first group was capped — see `COLLAPSED_JOB_ORDER_ROWS`. */
const MENU_MAX_HEIGHT = 380;
/** Above `Modal`'s overlay (1100) — the menu is a sibling of it on `document.body`. */
const MENU_Z_INDEX = 1200;
const MENU_MIN_HEIGHT = 190;

/**
 * 🔴 HOW MANY OF THIS JOB ORDER'S BATCHES SHOW BEFORE "+ N more".
 *
 * A DISPLAY cap, not a fetch one — the server sends the group whole (it is
 * bounded by construction), so expanding costs nothing and shows instantly.
 *
 * The number is geometry, not taste. The list gets `MENU_MAX_HEIGHT` less the
 * search box (~48px); a heading is ~25px and an option ~49px. At four rows the
 * second heading lands past the fold on a laptop, which is the whole thing this
 * cap exists to prevent: a job order with a long delivery history used to bury
 * "Other batches of this item" under a scroll nobody knew to make.
 */
const COLLAPSED_JOB_ORDER_ROWS = 3;

/** How close to the bottom of the list a scroll gets before the next page is
 * asked for. Roughly one row, so the fetch is already in flight by the time the
 * last row is read. */
const LOAD_MORE_SLACK = 80;

/** What a batch is called on screen. `batchNumber` is internal and never a
 * fallback (2026-08-14); a batch with no reference gets a dated placeholder. */
function optionLabel(option: ReceiptBatchOption, singular: string): string {
  const date = new Date(option.createdAt);
  const stamp = Number.isNaN(date.getTime()) ? '—' : formatDate(date);
  return option.supplierBatchRef?.trim() || `${singular} of ${stamp}`;
}

/**
 * THE "SELECT BATCH" CELL — an existing-batch row, and only that. A new-batch row
 * is a plain text input rendered in the grid; the two are separate controls
 * because they are separate answers (see `RowMode`).
 *
 * A trigger button with the search box inside the panel, exactly like the issue
 * grid's — the two dialogs are the same job from opposite ends and an operator
 * does both all day.
 *
 * `useCombobox` earns its place here exactly as CLAUDE.md describes — ↑↓, Enter,
 * Esc, active-option tracking and open/close state would otherwise be hand-written.
 */
function ExistingBatchCell({
  row,
  onPick,
  focusAfterPickId,
  options,
  otherOptions,
  hasMore,
  onLoadMore,
  isLoadingMore,
  uomLabel,
  search,
  onSearchChange,
  isLoading,
  isInvalid,
  singular,
  plural,
}: {
  row: DraftRow;
  onPick: (option: ReceiptBatchOption) => void;
  focusAfterPickId: string;
  options: ReceiptBatchOption[];
  otherOptions: ReceiptBatchOption[];
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  uomLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  isLoading: boolean;
  isInvalid: boolean;
  singular: string;
  plural: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  /** Collapsed per cell, not per grid: each row's dropdown is its own question. */
  const [showAllJobOrder, setShowAllJobOrder] = useState(false);
  const uid = useId();
  const inputId = `${uid}-alloc-batch`;
  const toggleButtonId = `${uid}-alloc-toggle`;

  const visibleOptions =
    showAllJobOrder || options.length <= COLLAPSED_JOB_ORDER_ROWS
      ? options
      : options.slice(0, COLLAPSED_JOB_ORDER_ROWS);
  const hiddenCount = options.length - visibleOptions.length;

  /**
   * One flat list for downshift's index maths; the headings are rendered around
   * it. Two `<ul>`s would need the indices offset by hand, which is the kind of
   * arithmetic that silently highlights the wrong row.
   *
   * 🔴 VISIBLE options only. Downshift moves `highlightedIndex` through this
   * array, so a collapsed row left in it is a row ↑↓ stops on and Enter selects
   * with nothing on screen to show what was picked. For the same reason the
   * "+ N more" control below is NOT a member — it is a button, not an option.
   */
  const flat = useMemo(() => [...visibleOptions, ...otherOptions], [visibleOptions, otherOptions]);

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
    itemToString: (option) => (option ? optionLabel(option, singular) : ''),
    onInputValueChange: ({ inputValue }) => onSearchChange(inputValue ?? ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      onPick(selectedItem);
      requestAnimationFrame(() => document.getElementById(focusAfterPickId)?.focus());
    },
    /**
     * 🔴 THE KEYBOARD'S WAY PAST THE CAP, and it is not optional (CLAUDE.md's Tab
     * rule). "+ N more" is a button in the portal, which sits OUTSIDE the
     * dialog's focus trap, and the search box deliberately swallows Tab so focus
     * cannot walk out there — so Tab can never reach it. Arrowing onto the last
     * visible row of the capped group expands it instead, and ↓ carries straight
     * on into the rows that were hidden. The cap is then a rendering economy for
     * the mouse and never a wall for the keyboard.
     *
     * Gated on the two ARROW types on purpose: downshift also moves the
     * highlight on `ItemMouseMove`, and expanding a group because the pointer
     * drifted over a row would shove everything below it out from under the
     * cursor.
     */
    onHighlightedIndexChange: ({ highlightedIndex: next, type }) => {
      if (
        type !== useCombobox.stateChangeTypes.InputKeyDownArrowDown &&
        type !== useCombobox.stateChangeTypes.InputKeyDownArrowUp
      ) {
        return;
      }
      if (showAllJobOrder || hiddenCount === 0) return;
      if (next === visibleOptions.length - 1) setShowAllJobOrder(true);
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
    /**
     * 🔴 Coalesced to one measurement per frame. The listener is on `window` in
     * the capture phase, so it also hears the option list scrolling inside
     * itself — which moves nothing, but since 2026-08-22 that list scrolls for
     * pages of results and every event was a `getBoundingClientRect` plus a
     * fresh style object, so React re-rendered the menu on every scroll tick.
     */
    let frame = 0;
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
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };

    place();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
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
        <div style={{ fontWeight: 500 }}>{optionLabel(option, singular)}</div>
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
    <div ref={anchorRef} style={{ position: 'relative', width: '100%' }}>
      <button
        /**
         * 🔴 `tabIndex: 0` is load-bearing — downshift returns -1 here, because
         * `useCombobox` assumes an INPUT beside it is the anchor and the toggle is
         * a secondary chevron. That is right for `ui/ComboBox.tsx`; here the
         * button IS the control and the search box lives inside the panel, so the
         * default would make every dropdown in the grid unreachable by Tab with
         * nothing in `tsc` or a screenshot to say so.
         */
        {...getToggleButtonProps({ tabIndex: 0 })}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%',
          padding: '7px 10px',
          fontSize: 13,
          textAlign: 'left',
          border: `1px solid ${isOpen ? '#0062ff' : isInvalid ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: 4,
          background: '#fff',
          color: row.option ? '#111' : '#94a3b8',
          cursor: 'pointer',
          minHeight: 34,
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={row.option ? optionLabel(row.option, singular) : undefined}
        >
          {row.option ? optionLabel(row.option, singular) : `Select ${singular}`}
        </span>
        <ChevronDown
          size={14}
          color="#94a3b8"
          style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

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
                placeholder: `Search other ${plural.toLowerCase()} of this item`,
                'aria-label': `Search ${plural.toLowerCase()}`,
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
            {...getMenuProps({
              /* The next page is asked for a row before the bottom, so it is
                 already in flight by the time the last one is read. */
              onScroll: (event: React.UIEvent<HTMLUListElement>) => {
                if (!hasMore || isLoadingMore) return;
                const el = event.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_SLACK) {
                  onLoadMore();
                }
              },
            })}
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
                {/* 🔴 Sticky, so the group a row belongs to never leaves the
                    screen. Which of the two a batch is in decides whether picking
                    it continues this job order's own lot or blends an unrelated
                    one — that is not a fact to lose to a scroll. */}
                <li style={sectionHeadingStyle}>
                  From this job order{options.length > 0 ? ` (${options.length})` : ''}
                </li>
                {options.length === 0 ? (
                  <li style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>
                    {isLoading
                      ? 'Looking…'
                      : `This job order has not produced any ${singular.toLowerCase()} of this item yet.`}
                  </li>
                ) : (
                  visibleOptions.map((option, index) => renderOption(option, index))
                )}
                {hiddenCount > 0 && (
                  /* The MOUSE's way past the cap; the keyboard's is arrowing onto
                     the row above it (see `onHighlightedIndexChange`). Not a
                     downshift option — see the note on `flat`. `onMouseDown` is
                     prevented so the click never blurs the search input, which
                     downshift reads as "clicked away" and closes the menu on. */
                  <li>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowAllJobOrder(true)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 500,
                        textAlign: 'left',
                        color: '#0062ff',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      + {hiddenCount} more from this job order
                    </button>
                  </li>
                )}

                <li style={sectionHeadingStyle}>Other {plural.toLowerCase()} of this item</li>
                {otherOptions.length === 0 ? (
                  <li style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>
                    {isLoading
                      ? 'Looking…'
                      : search
                        ? 'Nothing else matches that.'
                        : `This item has no other ${plural.toLowerCase()} yet.`}
                  </li>
                ) : (
                  otherOptions.map((option, index) =>
                    renderOption(option, visibleOptions.length + index),
                  )
                )}
                {isLoadingMore && (
                  <li style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>Loading…</li>
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
  position: 'sticky',
  top: 0,
  // Above the rows it pins over; below the menu's own shadow.
  zIndex: 1,
  padding: '8px 12px 4px',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: '#94a3b8',
  // Opaque, not translucent — rows scroll underneath it.
  background: '#f8fafc',
};
