import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatchUnit } from '../batches/batches.api';

/**
 * 🔴 THE PACKAGE LEVEL ON THE ISSUE SIDE — a full-screen dialog, the same shape the
 * four ENTRY screens got on 2026-09-03 (`components/inventory/BatchUnitsModal`).
 *
 * This is the ISSUE side, so it cannot be that component: those screens CREATE
 * packages, while this one BIFURCATES a quantity the batch row has already stated
 * across packages the batch already holds.
 *
 * 🔴 BIFURCATION IS OPTIONAL, AND WHEN GIVEN IT MUST BE COMPLETE. Naming no
 * package at all is a normal answer — the quantity is then spread over the batch's
 * packages oldest-first at save (see `AddBatchesModal.handleSave`). But once lines
 * exist they are a SPLIT of the batch row's quantity, not an addition to it, so
 * they have to add up to it. Save is refused while they do not, unless the
 * overwrite box is ticked, which moves the row to what was actually picked.
 *
 * 🔴 A DRAFT, unlike `BatchUnitsModal`. Cancel has to leave the row exactly as it
 * was — that is what makes a refused Save escapable — so nothing here writes
 * through to the caller until Save.
 */

/** One picked package. `id` is a local slot key, because the row exists from the
 * moment "+ Existing {unit}" is pressed and before any package has been chosen. */
export interface IssueUnitRow {
  id: string;
  /** Empty until the user picks one. */
  batchUnitId: string;
  qty: number;
}

/** Matched to `BatchUnitsGrid` so the two dialogs read as one control. */
const LABEL_WIDTH = 220;
const QTY_WIDTH = 110;
const CONTROL_HEIGHT = 34;
const QTY_EPSILON = 0.00005;

let seq = 0;

const headerCellStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: '#ef4444',
  textTransform: 'uppercase',
  padding: '0 6px 4px 0',
};

interface Props {
  isOpen: boolean;
  /** Throw the draft away and leave the row untouched. */
  onCancel: () => void;
  /**
   * Commit the draft. `overwrite` is the box below: it means the batch row's
   * quantity follows what was picked here, and the line item follows the new
   * allocation — the caller owns both writes.
   */
  onSave: (units: IssueUnitRow[], overwrite: boolean) => void;
  /**
   * The batch's REFERENCE, raw. The heading pairs it with `batchSingular` itself
   * ("Takas in Batch CF-B-01"), so a caller must not substitute the word here.
   */
  batchRef: string | null;
  /** What this org calls a batch, so the prose reads in their own words. */
  batchSingular: string;
  /** Per-org name for the level, from `useBatchUnitLabel`. */
  singular: string;
  plural: string;
  uomLabel: string;
  /** Every package this batch still holds here, with what is left of each. */
  options: readonly AvailableBatchUnit[];
  /** What the row already carries. Empty means the packages have never been
   * opened for this row, which is what triggers the pre-fill. */
  initialRows: readonly IssueUnitRow[];
  /** 🔴 The batch ROW's quantity — the figure these lines must add up to. */
  batchQty: number;
  /** The line's own target and what every row on it currently allocates, so the
   * overwrite box here says the same thing it says on the grid behind. */
  lineQty: number;
  allocated: number;
  /** The caller's current overwrite choice, so re-opening shows what was ticked. */
  initialOverwrite: boolean;
}

export function IssueUnitsModal({
  isOpen,
  onCancel,
  onSave,
  batchRef,
  batchSingular,
  singular,
  plural,
  uomLabel,
  options,
  initialRows,
  batchQty,
  lineQty,
  allocated,
  initialOverwrite,
}: Props) {
  /**
   * 🔴 Seeded ONCE — the caller mounts this keyed on the row, so there is nothing
   * arriving after mount to miss. Opening a row that has never been bifurcated
   * fills every package in at its own balance: this side can only pick from
   * packages the batch already holds, so the complete list IS the answer to "which
   * of them", and the edit is deleting the ones this challan does not take.
   */
  const [rows, setRows] = useState<IssueUnitRow[]>(() =>
    initialRows.length > 0
      ? initialRows.map((row) => ({ ...row }))
      : options.map((option) => ({
          id: `unit-${seq++}`,
          batchUnitId: option.batchUnitId,
          qty: toNumber(option.availableQty),
        })),
  );
  const [overwrite, setOverwrite] = useState(initialOverwrite);

  const ceilingOf = (batchUnitId: string) => {
    const picked = options.find((option) => option.batchUnitId === batchUnitId);
    return picked ? toNumber(picked.availableQty) : 0;
  };

  const patch = (slotId: string, next: Partial<IssueUnitRow>) =>
    setRows((prev) => prev.map((row) => (row.id === slotId ? { ...row, ...next } : row)));

  const total = Number(rows.reduce((sum, slot) => sum + slot.qty, 0).toFixed(4));
  const overDrawn = rows.some(
    (slot) => slot.batchUnitId && slot.qty > ceilingOf(slot.batchUnitId) + QTY_EPSILON,
  );
  /** A line that names no package, or names one for nothing. Either would be
   * dropped silently at save, which is the one failure worse than refusing. */
  const incomplete = rows.some((slot) => !slot.batchUnitId || !(slot.qty > 0));
  /** 🔴 The whole point of the gate: lines are a SPLIT of the row's quantity. No
   * lines at all is not a mismatch — it is the un-bifurcated case. */
  const mismatch = rows.length > 0 && Math.abs(total - batchQty) > QTY_EPSILON;
  const canCommit = !overDrawn && !incomplete && (!mismatch || overwrite);

  /** What the line would allocate once Save writes this row's quantity — the
   * figure the overwrite box promises, so it must be the one it shows. */
  const projected = Number((allocated - batchQty + total).toFixed(4));
  const remaining = Number((lineQty - projected).toFixed(4));
  const matches = Math.abs(remaining) < QTY_EPSILON;

  /** 🔴 The reference is named by its level, in the org's own word for it — a bare
   * "Takas in CF-B-01" is only recognisable to someone who already knows what
   * CF-B-01 is, and this dialog opens two levels down from where it was picked. */
  const ref = batchRef?.trim();
  const heading = ref ? `${batchSingular} ${ref}` : batchSingular;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={`${plural} in ${heading}`}
      /* The line's figures sit in the HEADER, not at the top of the body — they are
         what the whole dialog is measured against, and in the body they scroll away
         the moment a batch has twenty packages. */
      subtitle={
        <>
          <div style={{ fontSize: 13, color: '#334155' }}>
            <span style={{ color: '#64748b' }}>Total Quantity :</span> {formatQty(lineQty)}{' '}
            {uomLabel}
            <span style={{ color: '#e2e8f0', margin: '0 10px' }}>|</span>
            <span style={{ color: '#64748b' }}>Quantity to be added :</span>{' '}
            <span style={{ color: matches ? '#15803d' : '#b45309', fontWeight: 600 }}>
              {formatQty(remaining)} {uomLabel}
            </span>
          </div>

          {/* 🔴 Enabled whenever ticking it would change something — a row mismatch
              counts, not just a line mismatch. Disabling it on the line alone
              deadlocked the dialog: a split that disagreed with its row could then
              be neither accepted nor dismissed. */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 6,
              fontSize: 12.5,
              color: mismatch || !matches ? '#334155' : '#94a3b8',
              cursor: mismatch || !matches ? 'pointer' : 'not-allowed',
            }}
          >
            <input
              type="checkbox"
              checked={overwrite}
              disabled={!mismatch && matches}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite the line item with {formatQty(projected)} quantities
          </label>
        </>
      }
      position="fullScreen"
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={() => onSave(rows, overwrite)}
            disabled={!canCommit}
            /* The Save/Cancel pair the Add {batches} grid behind this one uses,
               down to the green — this dialog commits a draft exactly as that one
               does, so it must not look like a different kind of action. */
            style={{
              padding: '6px 20px',
              background: canCommit ? '#15803d' : '#f1f5f9',
              color: canCommit ? '#fff' : '#94a3b8',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: canCommit ? 'pointer' : 'not-allowed',
            }}
          >
            Save
          </button>
          {/* 🔴 Cancel, not just a close cross — a refused Save has to have a way
              out that throws the draft away rather than trapping the user in it. */}
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 20px',
              background: '#fff',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 500,
              color: overDrawn || incomplete || mismatch ? '#b91c1c' : '#64748b',
            }}
          >
            {overDrawn
              ? `A quantity is more than the ${singular.toLowerCase()} holds.`
              : incomplete
                ? `Every line needs a ${singular.toLowerCase()} and a quantity.`
                : mismatch
                  ? `These ${plural.toLowerCase()} add up to ${formatQty(total)} ${uomLabel}, but the ` +
                    `${batchSingular.toLowerCase()} row asks for ${formatQty(batchQty)} ${uomLabel}. ` +
                    `Tick the box above to move the row to ${formatQty(total)}, or adjust the quantities.`
                  : rows.length === 0
                    ? `No split — the ${formatQty(batchQty)} ${uomLabel} is taken from the oldest ` +
                      `${plural.toLowerCase()} first.`
                    : `Adds up to ${formatQty(batchQty)} ${uomLabel}.`}
          </span>
        </div>
      }
    >
      {rows.length > 0 && (
        <table style={{ borderCollapse: 'collapse', marginBottom: 4 }}>
          <thead>
            <tr>
              {/* Position, not identity — `index + 1`, derived at render, so it
                  always reads 1, 2, 3 while the labels beside it keep their own
                  permanent names. Same pairing the challan prints. */}
              <th style={{ ...headerCellStyle, color: '#94a3b8', textAlign: 'right', width: 26 }}>
                #
              </th>
              <th style={{ ...headerCellStyle, textAlign: 'left', width: LABEL_WIDTH }}>
                {singular}*
              </th>
              {/* The ceiling this line is measured against. Without it the only way
                  to find out a roll is short is to be refused. */}
              <th
                style={{
                  ...headerCellStyle,
                  color: '#64748b',
                  textAlign: 'right',
                  width: QTY_WIDTH,
                }}
              >
                Balance
              </th>
              <th style={{ ...headerCellStyle, textAlign: 'right', width: QTY_WIDTH }}>
                Quantity*
              </th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((slot, index) => {
              const picked = options.find((option) => option.batchUnitId === slot.batchUnitId);
              const ceiling = picked ? toNumber(picked.availableQty) : 0;
              return (
                <tr key={slot.id}>
                  <td
                    style={{
                      padding: '3px 8px 3px 0',
                      textAlign: 'right',
                      verticalAlign: 'middle',
                      fontSize: 12,
                      color: '#94a3b8',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {index + 1}
                  </td>
                  <td style={{ padding: '3px 6px 3px 0', verticalAlign: 'middle' }}>
                    {/* 🔴 `portal` — this lives inside a Modal whose body scrolls,
                        so an absolutely-positioned menu is clipped and unreachable. */}
                    <SearchableSelect
                      value={slot.batchUnitId}
                      onChange={(value) => patch(slot.id, { batchUnitId: value })}
                      /* Packages already taken by a sibling line are dropped:
                         picking one twice would send it on two lines of one
                         challan. A list that cannot express the mistake beats a
                         message about it. */
                      options={options
                        .filter(
                          (option) =>
                            option.batchUnitId === slot.batchUnitId ||
                            !rows.some(
                              (other) =>
                                other.id !== slot.id && other.batchUnitId === option.batchUnitId,
                            ),
                        )
                        .map((option) => ({ value: option.batchUnitId, label: option.label }))}
                      placeholder={`Select a ${singular.toLowerCase()}…`}
                      triggerStyle={{
                        minHeight: CONTROL_HEIGHT,
                        height: CONTROL_HEIGHT,
                        padding: '0 10px',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                      portal
                    />
                  </td>
                  <td
                    style={{
                      padding: '3px 6px 3px 0',
                      verticalAlign: 'middle',
                      textAlign: 'right',
                      fontSize: 12.5,
                      color: '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {picked ? `${formatQty(picked.availableQty)} ${uomLabel}` : '—'}
                  </td>
                  <td style={{ padding: '3px 6px 3px 0', verticalAlign: 'middle' }}>
                    <input
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      max={ceiling}
                      value={slot.qty || ''}
                      placeholder="0"
                      aria-label={`Quantity from ${picked?.label ?? `${singular} ${index + 1}`}`}
                      onChange={(e) => patch(slot.id, { qty: Number(e.target.value) || 0 })}
                      style={{
                        width: '100%',
                        height: CONTROL_HEIGHT,
                        padding: '8px 10px',
                        fontSize: 13,
                        textAlign: 'right',
                        background: '#fff',
                        border: `1px solid ${
                          slot.batchUnitId && slot.qty > ceiling + QTY_EPSILON
                            ? '#fca5a5'
                            : '#cbd5e1'
                        }`,
                        borderRadius: 4,
                        outline: 'none',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((row) => row.id !== slot.id))}
                      aria-label={`Remove ${picked?.label ?? `${singular} ${index + 1}`}`}
                      title="Remove this line"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#ef4444',
                        padding: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: 4,
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
      )}

      <button
        type="button"
        onClick={() =>
          setRows((prev) => [...prev, { id: `unit-${seq++}`, batchUnitId: '', qty: 0 }])
        }
        disabled={rows.length >= options.length}
        title={
          rows.length >= options.length
            ? `Every ${singular.toLowerCase()} in this ${batchSingular.toLowerCase()} is already on a line.`
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
          padding: '4px 4px 0',
          borderRadius: 4,
          color: rows.length >= options.length ? '#cbd5e1' : '#0062ff',
          cursor: rows.length >= options.length ? 'not-allowed' : 'pointer',
        }}
      >
        {/* 🔴 "Existing", matching the entry screens' second link, because that is
            the only kind of row this dialog has. An ISSUE takes stock that is
            already on the books — every row here is answered by PICKING a package
            out of the batch, never by naming a new one. Reading "Add {unit}" here
            promised a package could be created on the way out of the building. */}
        <Plus size={13} /> Existing {singular}
      </button>
    </Modal>
  );
}
