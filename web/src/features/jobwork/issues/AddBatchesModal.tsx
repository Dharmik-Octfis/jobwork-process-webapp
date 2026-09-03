import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';
import { ChevronDown, Plus, Search, Warehouse, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { BatchUnitsTrigger } from '../../../components/inventory/BatchUnitsModal';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatch } from '../batches/batches.api';
import { batchLabel, rowKey, selectionKey, type BatchSelection } from './batchSelection';
import { IssueUnitsModal, type IssueUnitRow } from './IssueUnitsModal';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';

/** Zoho's ceiling, and a sane one — a hundred allocation rows on one line is
 * already past what anyone reconciles by eye. */
const MAX_ROWS = 100;

/** Four decimal places is the quantity precision everywhere here, so anything
 * under half of the last one is rounding, not a difference. */
const QTY_EPS = 0.00005;

/**
 * 🔴 AN UN-BIFURCATED QUANTITY, RESOLVED TO REAL PACKAGES — oldest first.
 *
 * Saying which rolls a challan takes is optional, so the row states a quantity and
 * this decides where it comes from: `seq` ascending, which within one batch is the
 * order the packages were entered and so the order they arrived. Only what the
 * packages cannot cover is left for the untagged pool.
 *
 * It runs at SAVE and not while typing, because it is an answer the user did not
 * give — showing it in the grid would read as thirty picks they made.
 */
function spreadOverUnits(
  batch: AvailableBatch,
  qty: number,
): { batchUnitId: string; qty: number }[] {
  const parts: { batchUnitId: string; qty: number }[] = [];
  let left = qty;
  for (const unit of [...batch.units].sort((a, b) => a.seq - b.seq)) {
    if (left <= QTY_EPS) break;
    const take = Math.min(left, toNumber(unit.availableQty));
    if (take <= QTY_EPS) continue;
    parts.push({ batchUnitId: unit.batchUnitId, qty: Number(take.toFixed(4)) });
    left = Number((left - take).toFixed(4));
  }
  return parts;
}

/** `yyyy-mm-dd` → `dd-MM-yyyy`. Split rather than parsed: these are date-only
 * columns, and `new Date('2026-08-12')` is UTC midnight, which renders as the
 * 11th anywhere behind UTC. */
function displayDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}-${m}-${y}` : '—';
}

function money(value: string | null): string {
  if (value === null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
}

/** A row of the grid. It exists BEFORE a batch is chosen, so it cannot be keyed on
 * one — hence the local id. */
interface DraftRow {
  id: string;
  batch: AvailableBatch | null;
  /**
   * 🔴 EVERYTHING THIS ROW DRAWS FROM THE BATCH — packages included.
   *
   * It used to be the untagged pool alone, with the packages adding to it. That
   * made the box read empty for a batch taken entirely through its rolls, and made
   * bifurcation feel compulsory. It is the row's whole quantity now; `units`, when
   * present, only says how it is split.
   */
  qty: number;
  /**
   * 🔴 THE OPTIONAL BIFURCATION OF `qty` — a SPLIT of it, never an addition to it.
   *
   * Empty is the normal answer: the row states a quantity and `handleSave` spreads
   * it over the batch's packages oldest-first. Non-empty means the user said which
   * packages it comes off, and then the lines must add up to `qty` — the dialog
   * refuses Save while they do not.
   *
   * 🔴 A QUANTITY, NEVER A TICK. Part of a roll is a real answer on every screen
   * that reaches this grid — 20 m off a 100 m roll on an assembly, a short issue
   * against a part-used roll — so the amount is always typed and never inferred
   * from the roll's balance.
   */
  units: IssueUnitRow[];
}

let unitSeq = 0;

/** Blank rows the grid opens with, so allocating three batches is Tab-Tab-type and
 * never a trip back to "+ Existing Batch" between each one. Blank rows cost
 * nothing: they are skipped on save and never counted as "added". */
const DEFAULT_BLANK_ROWS = 5;

let rowSeq = 0;
const blankRow = (): DraftRow => ({
  id: `row-${rowSeq++}`,
  batch: null,
  qty: 0,
  units: [],
});

/**
 * 🔴 SELECTIONS FOLD BACK INTO ONE ROW PER BATCH.
 *
 * The saved shape is one entry per PACKAGE — that is what a challan line is — but
 * the grid shows one row per batch, with the split behind its own dialog. So
 * re-opening a dialog that sent three rolls of one batch must show ONE row of the
 * three rolls' total, not three rows for the same batch that the user cannot tell
 * apart.
 *
 * 🔴 Every entry adds to `qty`, package or not, because `qty` is the row's whole
 * quantity and `units` only says how it splits. Counting only the package-less
 * entries left a re-opened row reading 0.
 */
function seedRows(selection: Record<string, BatchSelection>): DraftRow[] {
  const byBatch = new Map<string, DraftRow>();
  for (const sel of Object.values(selection)) {
    const key = rowKey(sel.batch);
    const row = byBatch.get(key) ?? {
      id: `row-${rowSeq++}`,
      batch: sel.batch,
      qty: 0,
      units: [] as IssueUnitRow[],
    };
    if (sel.unit)
      row.units = [
        ...row.units,
        { id: `unit-${unitSeq++}`, batchUnitId: sel.unit.batchUnitId, qty: sel.qty },
      ];
    row.qty = Number((row.qty + sel.qty).toFixed(4));
    byBatch.set(key, row);
  }
  const rows = [...byBatch.values()];
  // Re-opening a grid that already holds allocations still gets room to add more,
  // without pushing what is there off the top.
  const blanks = Math.max(DEFAULT_BLANK_ROWS - rows.length, rows.length > 0 ? 1 : 0);
  return [...rows, ...Array.from({ length: blanks }, blankRow)];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  sku: string | null;
  uomLabel: string;
  /**
   * The godown the challan goes out of, when there is one.
   *
   * 🔴 NULL at PLANNING time, and that is not a missing value — a job order has no
   * source location. Nothing is going anywhere yet, so the batches on offer are the
   * item's across every godown and each row has to say which godown it is in.
   *
   * Set (the Issue dialog) means the availability query has already scoped itself
   * to that ONE location (2026-08-19), so every row on offer is there by
   * construction and a godown printed per row would repeat the header. It is
   * stated once, above the grid, because it is the thing the whole selection is
   * conditional on.
   */
  locationName: string | null;
  /** What the step planned for this item, when it states one. Context only. */
  plannedQty: number | null;
  /** What was typed on the line. The target this grid allocates against, and what
   * each freshly picked batch is pre-filled with. */
  lineQty: number;
  /** THIS item's rows only, keyed by `rowKey`. */
  selection: Record<string, BatchSelection>;
  /**
   * `rows` replaces this item's slice of the dialog's selection. `overwriteQty` is
   * the allocated total when the user asked for the line to be rewritten to it, and
   * null when the typed line quantity stands.
   */
  onSave: (rows: Record<string, BatchSelection>, overwriteQty: number | null) => void;
  /** The current search window from the availability query — NOT the selection. */
  batches: AvailableBatch[];
  search: string;
  onSearchChange: (search: string) => void;
  isLoading: boolean;
  /** True once the server returned a full page: more batches exist than are shown,
   * and the only way to reach them is a narrower search. */
  isCapped: boolean;
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
  whiteSpace: 'nowrap',
};

/** Read-only cells are flat text, not disabled inputs. A greyed-out box invites a
 * click and then refuses it; text simply reads as a fact about the chosen batch. */
const readOnlyCell: React.CSSProperties = { ...td, color: '#64748b' };

/**
 * ADD BATCHES — which existing batches a batch-tracked line comes out of.
 *
 * 🔴 EXISTING BATCHES ONLY. There is deliberately no "New Batch" here, unlike the
 * screen this is modelled on. `inventoryTracking = 'batch'` is a promise that every
 * metre traces back to the roll it came off, and a batch invented at the moment of
 * issue traces to nothing — the goods are already at the processor and no document
 * ever recorded what actually left. The server refuses those lines too
 * (`jobIssues.service`), so offering the path here would only produce a rejection.
 *
 * Everything except QUANTITY is read-only: the reference, the maker's number, the
 * dates and the prices are facts about the batch that was picked, shown so two rows
 * both reading `jv2` can be told apart. Editing them here would be editing the
 * batch master from inside a challan.
 *
 * 🔴 THE LINE STATES A TARGET; THIS GRID SAYS WHERE IT COMES FROM. Picking a batch
 * pre-fills it with everything still unallocated, so the common case — one batch
 * covering the whole line — is two clicks and no typing. It is deliberately NOT
 * capped at what the batch holds: filling 100 against a batch of 40 and letting the
 * over-drawn error fire tells the user the batch is short, where silently writing 40
 * would leave them to notice the missing 60 themselves.
 *
 * The two are reconciled at save: either they already agree, or the "overwrite"
 * box below rewrites the line to what was actually allocated. The Issue dialog
 * refuses to save while they differ.
 */
export function AddBatchesModal({
  isOpen,
  onClose,
  itemName,
  sku,
  uomLabel,
  locationName,
  plannedQty,
  lineQty,
  selection,
  onSave,
  batches,
  search,
  onSearchChange,
  isLoading,
  isCapped,
}: Props) {
  const { singular, plural } = useTrackingLabel();

  /**
   * 🔴 Seeded ONCE, on mount. The caller therefore has to mount this only when it
   * is open and key it on the item — the same hazard `AddOpeningStockModal`
   * carries. Rows arriving after mount would never reach the grid, and saving that
   * grid would then wipe an allocation the user could still see a moment ago.
   */
  const [rows, setRows] = useState<DraftRow[]>(() => seedRows(selection));
  const [overwrite, setOverwrite] = useState(false);
  /** 🔴 `enabled` gates the level. Off, and this grid behaves exactly as it did
   * before packages existed — no checkboxes, no sub-row, `qty` is the whole row. */
  const unitLabel = useBatchUnitLabel();
  /**
   * Which row's packages are being edited, or null. One dialog at a time, the same
   * way the four entry screens do it — an expanding panel per row sprawled ten
   * grids down a screen nobody could scroll, and the panel's own table had to fit
   * inside a cell of the batch table above it.
   */
  const [unitsRowId, setUnitsRowId] = useState<string | null>(null);
  const unitsRow = unitsRowId === null ? null : (rows.find((row) => row.id === unitsRowId) ?? null);

  /** Everything this row sends. `units` is a SPLIT of `qty`, so it is not added
   * here — the packages dialog is what keeps the two equal. */
  const rowTotal = (row: DraftRow) => (row.batch ? row.qty : 0);

  /** 🔴 The whole balance, not the untagged remainder. The row's quantity now
   * covers the packages too — an un-split row is spread over them at save — so
   * capping it at what is loose refused the ordinary case. */
  const rowCeiling = (batch: AvailableBatch) => toNumber(batch.availableQty);

  const allocated = useMemo(
    () => rows.reduce((sum, row) => sum + rowTotal(row), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, unitLabel.enabled],
  );
  /** What the line still wants. Drives both the header figure and the pre-fill. */
  const remaining = Number((lineQty - allocated).toFixed(4));
  const matches = Math.abs(remaining) < 0.00005;

  /** Batches already spoken for by another row — a batch cannot be allocated
   * twice on one line, and offering it again offers a second row for one pick. */
  const takenKeys = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) if (row.batch) map.set(rowKey(row.batch), row.id);
    return map;
  }, [rows]);

  /* A row asking for more than the batch has anywhere. The per-package ceilings
     are the packages dialog's job — it refuses Save over them, so a committed
     split is already within each roll's balance. */
  const overDrawn = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.batch && row.qty > rowCeiling(row.batch) + QTY_EPS)
          .map((row) => row.id),
      ),
    [rows],
  );

  const setRow = (id: string, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  /**
   * 🔴 Picking a batch no longer pre-fills its quantity.
   * The user must manually enter the quantity as requested.
   */
  const pickBatch = (id: string, batch: AvailableBatch) =>
    setRows((prev) =>
      // A new batch means new rolls, so whatever was ticked against the old one
      // goes with it — the ids would not exist in the new batch anyway.
      prev.map((row) => (row.id === id ? { ...row, batch, qty: 0, units: [] } : row)),
    );

  /**
   * 🔴 The packages dialog is a DRAFT — it holds its own copy and hands it back
   * here, so Cancel leaves the row untouched. `overwrite` means the user accepted
   * a split that disagrees with the row: the row moves to what was picked, and the
   * line item follows the new allocation on Save.
   */
  const commitUnits = (rowId: string, units: IssueUnitRow[], overwriteRow: boolean) => {
    const total = Number(units.reduce((sum, unit) => sum + unit.qty, 0).toFixed(4));
    // 🔴 Only a split can move the row. With every line deleted the user asked for
    // NO bifurcation, not for a row of zero — and the box is still tickable there
    // because it also settles the line item.
    const moveRow = overwriteRow && units.length > 0;
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, units, ...(moveRow ? { qty: total } : {}) } : row,
      ),
    );
    if (overwriteRow) setOverwrite(true);
    setUnitsRowId(null);
  };

  /**
   * 🔴 CLEAR, don't delete — the grid opens with five blank rows to be tabbed
   * through, and a control that yanks a row out from under the cursor moves every
   * row below it while someone is mid-entry. Clearing leaves the slot exactly where
   * it was, ready to be re-used, and a blank row costs nothing (skipped on save,
   * never counted as added).
   *
   * An already-blank row has nothing left to clear, so there the same control drops
   * it — which is what keeps a grid somebody expanded to thirty rows shrinkable.
   * The tooltip says which of the two it will do.
   */
  const clearOrRemoveRow = (id: string) =>
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (row?.batch)
        return prev.map((r) => (r.id === id ? { ...r, batch: null, qty: 0, units: [] } : r));
      const next = prev.filter((r) => r.id !== id);
      // Never leave an empty grid — a table with no rows and no way back to one
      // reads as a broken screen.
      return next.length > 0 ? next : [blankRow()];
    });

  const canSave = overDrawn.size === 0;

  const handleSave = () => {
    if (!canSave) return;
    /**
     * 🔴 ONE ENTRY PER PACKAGE — one entry becomes one challan line, and three
     * rolls of a batch are three lines exactly as three batches are.
     *
     * A row the user bifurcated sends its own lines. A row they did not is SPREAD
     * over the batch's packages here, oldest `seq` first, and only what no package
     * holds goes out as an untagged line.
     *
     * 🔴 The spread is not a convenience — the server refuses a line naming no
     * package for more than the batch's untagged remainder
     * (`jobIssues.service`, and `jobIssues.batchUnits.test.ts` pins it). So an
     * un-split quantity has to be resolved to real packages by the time it is
     * saved, or the save comes back rejected against an invariant the user has
     * never seen.
     */
    const next: Record<string, BatchSelection> = {};
    for (const row of rows) {
      if (!row.batch || !(row.qty > 0)) continue;

      const split =
        row.units.length > 0
          ? row.units
          : spreadOverUnits(row.batch, row.qty).map((part) => ({
              id: '',
              batchUnitId: part.batchUnitId,
              qty: part.qty,
            }));

      let named = 0;
      for (const { batchUnitId, qty } of split) {
        if (!batchUnitId || !(qty > 0)) continue;
        const unit = row.batch.units.find((u) => u.batchUnitId === batchUnitId);
        if (!unit) continue;
        next[selectionKey(row.batch, batchUnitId)] = { batch: row.batch, unit, qty };
        named = Number((named + qty).toFixed(4));
      }

      // Whatever no package accounted for. On a bifurcated row this is zero by
      // construction — the dialog would not have let Save through otherwise.
      const loose = Number((row.qty - named).toFixed(4));
      if (loose > QTY_EPS) {
        next[selectionKey(row.batch, null)] = { batch: row.batch, unit: null, qty: loose };
      }
    }
    onSave(next, overwrite ? allocated : null);
    onClose();
  };

  return (
    <>
      <Modal
        position="fullScreen"
        isOpen={isOpen}
        onClose={onClose}
        title={`Add ${plural}`}
        width={1140}
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
            {overDrawn.size > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#b91c1c' }}>
                A quantity is more than the batch holds.
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
          <Warehouse size={14} color="#64748b" />
          {locationName === null ? (
            <span style={{ color: '#64748b' }}>
              Every godown — this is a plan, so the goods have not been assigned a source yet.
            </span>
          ) : (
            <>
              <span style={{ color: '#64748b' }}>Location :</span>
              <span style={{ fontWeight: 500 }}>{locationName}</span>
            </>
          )}
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
            {sku && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>SKU: {sku}</div>}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#334155' }}>
              {plannedQty !== null && (
                <>
                  <span style={{ color: '#64748b' }}>Planned :</span> {formatQty(plannedQty)}{' '}
                  {uomLabel}
                  <span style={{ color: '#e2e8f0', margin: '0 10px' }}>|</span>
                </>
              )}
              <span style={{ color: '#64748b' }}>Total Quantity :</span> {formatQty(lineQty)}{' '}
              {uomLabel}
              <span style={{ color: '#e2e8f0', margin: '0 10px' }}>|</span>
              <span style={{ color: '#64748b' }}>Quantity to be added :</span>{' '}
              <span style={{ color: matches ? '#15803d' : '#b45309', fontWeight: 600 }}>
                {formatQty(remaining)} {uomLabel}
              </span>
            </div>

            {/* The one way out of a mismatch that does not mean retyping the line: the
              quantity follows what was actually allocated, instead of the other way
              round. Pointless when they already agree, so it is disabled there. */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                fontSize: 12.5,
                color: matches ? '#94a3b8' : '#334155',
                cursor: matches ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={overwrite}
                disabled={matches}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              Overwrite the line item with {formatQty(allocated)} quantities
            </label>
          </div>
        </div>

        {/* The grid is wider than most dialogs — it scrolls sideways inside its own
          box rather than making the page do it. */}
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                  <th style={{ ...th, width: 220, color: '#b91c1c' }} scope="col">
                    {singular} Reference#*
                  </th>
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
                  {/* Not on the screen this copies, and load-bearing here: without it a
                  chosen row shows no ceiling, and the only way to find one is to be
                  refused. */}
                  <th style={{ ...th, textAlign: 'right' }} scope="col">
                    Balance
                  </th>
                  <th
                    style={{ ...th, width: 130, textAlign: 'right', color: '#b91c1c' }}
                    scope="col"
                  >
                    Quantity*
                  </th>
                  <th style={{ ...th, width: 40 }} scope="col">
                    <span style={{ position: 'absolute', left: -9999 }}>Clear row</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  /* A row can only show rolls once it names a batch, and only when
                 that batch actually has some at this godown. */
                  const showUnits = unitLabel.enabled && (row.batch?.units.length ?? 0) > 0;
                  return (
                    <Fragment key={row.id}>
                      <tr style={{ borderBottom: showUnits ? 'none' : '1px solid #f1f5f9' }}>
                        <td style={{ ...td, padding: '8px 10px 8px 0' }}>
                          <BatchSelectCell
                            value={row.batch}
                            options={batches.filter((batch) => {
                              const owner = takenKeys.get(rowKey(batch));
                              return owner === undefined || owner === row.id;
                            })}
                            onChange={(batch) => pickBatch(row.id, batch)}
                            /* Picking a batch hands focus straight to its quantity, so the
                       whole grid is pick → type → Tab → pick without ever reaching
                       for the mouse. Without it focus is stranded on the search box
                       inside a panel that has just closed. */
                            focusAfterPickId={`qty-${row.id}`}
                            showGodown={locationName === null}
                            uomLabel={uomLabel}
                            search={search}
                            onSearchChange={onSearchChange}
                            isLoading={isLoading}
                            isCapped={isCapped}
                            offeredCount={batches.length}
                            singular={singular}
                            plural={plural}
                          />
                        </td>
                        <td style={readOnlyCell}>{row.batch?.manufacturerBatch?.trim() || '—'}</td>
                        <td style={readOnlyCell}>
                          {displayDate(row.batch?.manufacturedDate ?? null)}
                        </td>
                        <td style={readOnlyCell}>{displayDate(row.batch?.expiryDate ?? null)}</td>
                        <td style={{ ...readOnlyCell, textAlign: 'right' }}>
                          {money(row.batch?.sellingPrice ?? null)}
                        </td>
                        <td style={{ ...readOnlyCell, textAlign: 'right' }}>
                          {money(row.batch?.mrp ?? null)}
                        </td>
                        <td style={{ ...readOnlyCell, textAlign: 'right' }}>
                          {row.batch ? `${formatQty(row.batch.availableQty)} ${uomLabel}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input
                            id={`qty-${row.id}`}
                            type="number"
                            onWheel={blurOnWheel}
                            step="0.0001"
                            min="0"
                            max={row.batch ? rowCeiling(row.batch) : undefined}
                            disabled={!row.batch}
                            value={row.qty || ''}
                            /* 🔴 Retyping the quantity drops any split behind it.
                               `units` is a bifurcation OF this figure, so a row
                               moved to 6 while a 440 split hangs off it is a save
                               that contradicts itself. Cleared, the row is back to
                               the un-split case and spreads at save. */
                            onChange={(e) =>
                              setRow(row.id, { qty: Number(e.target.value) || 0, units: [] })
                            }
                            aria-label={
                              row.batch
                                ? `Quantity to issue from ${singular.toLowerCase()} ${batchLabel(row.batch)}`
                                : `Quantity — select a ${singular.toLowerCase()} first`
                            }
                            style={{
                              width: 120,
                              padding: '6px 8px',
                              fontSize: 13,
                              textAlign: 'right',
                              border: `1px solid ${overDrawn.has(row.id) ? '#fca5a5' : '#d1d5db'}`,
                              borderRadius: 4,
                              minHeight: 32,
                              background: row.batch ? '#fff' : '#f8fafc',
                            }}
                          />
                        </td>
                        <td style={td}>
                          <button
                            type="button"
                            onClick={() => clearOrRemoveRow(row.id)}
                            title={row.batch ? 'Clear this row' : 'Remove this row'}
                            aria-label={
                              row.batch
                                ? `Clear ${singular.toLowerCase()} ${batchLabel(row.batch)} from this row`
                                : 'Remove this row'
                            }
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
                              transition: 'color .12s, background .12s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = '#dc2626';
                              e.currentTarget.style.background = '#fef2f2';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = '#cbd5e1';
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>

                      {/* ── THE PACKAGES INSIDE THIS BATCH ────────────────────────────
                  🔴 THE TRIGGER ONLY — the picking happens in a full-screen dialog
                  of its own (`IssueUnitsModal`), the same way the four ENTRY
                  screens have opened this level since 2026-09-03. Expanded inline,
                  a batch of thirty rolls pushed every row under it off the screen,
                  and its sub-table had to fit inside one cell of the table above.

                  🔴 DOM order IS tab order, so this sits immediately after the
                  batch row it belongs to — Tab walks the batch, its packages, then
                  the next batch. */}
                      {showUnits && row.batch && (
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td colSpan={9} style={{ padding: '0 0 10px 0' }}>
                            {/* 🔴 Counts the SPLIT this row has committed, never the
                              rolls the batch happens to hold. Counting the batch's
                              made a freshly-picked batch announce "2 takas" before
                              anyone had split anything, reading as work already
                              done — and no count is the honest reading of a row
                              that will be spread at save. */}
                            <BatchUnitsTrigger
                              count={row.units.length}
                              singular={unitLabel.singular}
                              plural={unitLabel.plural}
                              onOpen={() => setUnitsRowId(row.id)}
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
          {/* 🔴 One link, not two. See the note on the component — there is no
            "New Batch" here on purpose. */}
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, blankRow()])}
            disabled={rows.length >= MAX_ROWS}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 6px',
              fontSize: 13,
              fontWeight: 500,
              color: rows.length >= MAX_ROWS ? '#94a3b8' : '#0062ff',
              background: 'none',
              border: 'none',
              cursor: rows.length >= MAX_ROWS ? 'not-allowed' : 'pointer',
            }}
          >
            <Plus size={14} /> Existing {singular}
          </button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {plural} added: {rows.filter((row) => row.batch).length}/{MAX_ROWS}
          </span>
        </div>
      </Modal>

      {/* 🔴 Keyed on the row, because the dialog seeds its DRAFT once on mount —
        the same hazard this grid carries. Cancel must leave the row untouched, so
        nothing in there writes back until Save. */}
      {unitsRow?.batch && (
        <IssueUnitsModal
          key={unitsRow.id}
          isOpen
          onCancel={() => setUnitsRowId(null)}
          onSave={(units, overwriteRow) => commitUnits(unitsRow.id, units, overwriteRow)}
          batchRef={unitsRow.batch.supplierBatchRef}
          batchSingular={singular}
          singular={unitLabel.singular}
          plural={unitLabel.plural}
          uomLabel={uomLabel}
          options={unitsRow.batch.units}
          initialRows={unitsRow.units}
          batchQty={unitsRow.qty}
          /* The line's own reconciliation, worded as the grid behind words it. */
          lineQty={lineQty}
          allocated={allocated}
          initialOverwrite={overwrite}
        />
      )}
    </>
  );
}

/** A batch row carries a reference and a balance, so the menu is wider than the
 * cell that opens it. */
const MENU_WIDTH = 360;
const MENU_MAX_HEIGHT = 280;
/** Above `Modal`'s overlay (1100) — the menu is a sibling of it on `document.body`. */
const MENU_Z_INDEX = 1200;
/** Below this much room under the anchor, the menu opens upwards instead. */
const MENU_MIN_HEIGHT = 170;

interface CellProps {
  value: AvailableBatch | null;
  options: AvailableBatch[];
  onChange: (batch: AvailableBatch) => void;
  /** Element id to focus once a batch is chosen — this row's quantity box. */
  focusAfterPickId: string;
  /** Name each option's godown. Only when the list spans several. */
  showGodown: boolean;
  uomLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  isLoading: boolean;
  isCapped: boolean;
  offeredCount: number;
  singular: string;
  plural: string;
}

/**
 * The "Select Batch" cell: a trigger button, and a panel holding its own search
 * box above the list.
 *
 * `useCombobox` rather than a hand-rolled menu, per CLAUDE.md — ↑↓ movement, Enter,
 * Esc, active-option tracking and open/close state are exactly what it is for. The
 * search input lives INSIDE the panel rather than being the trigger itself, which
 * is the one thing that has to be wired by hand: focus moves into it when the panel
 * opens, and Tab out of it closes the panel and hands focus back to the trigger.
 */
function BatchSelectCell({
  value,
  options,
  onChange,
  focusAfterPickId,
  showGodown,
  uomLabel,
  search,
  onSearchChange,
  isLoading,
  isCapped,
  offeredCount,
  singular,
  plural,
}: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  /**
   * Downshift's own id props rather than refs of ours. Two elements have to be
   * focused programmatically — the search box when the panel opens, the trigger
   * when Tab leaves it — and threading a ref through `getInputProps` reads it
   * during render, which `react-hooks/refs` forbids for good reason. Ids cost one
   * `getElementById` inside an effect or a handler, where reading the DOM is fine.
   */
  const uid = useId();
  const inputId = `${uid}-alloc-batch`;
  const toggleButtonId = `${uid}-alloc-toggle`;

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    closeMenu,
  } = useCombobox({
    items: options,
    id: uid,
    inputId,
    toggleButtonId,
    inputValue: search,
    selectedItem: value,
    itemToString: (batch) => (batch ? batchLabel(batch) : ''),
    onInputValueChange: ({ inputValue }) => onSearchChange(inputValue ?? ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      onChange(selectedItem);
      // After paint: the quantity box is disabled until this row has a batch, and a
      // disabled element cannot take focus. One frame later it is enabled.
      requestAnimationFrame(() => document.getElementById(focusAfterPickId)?.focus());
    },
    stateReducer: (state, { type, changes }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          /**
           * One batch per row, so a pick closes the panel — unlike a multi-select
           * picker there is nothing more to choose here.
           *
           * 🔴 And the search box is cleared with it. `inputValue` is the SHARED,
           * server-backed search for this item: downshift's own change puts the
           * chosen batch's label in it, which would leave the next row's dropdown
           * pre-filtered to the batch just taken — and that batch is no longer on
           * offer, so the next row opens on an empty list.
           */
          return { ...changes, inputValue: '', isOpen: false };
        case useCombobox.stateChangeTypes.InputBlur:
          // 🔴 Downshift selects the highlighted item on blur. Clicking away from a
          // half-open list is not a choice, and quietly allocating whatever
          // happened to be under the cursor is the worst available reading of it.
          return { ...changes, selectedItem: state.selectedItem, inputValue: '', isOpen: false };
        default:
          return changes;
      }
    },
  });

  // Focus follows the panel, or the search box the design puts there would need a
  // deliberate click to reach and the keyboard path would dead-end at the trigger.
  useEffect(() => {
    if (isOpen) document.getElementById(inputId)?.focus();
  }, [isOpen, inputId]);

  /**
   * 🔴 ESCAPE BELONGS TO THE DROPDOWN WHILE THE DROPDOWN IS OPEN.
   *
   * `Modal` listens for Escape on `document` in the CAPTURE phase, and this panel
   * is portalled to `document.body` — so one Escape over an open batch list closed
   * the whole Add Batches dialog and threw away the allocation, which is precisely
   * the bug `Modal`'s own nesting stack exists to prevent for dialogs.
   *
   * `window` is ahead of `document` in the capture path, which is what lets this
   * one run first and stop the event before the dialog ever sees it.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeMenu();
      // Focus has to follow the panel back into the dialog, or it is left on an
      // input that is no longer visible.
      document.getElementById(toggleButtonId)?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, closeMenu, toggleButtonId]);

  /**
   * 🔴 THE MENU IS PORTALLED OUT OF THE DIALOG, and it has to be.
   *
   * Everything between this cell and the viewport clips it: the grid is an
   * `overflow-x: auto` box, and `Modal`'s body is the vertical scroll container. An
   * absolutely positioned menu is cut off at the grid's edge — the list opens
   * inside the table and most of it is unreachable.
   *
   * `position: fixed` on `document.body` escapes both, at the price of measuring
   * the anchor. Re-measured on scroll in the CAPTURE phase: the scrollers are the
   * dialog body and the grid, and `scroll` does not bubble, so a listener on
   * `window` never hears either and the menu hangs in mid-air.
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
      // Flip up only when below is genuinely too tight AND above is roomier —
      // otherwise a menu near the bottom of a tall dialog flaps between the two.
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

  const emptyMessage = isLoading
    ? 'Looking up available stock…'
    : search
      ? 'No batch here matches that.'
      : 'No batch of this item is available at this location for this job order’s ownership.';

  return (
    <div ref={anchorRef} style={{ position: 'relative', width: 210, maxWidth: '100%' }}>
      <button
        type="button"
        /**
         * 🔴 `tabIndex: 0` IS LOAD-BEARING — downshift returns -1 here.
         *
         * `useCombobox` assumes the INPUT is the anchor and the toggle is a
         * secondary chevron beside it, so it deliberately takes the button out of
         * the tab order (that is correct for `ui/ComboBox.tsx` and
         * `ui/ItemComboBox.tsx`, where the input carries the focus). This cell
         * inverts that — the button IS the control and the search box lives inside
         * the panel — so the default made every dropdown in the grid unreachable by
         * Tab, with nothing in `tsc` or a screenshot to say so.
         *
         * Override the prop getter rather than hand-rolling key handling: the
         * library still owns open/close, ↑↓, Enter and Esc.
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
          border: `1px solid ${isOpen ? '#0062ff' : '#d1d5db'}`,
          borderRadius: 4,
          background: '#fff',
          color: value ? '#111' : '#94a3b8',
          cursor: 'pointer',
          minHeight: 34,
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={value ? batchLabel(value) : undefined}
        >
          {value ? batchLabel(value) : `Select ${singular}`}
        </span>
        <ChevronDown
          size={14}
          color="#94a3b8"
          style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {/* Rendered whether open or not: downshift needs `getMenuProps`' ref on a live
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
                placeholder: `Search ${plural.toLowerCase()} of this item`,
                'aria-label': `Search ${plural.toLowerCase()}`,
                /**
                 * Tab must not walk into the portal, which lives outside the
                 * dialog `Modal` traps focus within — the next Tab from here would
                 * escape into the browser chrome. Closing and handing focus back to
                 * the trigger keeps the keyboard path inside the dialog.
                 */
                onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
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
            {isOpen &&
              (options.length === 0 ? (
                <li style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>
                  {emptyMessage
                    .replace('batch', singular.toLowerCase())
                    .replace('batches', plural.toLowerCase())}
                </li>
              ) : (
                <>
                  {options.map((batch, index) => (
                    <li
                      key={rowKey(batch)}
                      {...getItemProps({ item: batch, index })}
                      style={{
                        padding: '8px 12px',
                        fontSize: 13,
                        cursor: 'pointer',
                        background: highlightedIndex === index ? '#0062ff' : '#fff',
                        color: highlightedIndex === index ? '#fff' : '#111',
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{batchLabel(batch)}</div>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 500,
                          color: highlightedIndex === index ? '#e0edff' : '#64748b',
                        }}
                      >
                        Balance in batch: {formatQty(batch.availableQty)} {uomLabel}
                        {/* Which godown, when the list spans more than one — two
                            rows can both read `jv2` and be different stock. */}
                        {showGodown && batch.locationName ? ` · ${batch.locationName}` : ''}
                      </div>
                    </li>
                  ))}
                  {isCapped && (
                    <li style={{ padding: '8px 12px', fontSize: 11, color: '#92400e' }}>
                      Only the first {offeredCount} batches are listed — type to narrow.
                    </li>
                  )}
                </>
              ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
