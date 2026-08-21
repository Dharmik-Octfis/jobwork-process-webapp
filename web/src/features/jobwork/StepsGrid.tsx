import { blurOnWheel } from '../../components/ui/blurOnWheel';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchAvailableBatches } from './batches/batches.api';
import { AddBatchesModal } from './issues/AddBatchesModal';
import { rowKey } from './issues/batchSelection';
import { ItemComboBox } from '../../components/ui/ItemComboBox';
import { Select } from '../../components/ui/Select';
import { useUoms } from '../inventory/uom/uom.api';
import { itemsApi } from '../items/items.api';
import type { Item } from '../items/items.schemas';
import { fetchVendors } from '../purchases/vendors/vendors.api';
import { fetchLocations } from '../configuration/locations/locations.api';
import { ProcessSelect } from './processes/ProcessSelect';
import { RATE_BASIS_OPTIONS } from './processes/processes.schemas';
import {
  PROCESSOR_TYPE_OPTIONS,
  derivedExpectedQty,
  emptyStep,
  emptyStepItem,
  feedsSteps,
  formatQty,
  overPlanWarning,
  primaryOutputIndex,
  producedByStep,
  type StepGridRow,
  type StepItemRow,
} from './jobwork.schemas';

/**
 * One grid, both modules.
 *
 * This is the one place the route/job-order duplication is NOT worth keeping.
 * The two are separate in the database and separate in the API for a real reason
 * (a job order step is a snapshot, not a reference, §2.4), but on screen they are
 * the same twelve controls in the same order — and two copies of a grid this size
 * means every accessibility fix has to be made twice, which is how one of them
 * quietly stops being keyboard-correct.
 *
 * `StepGridRow` and `emptyStep` live in `jobwork.schemas.ts` so this file exports
 * components only, which is what keeps fast refresh working for it.
 */
/** Same ceiling the Issue dialog uses. The picker says so when it hits it rather
 * than showing a slice as if it were everything. */
const PLAN_BATCH_LIMIT = 200;

interface Props<T extends StepGridRow> {
  steps: T[];
  onChange: (steps: T[]) => void;
  /** Server-side chain errors, keyed `steps.<index>.<field>`. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /**
   * Job orders: a quantity on BOTH lists plus the per-item tolerance box. The
   * order is real, so how much of each item goes out, how much is expected back,
   * and which item may run over are all answerable.
   *
   * There is no unit label prop any more: every row shows its OWN item's unit
   * beside it, because one header unit cannot caption metres, cones and pieces.
   */
  showPlannedQty?: boolean;
  /**
   * Routes: a quantity on CONSUMES ALONE — the amount this org usually runs,
   * which the job order copies once and then owns (§2.4).
   *
   * Not on PRODUCES, and not the tolerance box. What comes back and how far over
   * a step may run are per-run answers a template cannot know, and pre-filling
   * either would put a number on the receipt screen nobody had reason to believe.
   */
  showInputQty?: boolean;
  /**
   * 🔴 Job orders only. Lets the planner note WHICH batches a batch-tracked input
   * is meant to come out of (`JobOrderStepInputBatch`).
   *
   * Never on a route: a template is reused across runs, and a batch is a specific
   * roll that will be gone by the next one — a route that named batches would be
   * wrong the second time it was used, and silently.
   */
  allowPlannedBatches?: boolean;
  /** own | customer. Decides which batches may even be offered — one customer's
   * goods must never be planned into another's order (§5.3). */
  ownership?: string;
  /**
   * How many steps already exist above these. The grid captions positions, and on
   * the append dialog position 1 of the array is step 4 of the order — a block
   * headed "Step 1" there would name a step that already exists and has challans
   * against it. Error keys stay on the ARRAY index, which is what the server
   * numbers its `details` by.
   */
  seqOffset?: number;
  /**
   * Items produced by steps above these, `itemId → seq`. Only the append dialog
   * passes it: the chain badge can otherwise only see the steps in this array, so
   * an input fed by an existing step would be labelled "From stock" — the exact
   * mistake the badge exists to catch.
   */
  priorProducers?: ReadonlyMap<string, number>;
  /**
   * How much of each item those earlier steps have LEFT — outputs they expect,
   * less what they already plan to consume. Append dialog only, and only for the
   * over-plan note: without it a step fed by an existing step has no ceiling to
   * be measured against and simply says nothing.
   */
  priorSpare?: ReadonlyMap<string, number>;
  /**
   * 🔴 How many steps from the top are FROZEN — the work front (§6.6). Challans
   * point at those rows by id and print their `seq`, so they cannot be edited,
   * moved, or removed, and nothing below may be moved up into them.
   *
   * A count rather than a per-row flag because it is a PREFIX: an untouched step
   * between two started ones is frozen too, since removing it would renumber the
   * started steps after it.
   */
  lockedCount?: number;
  /**
   * 🔴 True wherever this grid is rendered inside a `Modal` — today, the append
   * dialog. The item picker's menu is otherwise clipped by the dialog's scrolling
   * body on both axes and most of the list is unreachable (CLAUDE.md).
   */
  portalMenus?: boolean;
}

const cellInput: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  minHeight: 30,
};

/** A value the server owns. Same box as `cellInput` so the row does not jump, but
 * flat and grey so it reads as a stated fact rather than an empty control. Not
 * focusable on purpose — there is nothing here to change. */
const cellReadOnly: React.CSSProperties = {
  ...cellInput,
  display: 'flex',
  alignItems: 'center',
  background: '#f4f5f7',
  borderColor: '#e2e8f0',
  color: '#475569',
};

/** One field's caption. A `<span>`, not a `<label>`: most of these controls are
 * `Select`, which renders a button with no id to point `htmlFor` at — the control
 * carries its own `ariaLabel` instead. The native inputs do get real labels. */
const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  marginBottom: 4,
};

const iconButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  color: '#64748b',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 7px',
  borderRadius: 9,
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

/** Off-screen but READ ALOUD. The quantity boxes are too narrow for a visible
 * caption, and a bare number box with no accessible name is a field a screen
 * reader announces as "edit text" and nothing more. */
const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

interface ItemListProps {
  side: 'inputs' | 'outputs';
  rows: StepItemRow[];
  onChange: (rows: StepItemRow[]) => void;
  orgId: string;
  /** Every item this grid can already name — the ones it preloaded plus the ones
   * picked since. Only used to caption a row that already has an item; the
   * picker fetches its own page at a time. */
  itemById: ReadonlyMap<string, Item>;
  /** An item chosen from the picker, which the grid may never have preloaded.
   * Registering it is what lets its unit, tracking mode and name resolve. */
  onItemPicked: (item: Item) => void;
  /** The unit the item is configured to move in — id to carry, label to print.
   * `null` when the item has no stocking unit and the row must ask. */
  itemUnit: (itemId: string | null | undefined) => { uomId: string; label: string } | null;
  /** Same answer read straight off a just-picked item, before it has been
   * registered — the row's unit has to be written in the same update. */
  unitOfItem: (item: Item) => string | null;
  uomOptions: { value: string; label: string }[];
  /** 🔴 True wherever this grid sits inside a `Modal` — see `ItemComboBox`. */
  portalMenus?: boolean;
  showQty?: boolean;
  /** The per-item over-issue box. Job orders only — separate from `showQty`
   * because a route carries a default quantity but no tolerance. */
  showTolerance?: boolean;
  /**
   * 🔴 The STEP's tolerance, shown greyed inside each blank row's box.
   *
   * Blank on a row does not mean "no tolerance" — it means "use the step's"
   * (`jobIssues.service.ts` resolves `row.tolerancePct ?? step.tolerancePct`), and
   * an empty box reads as exactly the opposite. A placeholder rather than a value
   * written into the row: a copy freezes at the moment it is made, so changing the
   * step afterwards would strand stale numbers that nothing could distinguish from
   * ones somebody typed deliberately.
   */
  stepTolerancePct?: number | null;
  /**
   * …and the same trick on the quantity box: what the server will store if this
   * row is left blank, or `null` when it will store nothing and the box is really
   * asking. Only the PRODUCES side passes it today (`derivedExpectedQty`).
   */
  qtyPlaceholderFor?: (row: StepItemRow, rowIndex: number) => number | null;
  disabled?: boolean;
  /** Array position — error keys and control ids. */
  stepIndex: number;
  /** Position in the ORDER — what a human is told. The two differ when appending. */
  stepNumber: number;
  errors?: Record<string, string>;
  badgeFor: (
    row: StepItemRow,
    rowIndex: number,
  ) => { text: string; tone: 'chain' | 'stock' } | null;
  /** An advisory note under the row — today, only the over-plan one (§6.4.0).
   * Returns null when there is nothing to say, which is the usual answer. */
  warningFor?: (row: StepItemRow) => string | null;
  /** Shown when the list is empty. Says what an empty list MEANS, never what the
   * server might invent — it invents nothing now. */
  emptyHint: string;
  /**
   * Outputs only — the CONSUMES rows this list can be copied from. A process
   * that does not change the item returns exactly what it took, which is one
   * tick instead of retyping every row.
   */
  mirrorSource?: StepItemRow[];
  /**
   * Inputs, job orders only. Opens the planner's batch grid for one row. Absent
   * means the whole affordance is off — see `allowPlannedBatches`.
   */
  onPlanBatches?: (rowIndex: number) => void;
  /** Whether this item's batches are the user's to pick. Untracked items have
   * batches too, but nobody is meant to identify them (`inventoryTracking`). */
  isBatchTracked?: (itemId: string | null | undefined) => boolean;
}

/**
 * 🔴 ONE SIDE OF A STEP'S BILL OF MATERIALS — the control this whole screen was
 * missing (§5.7).
 *
 * Before this, a step had one issue item and one receive item, so stitching could
 * not say it takes panels AND thread AND buttons, and cutting could not say it
 * returns panels AND offcuts. Both are the normal case, not an edge case.
 *
 * THE BADGE IS THE POINT, not decoration. On the input side it says whether the
 * item is fed by an earlier step or drawn from stock — the classification the
 * server stores as `fromStock` (§6.4) — and on the output side, which later steps
 * take it. "Ends here" is a perfectly good answer: finished goods and offcuts
 * both stop at the godown. What it makes visible is the other case, an item
 * somebody MEANT to feed onward and mistyped, which is otherwise invisible until
 * the next step's batch picker turns up empty days later.
 *
 * Every control is a native `<input>`, a `<button>`, or `Select` (a button-based
 * combobox), so the whole list is reachable and operable from the keyboard —
 * including Remove, which as a `<div onClick>` would be unreachable and nothing
 * would report it (CLAUDE.md).
 */
function ItemList({
  side,
  rows,
  onChange,
  orgId,
  itemById,
  onItemPicked,
  itemUnit,
  unitOfItem,
  uomOptions,
  portalMenus,
  showQty,
  showTolerance,
  stepTolerancePct,
  qtyPlaceholderFor,
  disabled,
  stepIndex,
  stepNumber,
  errors,
  badgeFor,
  warningFor,
  emptyHint,
  mirrorSource,
  onPlanBatches,
  isBatchTracked,
}: ItemListProps) {
  const isInput = side === 'inputs';
  const update = (rowIndex: number, patch: Partial<StepItemRow>) =>
    onChange(rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)));

  /**
   * 🔴 SAME AS CONSUMED — a copy, not a live mirror.
   *
   * Ticking writes the CONSUMES rows into PRODUCES as ordinary rows: every one
   * of them stays editable, deletable, and free to carry a different expected
   * quantity, because "returns what it took" is where a step STARTS, not what it
   * is bound to. A live mirror would have to fight every one of those edits.
   *
   * The box is therefore not state of its own — it is checked when PRODUCES
   * already lists exactly the items CONSUMES does, in the same order. Change an
   * item and it unticks itself, which is the truth; change a quantity and it
   * stays ticked, because the same items still come back.
   */
  const mirrorRows = (mirrorSource ?? []).filter((row) => row.itemId);
  const mirrored =
    mirrorRows.length > 0 &&
    rows.length === mirrorRows.length &&
    rows.every((row, i) => row.itemId === mirrorRows[i]!.itemId);

  const toggleMirror = () =>
    onChange(
      mirrored
        ? []
        : mirrorRows.map((row) => ({
            ...emptyStepItem(),
            itemId: row.itemId,
            uomId: row.uomId ?? null,
            // What went in is what is expected back — the starting number, not a
            // rule. Only on a job order: a route has no quantities at all.
            expectedQty: showQty ? (row.plannedQty ?? null) : null,
          })),
    );

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, background: '#fcfcfd' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #eef0f3',
          minHeight: 33,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: 0.3 }}>
          {isInput ? 'CONSUMES' : 'PRODUCES'}
        </span>

        {/* A native checkbox inside its label: focusable, toggled with Space,
            and disabled-aware for free — none of which a styled div would be. */}
        {!isInput && mirrorSource && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginLeft: 'auto',
              fontSize: 11,
              color: mirrorRows.length === 0 ? '#94a3b8' : '#475569',
              cursor: disabled || mirrorRows.length === 0 ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={
              mirrorRows.length === 0
                ? 'List what the step consumes first, then this copies it here.'
                : 'Copy every item from CONSUMES into PRODUCES. Each row stays editable; unticking clears them.'
            }
          >
            <input
              type="checkbox"
              checked={mirrored}
              onChange={toggleMirror}
              disabled={disabled || mirrorRows.length === 0}
              aria-label={`Step ${stepNumber} produces the same items it consumes`}
            />
            Same as consumed
          </label>
        )}
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* 🔴 An empty list means an empty list. Nothing is added behind your
            back — what these rows say is exactly what is written. */}
        {rows.length === 0 && (
          <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{emptyHint}</p>
        )}

        {rows.map((row, rowIndex) => {
          const rowError = errors?.[`steps.${stepIndex}.${side}.${rowIndex}.itemId`];
          const unit = itemUnit(row.itemId);
          const badge = badgeFor(row, rowIndex);
          // Advisory, so it never blocks the button and never colours the box the
          // way `rowError` does — this is a remark, not a rejection (§6.4.0).
          const warning = warningFor?.(row) ?? null;
          // What the server stores if the box is left blank. `null` means it
          // stores nothing either, and the box is genuinely asking.
          const derivedQty = qtyPlaceholderFor?.(row, rowIndex) ?? null;
          const qtyId = `step-${stepIndex}-${side}-${rowIndex}-qty`;
          return (
            <div key={rowIndex} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* 🔴 A SEARCHING PICKER, not a dropdown of every item in the org.
                    A plain `Select` had to be handed the whole catalogue up front,
                    which is one long request before the form is usable and an
                    unscrollable list once an org passes a few hundred items. This
                    fetches ten at a time, appends the next ten as the list is
                    scrolled, and searches the server from the third character —
                    below that there is nothing to narrow and every item matches. */}
                <div style={{ flex: '2 1 150px', minWidth: 0 }}>
                  <ItemComboBox
                    orgId={orgId}
                    value={row.itemId || null}
                    initialItem={row.itemId ? (itemById.get(row.itemId) ?? null) : null}
                    /* 🔴 The unit comes WITH the item (§5.1). Picking one carries
                       its stocking unit onto the row, so what is saved is what the
                       box shows instead of a null the server fills in later; an
                       item with no stocking unit clears it back to the dropdown,
                       because the previous item's unit is not this item's. */
                    onChange={(item) => {
                      if (item) onItemPicked(item);
                      update(rowIndex, {
                        itemId: item?.id ?? '',
                        uomId: item ? unitOfItem(item) : null,
                      });
                    }}
                    placeholder="Select an item…"
                    hasError={Boolean(rowError)}
                    disabled={disabled}
                    portal={portalMenus}
                    name={`step-${stepIndex}-${side}-${rowIndex}-item`}
                    ariaLabel={`Step ${stepNumber} ${isInput ? 'input' : 'output'} ${rowIndex + 1} item`}
                  />
                </div>

                {/* One item, one stocking unit (§5.1) — so this is a fact, not a
                    choice, wherever the item can answer. */}
                <div style={{ flex: '0 0 62px' }}>
                  {unit ? (
                    <div
                      style={{ ...cellReadOnly, justifyContent: 'center' }}
                      title="The item’s stocking unit"
                    >
                      {unit.label}
                    </div>
                  ) : (
                    <Select
                      value={row.uomId ?? ''}
                      onChange={(value) => update(rowIndex, { uomId: value || null })}
                      options={uomOptions}
                      disabled={disabled}
                      ariaLabel={`Step ${stepNumber} ${isInput ? 'input' : 'output'} ${rowIndex + 1} unit`}
                      minWidth={0}
                      portal={portalMenus}
                    />
                  )}
                </div>

                {/* 🔴 THE PER-ITEM QUANTITY. 2,910 PCS of panels, 12 CONE of
                    thread, 8,700 PCS of buttons — three numbers, because their
                    sum is 11,622 of nothing (§6.5). */}
                {showQty && (
                  <div style={{ flex: '0 0 84px' }}>
                    <label htmlFor={qtyId} style={srOnly}>
                      {`Step ${stepNumber} ${isInput ? 'planned' : 'expected'} quantity for row ${rowIndex + 1}`}
                    </label>
                    <input
                      id={qtyId}
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      value={(isInput ? row.plannedQty : row.expectedQty) ?? ''}
                      onChange={(e) => {
                        const value = e.target.value === '' ? null : Number(e.target.value);
                        update(rowIndex, isInput ? { plannedQty: value } : { expectedQty: value });
                      }}
                      disabled={disabled}
                      /* 🔴 Grey, never written into the row. It says what the
                         server will store if this is left blank, so an empty box
                         stops reading as "expect nothing". No placeholder means
                         the server stores nothing either and the box is genuinely
                         asking — see `derivedExpectedQty`. */
                      placeholder={
                        derivedQty !== null ? formatQty(derivedQty) : isInput ? 'qty' : 'expected'
                      }
                      title={
                        isInput
                          ? 'How much of this item the step consumes'
                          : derivedQty !== null
                            ? `How much of this item is expected back. Left blank it plans ${formatQty(derivedQty)} — the quantity that goes in.`
                            : 'How much of this item is expected back. It returns in a different unit from what goes in, so nothing can be assumed — state it, or the next step has no quantity to plan from.'
                      }
                      style={cellInput}
                    />
                  </div>
                )}

                {/* Blank means "use the step's" — fabric at 3% beside thread at
                    25%, because small quantities vary more. */}
                {showTolerance && isInput && (
                  <div style={{ flex: '0 0 66px' }}>
                    <label htmlFor={`${qtyId}-tol`} style={srOnly}>
                      {`Step ${stepNumber} tolerance percent for row ${rowIndex + 1}`}
                    </label>
                    <input
                      id={`${qtyId}-tol`}
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.001"
                      min="0"
                      max="100"
                      value={row.tolerancePct ?? ''}
                      onChange={(e) =>
                        update(rowIndex, {
                          tolerancePct: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      disabled={disabled}
                      /* The step's own figure, greyed. Blank here means "use the
                         step's", and an empty box reads as "no tolerance" — the
                         opposite of what it does. */
                      placeholder={stepTolerancePct != null ? String(stepTolerancePct) : 'tol %'}
                      title={
                        stepTolerancePct != null
                          ? `Over-issue allowance for this item. Left blank it uses the step’s ${stepTolerancePct}%.`
                          : 'Over-issue allowance for this item. Blank uses the step’s, and the step has none set.'
                      }
                      style={cellInput}
                    />
                  </div>
                )}

                {/* 🔴 No "Main" radio. One output absorbs the step's cost
                    (§9.2.1) and it is the FIRST row — the server's own fallback
                    (`flagPrimaryOutput`), mirrored client-side by
                    `primaryOutputIndex` so the chain badge says the same thing.
                    Asking decided nothing in the common case, one item back, and
                    was one more control to get wrong in the uncommon one. Same
                    call `ReceiveDialog` already made for its returned rows. */}

                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== rowIndex))}
                  disabled={disabled}
                  title="Remove item"
                  aria-label={`Remove ${isInput ? 'input' : 'output'} ${rowIndex + 1} from step ${stepNumber}`}
                  style={{ ...iconButton, flex: '0 0 26px' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 2 }}>
                {badge && (
                  <span
                    style={{
                      ...chipStyle,
                      background: badge.tone === 'chain' ? '#eff6ff' : '#f1f5f9',
                      color: badge.tone === 'chain' ? '#1d4ed8' : '#475569',
                    }}
                  >
                    {badge.text}
                  </span>
                )}
                {rowError && <span style={{ fontSize: 11, color: '#e54d4d' }}>{rowError}</span>}
                {/* Amber, not red, and it sits beside the badge rather than
                    replacing it: the row is saveable exactly as it stands. */}
                {!rowError && warning && (
                  <span style={{ fontSize: 11, color: '#b45309' }}>{warning}</span>
                )}

                {/*
                  🔴 THE PLANNER'S BATCH NOTE. Only for a batch-tracked item, and
                  only once a quantity exists — there is nothing to allocate against
                  a blank, and the grid pre-fills each batch from it.

                  A note, not a hold: nothing is reserved, so this never claims the
                  stock will still be there. The wording says "plan", never
                  "reserve".
                */}
                {onPlanBatches && isInput && isBatchTracked?.(row.itemId) && (
                  <button
                    type="button"
                    onClick={() => onPlanBatches(rowIndex)}
                    disabled={disabled || !(row.plannedQty && row.plannedQty > 0)}
                    title={
                      row.plannedQty && row.plannedQty > 0
                        ? 'Note which batches this is planned to come out of. Nothing is reserved.'
                        : 'Enter a quantity first — batches are planned against it.'
                    }
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor:
                        disabled || !(row.plannedQty && row.plannedQty > 0)
                          ? 'not-allowed'
                          : 'pointer',
                      color:
                        disabled || !(row.plannedQty && row.plannedQty > 0) ? '#cbd5e1' : '#0062ff',
                    }}
                  >
                    {(row.plannedBatches?.length ?? 0) === 0
                      ? 'Add Batches'
                      : `${row.plannedBatches!.length} ${
                          row.plannedBatches!.length === 1 ? 'batch' : 'batches'
                        } planned`}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Gone, not greyed, once the step is locked or the form is read-only. A
            disabled button still painted blue with a pointer cursor reads as
            broken; the step's own "Already sent out — locked" chip is the
            explanation, so there is nothing left for a dead control to say. */}
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange([...rows, emptyStepItem()])}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              alignSelf: 'flex-start',
              padding: '4px 9px',
              fontSize: 12,
              border: '1px dashed #cbd5e1',
              borderRadius: 4,
              background: '#fff',
              color: '#0062ff',
              cursor: 'pointer',
            }}
          >
            <Plus size={12} /> {isInput ? 'Add item to consume' : 'Add item to produce'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The sequence of operations, as an editable list.
 *
 * 🔴 ONE STEP IS A BLOCK ON THE PAGE, NOT A ROW IN A TABLE. Thirteen controls in
 * one table row need ~1,120px, so the grid used to live in a horizontal scroller:
 * everything past "Issue item" was off-screen, and a field you cannot see is a
 * field nobody fills in. Laid out as a wrapping block per step, the same thirteen
 * controls fit whatever width the window is, and every one of them carries its
 * caption right above it instead of in a header row that scrolls away.
 *
 * 🔴 REORDERING IS BUTTONS, NOT DRAG-AND-DROP, AND THAT IS DELIBERATE.
 *
 * The plan asks for a drag-orderable grid. A drag handle is a `<div>` with mouse
 * handlers: Tab walks straight past it, so on a keyboard the order simply cannot
 * be changed — and neither `tsc -b` nor a screenshot says a word (CLAUDE.md).
 * Two `<button>`s per row give the same capability to everyone, cost one click
 * instead of one drag, and work on a phone. If drag is added later it must be an
 * ADDITION to these, never a replacement.
 *
 * 🔴 DOM ORDER IS TAB ORDER, and it is why the fields are ONE flat `auto-fit`
 * grid per step rather than columns of stacked fields. `auto-fit` fills
 * left-to-right, row by row — the order someone reads and fills them in. A
 * multi-column layout that assigns fields per column looks identical and tabs
 * top-to-bottom down each column instead, which nothing detects.
 */
export function StepsGrid<T extends StepGridRow>({
  steps,
  onChange,
  errors,
  disabled,
  showPlannedQty,
  showInputQty,
  allowPlannedBatches,
  ownership = 'own',
  seqOffset = 0,
  priorProducers,
  priorSpare,
  lockedCount = 0,
  portalMenus,
}: Props<T>) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: uoms = [] } = useUoms(orgId!);

  /**
   * The items the rows ALREADY name, so a step loaded from the server can print
   * its item's name, unit and tracking mode before anybody opens a picker.
   *
   * Not the picker's source any more — that fetches ten at a time and searches
   * the server, so this no longer has to be every item in the org.
   */
  const { data: itemsPage } = useQuery({
    queryKey: ['items', orgId, 'step-grid'],
    queryFn: () => itemsApi.getItems(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const items = itemsPage?.results ?? [];

  /** Items chosen from a picker that this preload never covered. Without them a
   * freshly picked item has no unit and no tracking mode until a refetch. */
  const [pickedItems, setPickedItems] = useState<Record<string, Item>>({});
  const registerItem = (item: Item) =>
    setPickedItems((current) => (current[item.id] ? current : { ...current, [item.id]: item }));

  /** Every item this grid can name — preloaded or picked. */
  const itemById = new Map<string, Item>([
    ...items.map((i) => [i.id, i] as const),
    ...Object.entries(pickedItems),
  ]);
  const uomById = new Map(uoms.map((u) => [u.id, u]));

  /**
   * An item's stocking unit — the id a row carries and the label it prints.
   * `null` means the item cannot answer (no stocking uom yet), and the caller
   * then shows the dropdown, which is exactly what the server does
   * (`applyRowUnits` leaves such a row's unit null too).
   */
  const unitOfItem = (item: Item): { uomId: string; label: string } | null => {
    if (!item.stockingUomId) return null;
    const uom = uomById.get(item.stockingUomId);
    return uom ? { uomId: uom.id, label: uom.symbol || uom.unitName } : null;
  };

  const itemUnit = (itemId: string | null | undefined): { uomId: string; label: string } | null => {
    if (!itemId) return null;
    const item = itemById.get(itemId);
    return item ? unitOfItem(item) : null;
  };

  const { data: vendorsPage } = useQuery({
    queryKey: ['vendors', orgId, 'processors'],
    queryFn: () => fetchVendors(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  /**
   * 🔴 Job workers only. An unfiltered vendor dropdown offers transporters as
   * processors, which is the single most common defect on this kind of screen
   * (§10). `vendorTypes` is empty on every row created before that column
   * existed, so those are shown too rather than hiding a vendor somebody needs —
   * "not yet classified" is not "not a jobworker".
   */
  const processors = (vendorsPage?.results ?? []).filter(
    (v) =>
      v.vendorTypes === undefined ||
      v.vendorTypes.length === 0 ||
      v.vendorTypes.includes('job_worker'),
  );

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: Boolean(orgId),
  });
  const workCentres = locations.filter((l) => l.type === 'work_centre' || l.type === 'shopfloor');

  /**
   * Which input row has the planner's batch grid open. Null when it is closed.
   * Held HERE rather than in `ItemList` because saving writes back through
   * `update(stepIndex, …)`, which only this component owns.
   */
  const [planning, setPlanning] = useState<{ stepIndex: number; rowIndex: number } | null>(null);
  const [planSearch, setPlanSearch] = useState('');
  const [planSearchDebounced, setPlanSearchDebounced] = useState('');
  // A query per keystroke would be one round trip per letter of a batch reference.
  useEffect(() => {
    const timer = setTimeout(() => setPlanSearchDebounced(planSearch), 300);
    return () => clearTimeout(timer);
  }, [planSearch]);

  const planningRow = planning
    ? ((steps[planning.stepIndex]?.inputs ?? [])[planning.rowIndex] ?? null)
    : null;
  const planningItem = planningRow?.itemId ? (itemById.get(planningRow.itemId) ?? null) : null;

  /** Only a batch-tracked item gets the affordance — an untracked item's batches
   * carry no reference and are not meant to be identified (2026-08-14). */
  const isBatchTracked = (itemId: string | null | undefined) =>
    Boolean(itemId) && itemById.get(itemId!)?.inventoryTracking === 'batch';

  /**
   * 🔴 NO LOCATION FILTER, unlike the Issue dialog's identical query.
   *
   * A job order has no source godown — nothing is going anywhere yet — so the plan
   * may name a batch in any of them, and each row records the godown it chose
   * (`JobOrderStepInputBatch.locationId`). `ownership` stays mandatory: one
   * customer's goods must never be planned into another's order (§5.2).
   */
  const { data: planningBatches = [], isLoading: planningBatchesLoading } = useQuery({
    queryKey: [
      'available-batches',
      orgId,
      planningRow?.itemId,
      ownership,
      planSearchDebounced,
      'plan',
    ],
    queryFn: () =>
      fetchAvailableBatches(orgId!, {
        itemId: planningRow!.itemId!,
        ownership,
        search: planSearchDebounced || undefined,
        limit: PLAN_BATCH_LIMIT,
      }),
    enabled: Boolean(orgId && planningRow?.itemId),
  });

  const update = (index: number, patch: Partial<StepGridRow>) => {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const uomOptions = [
    { value: '', label: '—' },
    ...uoms.map((u) => ({ value: u.id, label: u.symbol || u.unitName })),
  ];

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step, index) => {
          /**
           * A server error on either list is keyed to the row it landed on —
           * over-planned quantity (§6.4), a repeated item, two primary outputs.
           * Anything on this step turns the whole block red, so the step is
           * findable before the row is.
           */
          const chainError = Object.entries(errors ?? {}).find(
            ([key]) =>
              key.startsWith(`steps.${index}.inputs`) || key.startsWith(`steps.${index}.outputs`),
          )?.[1];
          const field = (id: string) => `step-${index}-${id}`;
          // Position in the order, not in this array — they differ when appending.
          const stepNo = index + 1 + seqOffset;
          // Frozen: work has already gone out at or after this position (§6.6).
          const locked = index < lockedCount;
          const readOnly = disabled || locked;

          /**
           * A step that lists no inputs of its own takes what the step above
           * produces — the server's own fallback (`resolveStepRows`). Shown as a
           * stated fact rather than a pre-filled row, so that adding a row is a
           * deliberate act of overriding it.
           */
          const previousOutputs = index > 0 ? (steps[index - 1]?.outputs ?? []) : [];
          const previousPrimaryItemId =
            previousOutputs[primaryOutputIndex(previousOutputs)]?.itemId ?? null;
          const previousPrimaryLabel = previousPrimaryItemId
            ? (itemById.get(previousPrimaryItemId)?.name ?? null)
            : null;
          return (
            <div
              key={index}
              style={{
                border: `1px solid ${chainError ? '#fecaca' : '#eef0f3'}`,
                borderRadius: 6,
                background: chainError ? '#fef2f2' : '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 14px',
                  background: chainError ? '#fef2f2' : '#f9f9fb',
                  borderBottom: '1px solid #eef0f3',
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>Step {stepNo}</span>
                  {/* Says WHY it cannot be edited. A row that is simply inert,
                      with no explanation, reads as a bug in the form. */}
                  {locked && (
                    <span style={{ ...chipStyle, background: '#f1f5f9', color: '#475569' }}>
                      Already sent out — locked
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {/* `index <= lockedCount` covers the first unlocked step too:
                      moving it up would swap it into the frozen region and
                      renumber a step whose seq is printed on a challan. */}
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0 || index <= lockedCount}
                    title={
                      index <= lockedCount && index > 0 ? 'Locked — already sent out' : 'Move up'
                    }
                    aria-label={`Move step ${stepNo} up`}
                    style={{
                      ...iconButton,
                      opacity: index === 0 || index <= lockedCount ? 0.4 : 1,
                    }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={readOnly || index === steps.length - 1}
                    title={locked ? 'Locked — already sent out' : 'Move down'}
                    aria-label={`Move step ${stepNo} down`}
                    style={{
                      ...iconButton,
                      opacity: locked || index === steps.length - 1 ? 0.4 : 1,
                    }}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(steps.filter((_, i) => i !== index))}
                    disabled={readOnly || steps.length === 1}
                    title={locked ? 'Locked — already sent out' : 'Remove step'}
                    aria-label={`Remove step ${stepNo}`}
                    style={{ ...iconButton, opacity: locked || steps.length === 1 ? 0.4 : 1 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 14,
                  padding: 14,
                }}
              >
                <div>
                  <span style={{ ...fieldLabel, color: '#ef4444' }}>Process*</span>
                  <ProcessSelect
                    value={step.processId || null}
                    onChange={(processId, process) =>
                      update(index, {
                        processId,
                        /**
                         * 🔴 Seeded HERE, visibly, rather than mirrored by the
                         * server at save. A process that does not change the item
                         * returns what it took — so the row is put in where
                         * somebody can see it, change it, or delete it. Only when
                         * PRODUCES is still empty: an existing list is the user's
                         * and is never rewritten by a process change.
                         */
                        outputs:
                          (step.outputs ?? []).length === 0 &&
                          !process.itemChanges &&
                          step.inputs?.[0]?.itemId
                            ? [
                                {
                                  ...emptyStepItem(),
                                  itemId: step.inputs[0]!.itemId,
                                  uomId: step.inputs[0]!.uomId ?? null,
                                },
                              ]
                            : step.outputs,
                        // The process master is the first link of the default
                        // chain (§2.5). Only blanks are filled — anything the
                        // user already typed stays.
                        rateBasis: step.rateBasis ?? process.rateBasis,
                        tolerancePct:
                          step.tolerancePct ??
                          (process.defaultTolerancePct === null
                            ? null
                            : Number(process.defaultTolerancePct)),
                        // The process's default units are NOT copied down any
                        // more: each row takes its own item's stocking unit
                        // (§5.1), and an org-wide "issue in KG" is a statement
                        // about the thing being processed, not about the thread
                        // and buttons going out beside it. The server applies it
                        // to the principal row alone, where the item cannot
                        // answer for itself.
                      })
                    }
                    disabled={readOnly}
                    ariaLabel={`Step ${stepNo} process`}
                    minWidth="100%"
                    portal={portalMenus}
                  />
                </div>

                <div>
                  <span style={fieldLabel}>Done by</span>
                  <Select
                    value={step.processorType ?? 'vendor'}
                    onChange={(value) =>
                      // The processor and the work centre are mutually exclusive,
                      // so switching type clears the one that no longer applies.
                      // Leaving a stale id behind is how a challan ends up
                      // addressed to a vendor on an in-house step.
                      update(index, {
                        processorType: value,
                        processorId: value === 'internal' ? null : step.processorId,
                        workCentreLocationId:
                          value === 'internal' ? step.workCentreLocationId : null,
                      })
                    }
                    options={[...PROCESSOR_TYPE_OPTIONS]}
                    disabled={readOnly}
                    ariaLabel={`Step ${stepNo} performed by`}
                    minWidth={0}
                    portal={portalMenus}
                  />
                </div>

                <div>
                  <span style={fieldLabel}>
                    {step.processorType === 'internal' ? 'Work centre' : 'Processor'}
                  </span>
                  {step.processorType === 'internal' ? (
                    <Select
                      value={step.workCentreLocationId ?? ''}
                      onChange={(value) => update(index, { workCentreLocationId: value || null })}
                      options={[
                        { value: '', label: 'Select a work centre…' },
                        ...workCentres.map((l) => ({ value: l.id, label: l.name })),
                      ]}
                      disabled={readOnly}
                      ariaLabel={`Step ${stepNo} work centre`}
                      minWidth={0}
                      portal={portalMenus}
                    />
                  ) : (
                    <Select
                      value={step.processorId ?? ''}
                      onChange={(value) => update(index, { processorId: value || null })}
                      options={[
                        { value: '', label: 'Decide per job order' },
                        ...processors.map((v) => ({
                          value: v.id,
                          label: v.companyName || v.contactName,
                        })),
                      ]}
                      disabled={readOnly}
                      ariaLabel={`Step ${stepNo} processor`}
                      minWidth={0}
                      portal={portalMenus}
                    />
                  )}
                </div>

                {/* 🔴 No step-level "Planned qty" and no "Yield".
                    Planned quantity is per item now — it lives on each row of
                    CONSUMES below, because one number cannot cover metres, cones
                    and pieces at once (§5.7). Yield is gone with it: one ratio
                    cannot relate three inputs to two outputs, and every output
                    already carries the quantity it is expected to return, which
                    says the same thing without implying a conversion. */}

                <div>
                  <label style={fieldLabel} htmlFor={field('rate')}>
                    Rate
                  </label>
                  <input
                    id={field('rate')}
                    type="number"
                    onWheel={blurOnWheel}
                    step="0.01"
                    min="0"
                    value={step.rate ?? ''}
                    onChange={(e) =>
                      update(index, { rate: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    disabled={readOnly}
                    style={cellInput}
                  />
                </div>

                <div>
                  <span style={fieldLabel}>Rate basis</span>
                  <Select
                    value={step.rateBasis ?? ''}
                    onChange={(value) => update(index, { rateBasis: value || null })}
                    options={[{ value: '', label: 'From the process' }, ...RATE_BASIS_OPTIONS]}
                    disabled={readOnly}
                    ariaLabel={`Step ${stepNo} rate basis`}
                    minWidth={0}
                    portal={portalMenus}
                  />
                </div>

                <div>
                  <label style={fieldLabel} htmlFor={field('tolerance')}>
                    Tolerance % — all items
                  </label>
                  <input
                    id={field('tolerance')}
                    type="number"
                    onWheel={blurOnWheel}
                    step="0.001"
                    min="0"
                    max="100"
                    value={step.tolerancePct ?? ''}
                    onChange={(e) =>
                      update(index, {
                        tolerancePct: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    disabled={readOnly}
                    style={cellInput}
                    title="How much over the plan may be issued. Any item can override it on its own row."
                  />
                </div>
              </div>

              {/*
                🔴 THE TWO LISTS (§5.7). A step consumes a SET and produces a
                SET, and the two are independent: seven items in and one out is
                as normal as one in and ten out. They are laid out one above the
                other rather than side by side because each row is itself three
                or four controls wide, and columns would put half of them into a
                horizontal scroller — where a field nobody can see is a field
                nobody fills in.
              */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: 14,
                  padding: '0 14px 14px',
                }}
              >
                <ItemList
                  side="inputs"
                  rows={step.inputs ?? []}
                  onChange={(rows) => update(index, { inputs: rows })}
                  onPlanBatches={
                    allowPlannedBatches
                      ? (rowIndex) => setPlanning({ stepIndex: index, rowIndex })
                      : undefined
                  }
                  isBatchTracked={isBatchTracked}
                  orgId={orgId!}
                  itemById={itemById}
                  onItemPicked={registerItem}
                  itemUnit={itemUnit}
                  unitOfItem={(item) => unitOfItem(item)?.uomId ?? null}
                  uomOptions={uomOptions}
                  portalMenus={portalMenus}
                  showQty={showPlannedQty || showInputQty}
                  showTolerance={showPlannedQty}
                  stepTolerancePct={step.tolerancePct ?? null}
                  disabled={readOnly}
                  stepIndex={index}
                  stepNumber={stepNo}
                  errors={errors}
                  /* Step 1's row for the order's item is a REAL row, locked to
                     that item but carrying its own quantity — see `lockedItemId`.
                     The only thing still shown as a bare fact is a later step
                     that lists nothing and simply takes what the step above
                     produces, where there is no quantity to type: the server
                     plans it from that step's expected output. */
                  emptyHint={
                    previousPrimaryLabel
                      ? `Nothing listed — this step will consume nothing. Add ${previousPrimaryLabel} if it carries on from step ${stepNo - 1}.`
                      : 'Nothing listed — this step will consume nothing.'
                  }
                  /* Job orders only. A route holds quantities on the consumed
                     side alone, so there is no expected output above to measure
                     against and a note here could only be guesswork. */
                  warningFor={
                    showPlannedQty
                      ? (row) => overPlanWarning(steps, index, row, priorSpare)
                      : undefined
                  }
                  badgeFor={(row) => {
                    if (!row.itemId) return null;
                    // Steps in this array first, then the ones already on the
                    // order — otherwise appending labels a chain-fed input "From
                    // stock", which is the mistake the badge exists to catch.
                    const within = producedByStep(steps, index, row.itemId);
                    const from = within === null ? null : within + seqOffset;
                    const fed = from ?? priorProducers?.get(row.itemId) ?? null;
                    return fed
                      ? { text: `From step ${fed}`, tone: 'chain' as const }
                      : { text: 'From stock', tone: 'stock' as const };
                  }}
                />

                <ItemList
                  side="outputs"
                  rows={step.outputs ?? []}
                  onChange={(rows) => update(index, { outputs: rows })}
                  orgId={orgId!}
                  itemById={itemById}
                  onItemPicked={registerItem}
                  itemUnit={itemUnit}
                  unitOfItem={(item) => unitOfItem(item)?.uomId ?? null}
                  uomOptions={uomOptions}
                  portalMenus={portalMenus}
                  mirrorSource={step.inputs ?? []}
                  showQty={showPlannedQty}
                  /* Job orders only. A route holds no output quantities at all,
                     so there is nothing for it to preview. */
                  qtyPlaceholderFor={
                    showPlannedQty
                      ? (_row, rowIndex) =>
                          derivedExpectedQty(step, rowIndex, (id) => itemUnit(id)?.uomId ?? null)
                      : undefined
                  }
                  disabled={readOnly}
                  stepIndex={index}
                  stepNumber={stepNo}
                  errors={errors}
                  emptyHint="Nothing listed — this step will produce nothing, and nothing can be received against it. Add what comes back, even if it is the same item that went in."
                  badgeFor={(row, rowIndex) => {
                    if (!row.itemId) return null;
                    // Which row is the main output is derived now, not ticked —
                    // read it the way the server will, or the badge tells the
                    // next step's inputs a different story than the save does.
                    const outputs = step.outputs ?? [];
                    const fed = feedsSteps(
                      steps,
                      index,
                      row.itemId,
                      rowIndex === primaryOutputIndex(outputs),
                    ).map((at) => at + seqOffset);
                    return fed.length
                      ? { text: `Feeds step ${fed.join(', ')}`, tone: 'chain' as const }
                      : { text: 'Ends here', tone: 'stock' as const };
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/*
        Mounted only while open and keyed on the row, because `AddBatchesModal`
        seeds its grid once on mount — a shared instance would show one row's
        allocation against another row's item.
      */}
      {planning && planningRow?.itemId && (
        <AddBatchesModal
          key={`${planning.stepIndex}-${planning.rowIndex}-${planningRow.itemId}`}
          isOpen
          onClose={() => {
            setPlanning(null);
            // The search is a parameter of the availability query — left behind it
            // would narrow the next row's grid to whatever was last typed.
            setPlanSearch('');
          }}
          itemName={planningItem?.name ?? 'Item'}
          sku={planningItem?.sku ?? null}
          uomLabel={itemUnit(planningRow.itemId)?.label ?? ''}
          /* 🔴 Null — a plan has no source godown, so the grid spans every one and
             names each batch's own. See the prop's note. */
          locationName={null}
          plannedQty={planningRow.plannedQty ?? null}
          lineQty={planningRow.plannedQty ?? 0}
          selection={Object.fromEntries(
            (planningRow.plannedBatches ?? []).flatMap((planned) => {
              const batch = planningBatches.find(
                (b) => b.batchId === planned.batchId && b.locationId === planned.locationId,
              );
              // A batch that has since been consumed is no longer offered, so there
              // is nothing to render or check a quantity against — the row drops
              // and the user re-picks. Silently keeping it would show a plan
              // against stock that no longer exists.
              return batch ? [[rowKey(batch), { batch, qty: planned.qty }] as const] : [];
            }),
          )}
          onSave={(rows, overwriteQty) => {
            const inputs = [...(steps[planning.stepIndex]?.inputs ?? [])];
            const current = inputs[planning.rowIndex];
            if (!current) return;
            inputs[planning.rowIndex] = {
              ...current,
              ...(overwriteQty !== null ? { plannedQty: overwriteQty } : {}),
              plannedBatches: Object.values(rows).map((sel) => ({
                batchId: sel.batch.batchId,
                locationId: sel.batch.locationId,
                qty: sel.qty,
              })),
            };
            update(planning.stepIndex, { inputs } as Partial<T>);
          }}
          batches={planningBatches}
          search={planSearch}
          onSearchChange={setPlanSearch}
          isLoading={planningBatchesLoading}
          isCapped={planningBatches.length >= PLAN_BATCH_LIMIT}
        />
      )}

      {/*
        🔴 The new step is SEEDED, not inferred. Carrying on from the step above
        is the normal case, so its main output is put in as a real row — visible,
        editable, and deletable — rather than left to the server to add on save.
        Nothing about the row is special once it is there.
      */}
      <button
        type="button"
        onClick={() => {
          const previousOutputs = steps[steps.length - 1]?.outputs ?? [];
          const carriedOn = previousOutputs[primaryOutputIndex(previousOutputs)] ?? null;
          const next = emptyStep() as T;
          onChange([
            ...steps,
            carriedOn?.itemId
              ? {
                  ...next,
                  inputs: [
                    {
                      ...emptyStepItem(),
                      itemId: carriedOn.itemId,
                      // The unit rides with the item, seeded rows included.
                      uomId: itemUnit(carriedOn.itemId)?.uomId ?? carriedOn.uomId ?? null,
                    },
                  ],
                }
              : next,
          ]);
        }}
        // Never locked: adding work to the end is always safe, which is the whole
        // basis of `appendJobOrderSteps` too.
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 12,
          padding: '6px 12px',
          fontSize: 13,
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: '#fff',
          color: '#0062ff',
          cursor: 'pointer',
        }}
      >
        <Plus size={14} /> Add step
      </button>
    </div>
  );
}
