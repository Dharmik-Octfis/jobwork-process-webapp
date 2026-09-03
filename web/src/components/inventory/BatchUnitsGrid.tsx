import { Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  QTY_EPSILON,
  isExistingUnit,
  unitsTotal,
  type BatchUnitRow,
  type ExistingBatchUnitOption,
} from './batchUnits';

/**
 * 🔴 THE ONE PACKAGE SUB-GRID — the level below a batch, wherever a batch is
 * entered: Bills, Opening Stock (modal AND page), and the Job Receipt allocation.
 *
 * Four screens, one component, on purpose. The rules underneath it are not
 * cosmetic — every NAMED label unique inside its batch, every quantity positive,
 * the total equal to the batch's — and four copies of a rule is how the two Bill
 * posting paths drifted apart before they were merged. `validateBatchUnits` in
 * `batchUnits.ts` is the same thing for the checks, so a screen cannot enforce a
 * subset of them by accident.
 *
 * 🔴 THE LABEL IS OPTIONAL AND THE QUANTITY IS NOT (2026-09-03). Blank means "this
 * roll carries no tag"; the server names it `#seq`, its position in the batch.
 *
 * Since 2026-09-03 this renders inside `BatchUnitsModal` rather than in an
 * expanding panel under the batch row, so every call site opens it the same way
 * — `BatchUnitsTrigger` — instead of hanging its own chevron off its own table.
 *
 * Keyboard: every control here is a real `<input>` or `<button type="button">`,
 * so Tab reaches all of them and DOM order is tab order — the packages of a batch
 * come immediately after that batch's own fields and before the next batch's.
 */

/** Practical field widths, not a share of the cell. The panel sits under a batch
 * row that is 1200px+ wide; sized as a percentage of that, a label like "TK-04"
 * got an input half the screen across. */
const LABEL_WIDTH = 220;
const QTY_WIDTH = 110;

/** Every control in a row is this tall, stated rather than inherited: the Select
 * trigger takes an explicit height, an input derives one from font metrics, and
 * the two landed a pixel apart side by side. */
const CONTROL_HEIGHT = 34;

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: CONTROL_HEIGHT,
  padding: '8px 10px',
  fontSize: '13px',
  border: '1px solid #cbd5e1',
  borderRadius: '4px',
  background: '#fff',
  color: '#1e293b',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const headerCellStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: '#ef4444',
  textTransform: 'uppercase',
  padding: '0 6px 4px 0',
};

interface BatchUnitsGridProps {
  units: readonly BatchUnitRow[];
  /** What the batch itself holds — the denominator of the readout. */
  batchQty: number;
  /** Per-org name for the level, from `useBatchUnitLabel`. */
  singular: string;
  /** What this org calls a batch, so the prose reads in their own words. */
  batchSingular: string;
  uomLabel?: string;
  /**
   * The packages this batch ALREADY holds, for an "Existing {unit}" row to point
   * at. Empty on a batch being created — it has none yet — which is what disables
   * the second link. Omitted entirely by a screen with no existing-batch concept,
   * and then only "+ Add {unit}" is rendered, exactly as before.
   */
  existingOptions?: readonly ExistingBatchUnitOption[];
  onAdd: () => void;
  /** Add a row that tops up an existing package. Omit alongside `existingOptions`
   * to keep the single-link form. */
  onAddExisting?: () => void;
  onChange: (unitId: string, field: 'label' | 'quantity', value: string) => void;
  /** The user picked which existing package a row adds to. The call site stores
   * both the id and the label — the id is what posts, the label is what shows. */
  onPickExisting?: (unitId: string, option: ExistingBatchUnitOption) => void;
  onRemove: (unitId: string) => void;
  /**
   * Drop the panel chrome. The tinted, bordered, `inline-block` box exists to set
   * this grid apart from the batch ROW it hangs under; inside `BatchUnitsModal`
   * there is no row above it and the dialog is already the frame, so the box
   * becomes a second border around the whole body.
   */
  frameless?: boolean;
}

export function BatchUnitsGrid({
  units,
  batchQty,
  singular,
  batchSingular,
  uomLabel,
  existingOptions,
  onAdd,
  onAddExisting,
  onChange,
  onPickExisting,
  onRemove,
  frameless = false,
}: BatchUnitsGridProps) {
  const allocated = unitsTotal(units);
  const unallocated = batchQty - allocated;

  /** The New/Existing pair mirrors the batch row above; a screen that passes
   * neither handler keeps the single "+ Add" link it has always had. */
  const offersExisting = Boolean(onAddExisting && onPickExisting);

  return (
    // `inline-block`, so the panel is only as wide as the two inputs need. It
    // sits in a cell spanning most of the batch table; stretched to that width it
    // read as a second, larger form than the row it belongs to.
    <div
      style={
        frameless
          ? { display: 'block' }
          : {
              display: 'inline-block',
              background: '#f8fafc',
              border: '1px solid #eef0f3',
              borderRadius: 4,
              padding: '8px 10px',
            }
      }
    >
      {units.length > 0 && (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* 🔴 POSITION, NOT IDENTITY — and the two are different on purpose.
                  This counter is `index + 1`, derived at render and stored
                  nowhere, so it always reads 1, 2, 3 with no gaps. The LABEL
                  beside it is the package's permanent name, which DOES gap: `seq`
                  is never reused, not even by a soft-deleted package, because the
                  ledger rows and the printed challan naming it have to stay
                  readable. Delete a package in the middle and this column recounts
                  while the names stay put — the honest way round. Same pairing the
                  challan already prints: a Sr No column beside a package column. */}
              <th style={{ ...headerCellStyle, color: '#94a3b8', textAlign: 'right', width: 26 }}>
                #
              </th>
              {/* 🔴 No asterisk since 2026-09-03: the label is optional and the
                  quantity is not. The colour follows — a required-field red on a
                  field nobody has to fill is exactly the sort of thing that gets
                  a whole form filled in defensively. */}
              <th
                style={{
                  ...headerCellStyle,
                  color: '#64748b',
                  textAlign: 'left',
                  width: LABEL_WIDTH,
                }}
              >
                {singular} Label
              </th>
              <th style={{ ...headerCellStyle, textAlign: 'right', width: QTY_WIDTH }}>
                Quantity*
              </th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {units.map((unit, index) => (
              <tr key={unit.id}>
                {/* Plain text, never focusable — Tab still walks label → quantity
                    → remove, one row at a time, exactly as it did. */}
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
                  {isExistingUnit(unit) ? (
                    /* 🔴 `portal` — this grid lives inside a Modal whose body
                       scrolls and whose cards clip for their rounded corners, so
                       an absolutely-positioned menu is unreachable. */
                    <SearchableSelect
                      value={unit.batchUnitId ?? ''}
                      onChange={(value) => {
                        const picked = (existingOptions ?? []).find(
                          (option) => option.batchUnitId === value,
                        );
                        if (picked) onPickExisting?.(unit.id, picked);
                      }}
                      /* 🔴 Only the label. A label is unique inside its batch —
                         the server refuses two that share one — so prefixing the
                         internal `seq` adds a number that identifies nothing and
                         appears nowhere else the packages are listed.
                         Packages already spoken for by ANOTHER row are dropped:
                         picking one twice is a save-time error, and a list that
                         cannot express the mistake beats a message about it. */
                      options={(existingOptions ?? [])
                        .filter(
                          (option) =>
                            option.batchUnitId === unit.batchUnitId ||
                            !units.some(
                              (other) =>
                                other.id !== unit.id && other.batchUnitId === option.batchUnitId,
                            ),
                        )
                        .map((option) => ({
                          value: option.batchUnitId,
                          label: option.label,
                        }))}
                      placeholder={`Select a ${singular.toLowerCase()}…`}
                      /* Searchable, exactly like the Existing {batch} picker
                         above it: a batch can hold thirty rolls, and scrolling a
                         plain list to find "T-27" is not the same job as typing
                         it. Matched to `inputStyle` so the two controls in one
                         row are the same box. */
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
                  ) : (
                    <input
                      type="text"
                      value={unit.label}
                      /* Says what happens if you leave it, rather than telling
                         the user to fill in a box they do not have to. */
                      placeholder="Auto-numbered"
                      title={`Optional — leave blank and this ${singular.toLowerCase()} is numbered by its position in the ${batchSingular.toLowerCase()}.`}
                      /* 🔴 The POSITION is in every row's accessible name, because
                         the label no longer is. With it optional, a batch of five
                         unnamed packages gave a screen reader five controls called
                         "Taka label" and no way to tell which row it was on. */
                      aria-label={`${singular} ${index + 1} label (optional)`}
                      onChange={(e) => onChange(unit.id, 'label', e.target.value)}
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                      onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                    />
                  )}
                </td>
                <td style={{ padding: '3px 6px 3px 0', verticalAlign: 'middle' }}>
                  <input
                    type="number"
                    step="any"
                    value={unit.quantity}
                    placeholder="0"
                    aria-label={`${singular} ${index + 1} quantity`}
                    onChange={(e) => onChange(unit.id, 'quantity', e.target.value)}
                    style={{ ...inputStyle, textAlign: 'right' }}
                    onFocus={(e) => (e.target.style.borderColor = '#0062ff')}
                    onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
                  />
                </td>
                <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                  <button
                    type="button"
                    onClick={() => onRemove(unit.id)}
                    aria-label={`Remove ${unit.label.trim() || `${singular} ${index + 1}`}`}
                    title={`Remove this ${singular.toLowerCase()}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#ef4444',
                      padding: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: '4px',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}
      >
        {/* The same New/Existing pair the batch row above carries, for the same
            reason: a package is either arriving for the first time or is one we
            already hold getting more. "Existing" is dead on a batch being created
            — it has no packages yet — so it is disabled rather than hidden, which
            says why instead of leaving a control that comes and goes. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: units.length > 0 ? '4px 0 0' : '0',
          }}
        >
          <AddUnitLink label={`New ${singular}`} onClick={onAdd} />
          {offersExisting && (
            <>
              <span style={{ color: '#e2e8f0', fontSize: 12 }}>|</span>
              <AddUnitLink
                label={`Existing ${singular}`}
                onClick={() => onAddExisting?.()}
                disabled={(existingOptions ?? []).length === 0}
                title={
                  (existingOptions ?? []).length === 0
                    ? `This ${batchSingular.toLowerCase()} has no existing ${singular.toLowerCase()} to add to yet.`
                    : undefined
                }
              />
            </>
          )}
        </div>

        {/* 🔴 The gap against the batch, and since 2026-09-02 it must close.
            Naming any package now commits to naming them all, so a non-zero
            figure is a blocker rather than a fact — it is red either way, and
            says which direction it is out by. */}
        {units.length > 0 && (
          <span
            style={{
              fontSize: 12,
              whiteSpace: 'nowrap',
              fontWeight: 500,
              color: Math.abs(unallocated) > QTY_EPSILON ? '#b91c1c' : '#16a34a',
            }}
          >
            {Math.abs(unallocated) <= QTY_EPSILON
              ? `matches ${batchQty}${uomLabel ? ` ${uomLabel}` : ''}`
              : unallocated > 0
                ? `${Number(unallocated.toFixed(4))}${uomLabel ? ` ${uomLabel}` : ''} still to name`
                : `${Number((-unallocated).toFixed(4))}${uomLabel ? ` ${uomLabel}` : ''} over`}
          </span>
        )}
      </div>
    </div>
  );
}

/** A real `<button>`, so Tab reaches it and `disabled` means something — the two
 * links here sit inside a dialog whose every other control is keyboard-reachable. */
function AddUnitLink({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Sized to the toggle above it and the unallocated readout beside it —
        // 13px text with a 15px icon made the two links the heaviest thing in a
        // panel where they are the lightest job on offer.
        gap: 3,
        color: disabled ? '#cbd5e1' : '#0062ff',
        background: 'none',
        border: 'none',
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '2px 4px',
        borderRadius: 4,
      }}
    >
      <Plus size={13} /> {label}
    </button>
  );
}
