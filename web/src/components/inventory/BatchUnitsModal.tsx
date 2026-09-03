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
 * It replaced an inline expanding panel. What did NOT change is the editing
 * model: the grid writes straight through to the caller's state, exactly as it
 * did expanded, so there is no draft to commit and no Cancel that pretends to
 * revert one. The single action is "Done", which closes.
 *
 * Nesting is fine — `Modal` keeps a stack, so Escape closes this one and leaves
 * the batch dialog underneath open, and the body's scroll lock survives until the
 * last one closes.
 */

interface BatchUnitsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** How to name the batch in the heading — its reference, or the word "Batch". */
  batchName: string;
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
}

export function BatchUnitsModal({
  isOpen,
  onClose,
  batchName,
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
}: BatchUnitsModalProps) {
  const gap = Number((batchQty - unitsTotal(units)).toFixed(4));
  const balanced = Math.abs(gap) <= QTY_EPSILON;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${plural} in ${batchName}`}
      /* The rule the user is most likely to trip: name one package and they must
         all be named. Said here, before they type, rather than by a red readout
         after. */
      subtitle={
        `${batchName} holds ${batchQty}${uomLabel ? ` ${uomLabel}` : ''}. ` +
        `Names are optional — leave one blank and it is numbered by its position. ` +
        `Add none at all and the whole ${batchSingular.toLowerCase()} stays untagged.`
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
          {/* The same figure the grid carries, repeated on the sticky bar: the
              grid's copy scrolls away once a batch holds twenty packages, and
              this is the number that decides whether Save will be refused. */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
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
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              background: '#0062ff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
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
