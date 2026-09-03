import { Package, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { BatchUnitsGrid } from './BatchUnitsGrid';
import {
  unitsTotal,
  QTY_EPSILON,
  type BatchUnitRow,
  type ExistingBatchUnitOption,
} from './batchUnits';

/**
 * 🔴 THE PACKAGE LEVEL GETS ITS OWN DIALOG — the same shape as the level above it.
 *
 * A batch is entered by pressing "Add {batches}" and filling a dialog. Its
 * packages are now entered the same way: press "Add {takas}" on the batch row and
 * fill a dialog. One rule for both levels means the user learns it once, and a
 * delivery of ten batches no longer sprawls ten inline grids down a screen nobody
 * could scroll.
 *
 * It replaced an inline expanding panel.
 *
 * 🔴 SAVE AND CANCEL, and Cancel really does undo (2026-09-03). It replaced a lone
 * "Done", which offered no way out of a half-typed grid but retyping it.
 *
 * The grid still writes STRAIGHT THROUGH to the caller's state, so the undo is a
 * SNAPSHOT — and the snapshot is taken by the CALL SITE, in the handler that opens
 * this dialog, not in here. It has to be: Opening Stock's rows carry `quantityIn`
 * and `isExisting` where this component's row shape has `quantity`, so a snapshot
 * taken from the props would hand back rows with those fields stripped and quietly
 * turn every saved package into a new one. The call site owns the real rows.
 *
 * Nesting is fine — `Modal` keeps a stack, so Escape closes this one and leaves
 * the batch dialog underneath open, and the body's scroll lock survives until the
 * last one closes.
 */

interface BatchUnitsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The batch's REFERENCE, raw — not a display name, and never pre-fallen-back to
   * the word "Batch". The heading pairs it with `batchSingular` itself ("Takas in
   * Batch CF-B-01"), so a caller that substituted the word here got "Batch Batch".
   */
  batchRef: string | null;
  /** What this org calls a batch, so the prose reads in their own words. */
  batchSingular: string;
  /** Per-org name for the level, from `useBatchUnitLabel`. */
  singular: string;
  plural: string;
  /** What the batch itself holds — the total the packages must add up to. */
  batchQty: number;
  uomLabel?: string;
  units: readonly BatchUnitRow[];
  existingOptions?: readonly ExistingBatchUnitOption[];
  onAdd: () => void;
  onAddExisting?: () => void;
  onChange: (unitId: string, field: 'label' | 'quantity', value: string) => void;
  onPickExisting?: (unitId: string, option: ExistingBatchUnitOption) => void;
  onRemove: (unitId: string) => void;
  /**
   * Throw the edit away and close. The grid edits the caller's state as it is
   * typed, so the caller restores the rows it snapshotted when it opened this —
   * see the note above for why the snapshot cannot live in here.
   */
  onCancel: () => void;
  /**
   * 🔴 BILLS ONLY, and omitted everywhere else — no checkbox is rendered and Save
   * changes no quantity.
   *
   * The packages must add up to their batch. When they do not, this is the way out
   * that is not "retype it": tick the box and Save writes the packages' total onto
   * the batch instead, carrying the bill line with it. Exactly the escape hatch
   * `IssueUnitsModal` offers one module over, worded identically.
   */
  overwrite?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** What the LINE would carry once this batch takes the packages' total. */
    projectedQty: number;
    /** Formats a quantity the way the screen behind this one formats it. */
    format: (qty: number) => string;
  };
  /** Commit and close. `applyOverwrite` is the box's state at the moment Save was
   * pressed, so the caller writes the quantity through in one place. */
  onSave?: (applyOverwrite: boolean) => void;
}

export function BatchUnitsModal({
  isOpen,
  onClose,
  batchRef,
  batchSingular,
  singular,
  plural,
  batchQty,
  uomLabel,
  units,
  existingOptions,
  onAdd,
  onAddExisting,
  onChange,
  onPickExisting,
  onRemove,
  onCancel,
  overwrite,
  onSave,
}: BatchUnitsModalProps) {
  const gap = Number((batchQty - unitsTotal(units)).toFixed(4));
  const balanced = Math.abs(gap) <= QTY_EPSILON;

  const handleSave = () => {
    onSave?.(Boolean(overwrite?.checked));
    onClose();
  };

  /**
   * 🔴 THE REFERENCE IS NAMED BY ITS LEVEL, in the org's own word for it —
   * "Takas in Batch CF-B-01", never a bare "Takas in CF-B-01". A reference on its
   * own is only recognisable to someone who already knows what CF-B-01 is, and
   * this dialog opens two levels down from where that was picked. `batchSingular`
   * comes from the tracking preference, so a Lot org reads "Takas in Lot CF-B-01".
   */
  const ref = batchRef?.trim();
  const heading = ref ? `${batchSingular} ${ref}` : batchSingular;
  /** The same thing at the head of a sentence, where an unnamed batch cannot just
   * be the bare word. */
  const subject = ref ? heading : `This ${batchSingular.toLowerCase()}`;

  return (
    <Modal
      isOpen={isOpen}
      /* 🔴 Escape and the ✕ CANCEL, they do not commit — the same answer
         `IssueUnitsModal` gives, and the one a dialog with a Cancel button owes
         its user. Wired to `onClose` they silently kept a half-typed grid, so the
         two ways out of the same dialog disagreed about what happened to it. */
      onClose={onCancel}
      title={`${plural} in ${heading}`}
      /* The rule the user is most likely to trip: name one package and they must
         all be named. Said here, before they type, rather than by a red readout
         after. */
      subtitle={
        <>
          <div>
            {`${subject} holds ${batchQty}${uomLabel ? ` ${uomLabel}` : ''}. ` +
              `Names are optional — leave one blank and it is numbered by its position. ` +
              `Add none at all and the whole ${batchSingular.toLowerCase()} stays untagged.`}
          </div>

          {/* 🔴 Live only while ticking it would change something. A grid that
              already adds up has nothing to overwrite, so the box is disabled
              rather than hidden — a control that comes and goes is harder to
              trust than one that greys out and says why. */}
          {overwrite && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 6,
                fontSize: 12.5,
                color: balanced ? '#94a3b8' : '#334155',
                cursor: balanced ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={overwrite.checked}
                disabled={balanced}
                onChange={(event) => overwrite.onChange(event.target.checked)}
              />
              Overwrite the line item with {overwrite.format(overwrite.projectedQty)} quantities
            </label>
          )}
        </>
      }
      position="fullScreen"
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            gap: 16,
          }}
        >
          {/* 🔴 The actions sit on the LEFT, matching the Save/Cancel pair on the
              batch grid this opens over — a dialog whose buttons jump to the other
              end of the bar is one the eye has to re-find on every open. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: '6px 20px',
                background: '#15803d',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            {/* Throws the edit away and puts the rows back as they were. Without
                it, a half-typed grid could only be undone by retyping it. */}
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '6px 20px',
                background: '#fff',
                color: '#334155',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>

          {/* The same figure the grid carries, repeated on the sticky bar: the
              grid's copy scrolls away once a batch holds twenty packages, and
              this is the number that decides whether the screen behind will
              refuse its own Save. */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              textAlign: 'right',
              color: units.length === 0 ? '#64748b' : balanced ? '#16a34a' : '#b91c1c',
            }}
          >
            {units.length === 0
              ? `No ${plural.toLowerCase()} yet — the whole ${batchSingular.toLowerCase()} stays untagged.`
              : balanced
                ? `Adds up to ${batchQty}${uomLabel ? ` ${uomLabel}` : ''}.`
                : gap > 0
                  ? `${Number(gap.toFixed(4))}${uomLabel ? ` ${uomLabel}` : ''} still to name.`
                  : `${Number((-gap).toFixed(4))}${uomLabel ? ` ${uomLabel}` : ''} more than the ${batchSingular.toLowerCase()} holds.`}
          </span>
        </div>
      }
    >
      <BatchUnitsGrid
        units={units}
        batchQty={batchQty}
        singular={singular}
        batchSingular={batchSingular}
        uomLabel={uomLabel}
        existingOptions={existingOptions}
        onAdd={onAdd}
        onAddExisting={onAddExisting}
        onChange={onChange}
        onPickExisting={onPickExisting}
        onRemove={onRemove}
        frameless
      />
    </Modal>
  );
}

/**
 * The control on a batch row that opens the dialog above — one component rather
 * than four copies, because the four screens that enter a batch differ in their
 * table layout and not at all in this.
 *
 * 🔴 WHEN IT READS "Add {plural}" IT MUST ADD ONE. Opening a dialog whose only
 * content is a second "New {unit}" link is two clicks and two identical labels
 * for one action, so an empty batch gets its first row created on the way in.
 * Once there are packages it reads as a count and only opens.
 */
export function BatchUnitsTrigger({
  count,
  singular,
  plural,
  onOpen,
  disabled,
  title,
}: {
  count: number;
  singular: string;
  plural: string;
  onOpen: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        padding: '4px 2px',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? '#cbd5e1' : '#0062ff',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {count > 0 ? <Package size={13} /> : <Plus size={13} />}
      {count > 0
        ? `${count} ${(count === 1 ? singular : plural).toLowerCase()}`
        : `Add ${plural.toLowerCase()}`}
    </button>
  );
}
