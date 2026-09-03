import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';
import { ChevronDown, ChevronRight, Plus, Search, Warehouse, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatch } from '../batches/batches.api';
import { batchLabel, rowKey, selectionKey, type BatchSelection } from './batchSelection';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';

/** Zoho's ceiling, and a sane one — a hundred allocation rows on one line is
 * already past what anyone reconciles by eye. */
const MAX_ROWS = 100;

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
   * 🔴 THE UNTAGGED QUANTITY ONLY, once packages exist.
   *
   * A batch broken into rolls has two independent pools: the rolls, taken whole
   * by ticking them, and whatever is loose. This box is the second one — capped
   * at the batch's own `untaggedQty`, which the SERVER sends because a search or
   * a limit can trim the roll list and subtracting what is on screen would
   * overstate what is free.
   */
  qty: number;
  /**
   * 🔴 THE ROLLS THIS ROW DRAWS ON — a LIST that is picked into, not the batch's
   * whole roll list with a box against each.
   *
   * Rendering every package was fine at three and unusable at thirty: the row
   * became a wall of inputs, almost all of them empty, and finding "T-27" meant
   * reading past twenty-six others. A picked list asks the same question the
   * batch row above asks — choose one, say how much — and stays one line per roll
   * actually used.
   *
   * 🔴 A QUANTITY, NEVER A TICK. Part of a roll is a real answer on every screen
   * that reaches this grid — 20 m off a 100 m roll on an assembly, a short issue
   * against a part-used roll — so the amount is always typed and never inferred
   * from the roll's balance.
   */
  units: IssueUnitRow[];
}

/** One picked roll. `id` is a local slot key, because the row exists from the
 * moment "+ Add {unit}" is pressed and before any package has been chosen — the
 * same reason `DraftRow` cannot be keyed on its batch. */
interface IssueUnitRow {
  id: string;
  /** Empty until the user picks one. */
  batchUnitId: string;
  qty: number;
}

const unitHeaderStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: '#ef4444',
  textTransform: 'uppercase',
  textAlign: 'left',
  padding: '0 6px 4px 0',
};

let unitSeq = 0;
const blankUnitRow = (): IssueUnitRow => ({
  id: `unit-${unitSeq++}`,
  batchUnitId: '',
  qty: 0,
});

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
 * the grid shows one row per batch with its rolls ticked underneath. So re-opening
 * a dialog that sent three rolls of one batch must show one row with three ticks,
 * not three rows for the same batch that the user cannot tell apart.
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
    else row.qty += sel.qty;
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
   * Which rows have their package list OPEN — closed by default, and stated this
   * way round so "nothing recorded" means "nothing open". A batch of thirty rolls
   * is one line until it is asked for; the toggle says how many are in there and
   * how many are picked, so nothing is hidden that the reader needed.
   */
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const unitsOpen = (rowId: string) => expandedUnits.has(rowId);

  /** Everything this row sends: what was typed against each roll, plus whatever
   * untagged quantity was typed beside them. */
  const rowTotal = (row: DraftRow) =>
    row.batch
      ? row.qty + row.units.reduce((sum, unit) => sum + (unit.batchUnitId ? unit.qty : 0), 0)
      : 0;

  /** What may be typed into a row's quantity box: the batch's untagged remainder
   * once it has packages, and its whole balance when it has none. */
  const untaggedCeiling = (batch: AvailableBatch) =>
    unitLabel.enabled && batch.units.length > 0
      ? toNumber(batch.untaggedQty ?? batch.availableQty)
      : toNumber(batch.availableQty);

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

  /* 🔴 Measured against the UNTAGGED ceiling, not the batch total. A batch whose
     rolls hold all of it has nothing loose, so any typed quantity overdraws it —
     and the server refuses exactly that. Checking the batch total here would let
     the dialog accept a row the save then rejects, with a message about an
     invariant the user has never seen. */
  const overDrawn = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (row) =>
              row.batch &&
              (row.qty > untaggedCeiling(row.batch) + 0.00005 ||
                // A package line asking for more than that roll holds.
                row.units.some((slot) => {
                  const picked = row.batch!.units.find((u) => u.batchUnitId === slot.batchUnitId);
                  return picked && slot.qty > toNumber(picked.availableQty) + 0.00005;
                })),
          )
          .map((row) => row.id),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, unitLabel.enabled],
  );

  /** 🔴 A quantity typed against no package picked. The save skips such a line,
   * so without this the amount simply vanishes on Save with nothing said — the
   * one failure worse than refusing to save. */
  const unpickedUnits = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.units.some((slot) => !slot.batchUnitId && slot.qty > 0))
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

  const toggleUnitsOpen = (rowId: string) =>
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const patchUnitRow = (rowId: string, slotId: string, patch: Partial<IssueUnitRow>) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              units: row.units.map((unit) => (unit.id === slotId ? { ...unit, ...patch } : unit)),
            }
          : row,
      ),
    );

  /** Adding a slot opens the panel, so pressing "Add" and seeing nothing appear
   * cannot happen. */
  const addUnitRow = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, units: [...row.units, blankUnitRow()] } : row,
      ),
    );
    setExpandedUnits((prev) => new Set(prev).add(rowId));
  };

  const removeUnitRow = (rowId: string, slotId: string) =>
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, units: row.units.filter((unit) => unit.id !== slotId) } : row,
      ),
    );

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

  const canSave = overDrawn.size === 0 && unpickedUnits.size === 0;

  const handleSave = () => {
    if (!canSave) return;
    /**
     * 🔴 ONE ENTRY PER PACKAGE, plus one for whatever was typed loose — because
     * one entry becomes one challan line, and three rolls of a batch are three
     * lines exactly as three batches are.
     *
     * A ticked roll carries its OWN balance as the quantity, never a typed one:
     * a package goes out whole, and the server refuses a line that says otherwise.
     */
    const next: Record<string, BatchSelection> = {};
    for (const row of rows) {
      if (!row.batch) continue;
      for (const { batchUnitId, qty } of row.units) {
        // A slot nobody picked into, or one with nothing typed, is a blank row —
        // skipped exactly as a batch row with no batch is.
        if (!batchUnitId || !(qty > 0)) continue;
        const unit = row.batch.units.find((u) => u.batchUnitId === batchUnitId);
        if (!unit) continue;
        /* The quantity the row holds, never the package's balance — in atomic
           mode they are the same, and in quantity mode the typed figure is the
           whole answer. */
        next[selectionKey(row.batch, batchUnitId)] = { batch: row.batch, unit, qty };
      }
      if (row.qty > 0) {
        next[selectionKey(row.batch, null)] = { batch: row.batch, unit: null, qty: row.qty };
      }
    }
    onSave(next, overwrite ? allocated : null);
    onClose();
  };

  return (
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
                <th style={{ ...th, width: 130, textAlign: 'right', color: '#b91c1c' }} scope="col">
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
                          max={row.batch ? untaggedCeiling(row.batch) : undefined}
                          disabled={!row.batch}
                          value={row.qty || ''}
                          onChange={(e) => setRow(row.id, { qty: Number(e.target.value) || 0 })}
                          aria-label={
                            row.batch
                              ? `Untagged quantity to issue from ${singular.toLowerCase()} ${batchLabel(row.batch)}`
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

                    {/* ── THE ROLLS INSIDE THIS BATCH ───────────────────────────────
                  🔴 CHECKBOXES, NOT QUANTITIES (plan §2.3). A package is atomic
                  at issue: ticking it sends all of it, which is how a roll
                  physically moves and what keeps the allocator free of a second
                  running total to reconcile.

                  🔴 DOM order IS tab order, so this sits immediately after the
                  batch row it belongs to — Tab walks the batch, its rolls, then
                  the next batch. */}
                    {showUnits && row.batch && (
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td colSpan={9} style={{ padding: '0 0 10px 0' }}>
                          {/* 🔴 The toggle sits ABOVE the panel it opens, in a block of
                        its own — below it, the reader had to know a list was
                        there before finding the control that reveals it, and the
                        two on one line dragged the chevron off its baseline. */}
                          <div>
                            <button
                              type="button"
                              /* 🔴 When it READS "Add {plural}" it must ADD one. Opening
                           a panel whose only content is a second "Add" button is
                           two clicks and two identical labels for one action. */
                              onClick={() =>
                                !unitsOpen(row.id) && row.units.length === 0
                                  ? addUnitRow(row.id)
                                  : toggleUnitsOpen(row.id)
                              }
                              aria-expanded={unitsOpen(row.id)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#0062ff',
                                fontSize: 12,
                                fontWeight: 500,
                                padding: '4px 2px',
                                borderRadius: 4,
                              }}
                            >
                              {unitsOpen(row.id) ? (
                                <ChevronDown size={13} />
                              ) : (
                                <ChevronRight size={13} />
                              )}
                              {/* 🔴 Counts the lines THIS row has added, never the rolls
                            the batch happens to hold. Counting the batch's made a
                            freshly-picked batch announce "2 takas" before anyone
                            had added one, reading as work already done. */}
                              {row.units.length > 0
                                ? `${row.units.length} ${(row.units.length === 1 ? unitLabel.singular : unitLabel.plural).toLowerCase()}`
                                : `Add ${unitLabel.plural.toLowerCase()}`}
                            </button>
                          </div>

                          {unitsOpen(row.id) && (
                            <div
                              style={{
                                width: 'fit-content',
                                marginTop: 4,
                                marginLeft: 17,
                                background: '#f8fafc',
                                border: '1px solid #eef0f3',
                                borderRadius: 4,
                                padding: '8px 12px',
                              }}
                            >
                              {/* 🔴 ONE LINE PER ROLL ACTUALLY USED, picked from a
                            searchable list — the same question the Existing
                            {batch} row above asks. Listing the batch's whole roll
                            set with a box against each was a wall of mostly-empty
                            inputs the moment a batch held more than a handful. */}
                              {row.units.length > 0 && (
                                <table style={{ borderCollapse: 'collapse', marginBottom: 4 }}>
                                  <thead>
                                    <tr>
                                      <th style={unitHeaderStyle}>{unitLabel.singular}*</th>
                                      <th style={{ ...unitHeaderStyle, textAlign: 'right' }}>
                                        Quantity*
                                      </th>
                                      <th style={{ width: 28 }} />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.units.map((slot) => {
                                      const picked = row.batch!.units.find(
                                        (u) => u.batchUnitId === slot.batchUnitId,
                                      );
                                      const ceiling = picked ? toNumber(picked.availableQty) : 0;
                                      return (
                                        <tr key={slot.id}>
                                          <td
                                            style={{
                                              padding: '3px 6px 3px 0',
                                              verticalAlign: 'middle',
                                              width: 200,
                                            }}
                                          >
                                            <SearchableSelect
                                              value={slot.batchUnitId}
                                              onChange={(value) =>
                                                patchUnitRow(row.id, slot.id, {
                                                  batchUnitId: value,
                                                })
                                              }
                                              /* Rolls already taken by a sibling slot are
                                           dropped: picking one twice would send it
                                           on two lines of the same challan. */
                                              options={row
                                                .batch!.units.filter(
                                                  (u) =>
                                                    u.batchUnitId === slot.batchUnitId ||
                                                    !row.units.some(
                                                      (other) =>
                                                        other.id !== slot.id &&
                                                        other.batchUnitId === u.batchUnitId,
                                                    ),
                                                )
                                                /* The label alone. The balance belongs
                                             beside the quantity being typed, not
                                             inside the name of the thing. */
                                                .map((u) => ({
                                                  value: u.batchUnitId,
                                                  label: u.label,
                                                }))}
                                              placeholder={`Select a ${unitLabel.singular.toLowerCase()}…`}
                                              triggerStyle={{
                                                minHeight: 30,
                                                height: 30,
                                                padding: '0 8px',
                                                borderRadius: 4,
                                                fontSize: 12.5,
                                              }}
                                              portal
                                            />
                                          </td>
                                          <td
                                            style={{
                                              padding: '3px 6px 3px 0',
                                              verticalAlign: 'middle',
                                            }}
                                          >
                                            {/* 🔴 A QUANTITY, on every screen that reaches
                                          this grid. Part of a roll is a real answer
                                          — 20 m off a 100 m roll — so the amount is
                                          typed, never inferred from its balance. */}
                                            <input
                                              type="number"
                                              onWheel={blurOnWheel}
                                              step="0.0001"
                                              min="0"
                                              max={ceiling}
                                              value={slot.qty || ''}
                                              aria-label={`Quantity from ${picked?.label ?? unitLabel.singular}`}
                                              onChange={(e) =>
                                                patchUnitRow(row.id, slot.id, {
                                                  qty: Number(e.target.value) || 0,
                                                })
                                              }
                                              style={{
                                                width: 110,
                                                height: 30,
                                                padding: '0 8px',
                                                fontSize: 12.5,
                                                textAlign: 'right',
                                                background: '#fff',
                                                border: `1px solid ${
                                                  slot.batchUnitId && slot.qty > ceiling + 0.00005
                                                    ? '#fca5a5'
                                                    : '#d1d5db'
                                                }`,
                                                borderRadius: 4,
                                              }}
                                            />
                                          </td>
                                          <td
                                            style={{ textAlign: 'center', verticalAlign: 'middle' }}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => removeUnitRow(row.id, slot.id)}
                                              aria-label={`Remove ${picked?.label ?? unitLabel.singular}`}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: '#ef4444',
                                                padding: 4,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                borderRadius: 4,
                                              }}
                                            >
                                              <X size={13} />
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}

                              <button
                                type="button"
                                onClick={() => addUnitRow(row.id)}
                                disabled={row.units.length >= row.batch.units.length}
                                title={
                                  row.units.length >= row.batch.units.length
                                    ? `Every ${unitLabel.singular.toLowerCase()} in this ${singular.toLowerCase()} is already on a line.`
                                    : undefined
                                }
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  background: 'none',
                                  border: 'none',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  color:
                                    row.units.length >= row.batch.units.length
                                      ? '#cbd5e1'
                                      : '#0062ff',
                                  cursor:
                                    row.units.length >= row.batch.units.length
                                      ? 'not-allowed'
                                      : 'pointer',
                                }}
                              >
                                <Plus size={13} /> Add {unitLabel.singular}
                              </button>
                            </div>
                          )}
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
