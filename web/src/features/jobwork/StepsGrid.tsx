import { blurOnWheel } from '../../components/ui/blurOnWheel';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Select } from '../../components/ui/Select';
import { useUoms } from '../inventory/uom/uom.api';
import { itemsApi } from '../items/items.api';
import { fetchVendors } from '../purchases/vendors/vendors.api';
import { fetchLocations } from '../configuration/locations/locations.api';
import { ProcessSelect } from './processes/ProcessSelect';
import { RATE_BASIS_OPTIONS } from './processes/processes.schemas';
import {
  PROCESSOR_TYPE_OPTIONS,
  emptyStep,
  emptyStepItem,
  feedsSteps,
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
interface Props<T extends StepGridRow> {
  steps: T[];
  onChange: (steps: T[]) => void;
  /** Server-side chain errors, keyed `steps.<index>.<field>`. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /**
   * Show the per-item quantity and tolerance boxes. Job orders yes, route
   * templates no — a template has no idea how much anyone will run through it,
   * and which item needs a looser tolerance is a per-run answer.
   *
   * There is no unit label prop any more: every row shows its OWN item's unit
   * beside it, because one header unit cannot caption metres, cones and pieces.
   */
  showPlannedQty?: boolean;
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
  items: { id: string; name: string; stockingUomId?: string | null }[];
  stockingUomLabel: (itemId: string | null | undefined) => string | null;
  uomOptions: { value: string; label: string }[];
  showQty?: boolean;
  disabled?: boolean;
  stepIndex: number;
  errors?: Record<string, string>;
  badgeFor: (row: StepItemRow) => { text: string; tone: 'chain' | 'stock' } | null;
  /** Shown when the list is empty. Says what an empty list MEANS, never what the
   * server might invent — it invents nothing now. */
  emptyHint: string;
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
 * the next step's lot picker turns up empty days later.
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
  items,
  stockingUomLabel,
  uomOptions,
  showQty,
  disabled,
  stepIndex,
  errors,
  badgeFor,
  emptyHint,
}: ItemListProps) {
  const isInput = side === 'inputs';
  const update = (rowIndex: number, patch: Partial<StepItemRow>) =>
    onChange(rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)));

  /**
   * Exactly one primary output (§9.2.1) — it absorbs the step's whole cost, so
   * two would pay for the operation twice and none would leave the cost nowhere.
   * Radio semantics, enforced here rather than left to the server to reject.
   */
  const setPrimary = (rowIndex: number) =>
    onChange(rows.map((row, i) => ({ ...row, isPrimary: i === rowIndex })));

  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, background: '#fcfcfd' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', letterSpacing: 0.3 }}>
          {isInput ? 'CONSUMES' : 'PRODUCES'}
        </span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {isInput ? 'items issued to the processor' : 'items that come back'}
        </span>
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* 🔴 An empty list means an empty list. Nothing is added behind your
            back — what these rows say is exactly what is written. */}
        {rows.length === 0 && (
          <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{emptyHint}</p>
        )}

        {rows.map((row, rowIndex) => {
          const rowError = errors?.[`steps.${stepIndex}.${side}.${rowIndex}.itemId`];
          const unitLabel = stockingUomLabel(row.itemId);
          const badge = badgeFor(row);
          const qtyId = `step-${stepIndex}-${side}-${rowIndex}-qty`;
          return (
            <div key={rowIndex} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: '2 1 150px', minWidth: 0 }}>
                  <Select
                    value={row.itemId || ''}
                    onChange={(value) => update(rowIndex, { itemId: value })}
                    options={[
                      { value: '', label: 'Pick an item…' },
                      ...items.map((i) => ({ value: i.id, label: i.name })),
                    ]}
                    disabled={disabled}
                    ariaLabel={`Step ${stepIndex + 1} ${isInput ? 'input' : 'output'} ${rowIndex + 1} item`}
                    minWidth={0}
                  />
                </div>

                {/* One item, one stocking unit (§5.1) — so this is a fact, not a
                    choice, wherever the item can answer. */}
                <div style={{ flex: '0 0 62px' }}>
                  {unitLabel ? (
                    <div
                      style={{ ...cellReadOnly, justifyContent: 'center' }}
                      title="The item’s stocking unit"
                    >
                      {unitLabel}
                    </div>
                  ) : (
                    <Select
                      value={row.uomId ?? ''}
                      onChange={(value) => update(rowIndex, { uomId: value || null })}
                      options={uomOptions}
                      disabled={disabled}
                      ariaLabel={`Step ${stepIndex + 1} ${isInput ? 'input' : 'output'} ${rowIndex + 1} unit`}
                      minWidth={0}
                    />
                  )}
                </div>

                {/* 🔴 THE PER-ITEM QUANTITY. 2,910 PCS of panels, 12 CONE of
                    thread, 8,700 PCS of buttons — three numbers, because their
                    sum is 11,622 of nothing (§6.5). */}
                {showQty && (
                  <div style={{ flex: '0 0 84px' }}>
                    <label htmlFor={qtyId} style={srOnly}>
                      {`Step ${stepIndex + 1} ${isInput ? 'planned' : 'expected'} quantity for row ${rowIndex + 1}`}
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
                      placeholder={isInput ? 'qty' : 'expected'}
                      title={
                        isInput
                          ? 'How much of this item the step consumes'
                          : 'How much of this item is expected back'
                      }
                      style={cellInput}
                    />
                  </div>
                )}

                {/* Blank means "use the step's" — fabric at 3% beside thread at
                    25%, because small quantities vary more. */}
                {showQty && isInput && (
                  <div style={{ flex: '0 0 66px' }}>
                    <label htmlFor={`${qtyId}-tol`} style={srOnly}>
                      {`Step ${stepIndex + 1} tolerance percent for row ${rowIndex + 1}`}
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
                      placeholder="tol %"
                      title="Over-issue allowance for this item. Blank uses the step’s."
                      style={cellInput}
                    />
                  </div>
                )}

                {!isInput && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: '#475569',
                      whiteSpace: 'nowrap',
                    }}
                    title="The output that carries the cost of this step. Every other output is a by-product."
                  >
                    <input
                      type="radio"
                      name={`step-${stepIndex}-primary`}
                      checked={Boolean(row.isPrimary)}
                      onChange={() => setPrimary(rowIndex)}
                      disabled={disabled}
                    />
                    Main
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== rowIndex))}
                  disabled={disabled}
                  title="Remove item"
                  aria-label={`Remove ${isInput ? 'input' : 'output'} ${rowIndex + 1} from step ${stepIndex + 1}`}
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
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onChange([...rows, emptyStepItem()])}
          disabled={disabled}
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
          <Plus size={12} /> {isInput ? 'Add item to consume' : 'Add item produced'}
        </button>
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
}: Props<T>) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: uoms = [] } = useUoms(orgId!);

  const { data: itemsPage } = useQuery({
    queryKey: ['items', orgId, 'step-grid'],
    queryFn: () => itemsApi.getItems(orgId!, { perPage: 500 }),
    enabled: Boolean(orgId),
  });
  const items = itemsPage?.results ?? [];

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

  const itemById = new Map(items.map((i) => [i.id, i]));
  const uomById = new Map(uoms.map((u) => [u.id, u]));

  /**
   * An item's stocking unit, as it prints. `null` means the item cannot answer —
   * it has no stocking uom yet — and the caller then leaves the dropdown alone,
   * which is exactly what the server does (`applyStepUnits`).
   */
  const stockingUomLabel = (itemId: string | null | undefined): string | null => {
    if (!itemId) return null;
    const stockingUomId = itemById.get(itemId)?.stockingUomId;
    if (!stockingUomId) return null;
    const uom = uomById.get(stockingUomId);
    return uom ? uom.symbol || uom.unitName : null;
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((step, index) => {
          /**
           * The server's ordering error (§6.4) is keyed to the row it landed on;
           * anything on this step turns the block red.
           */
          const chainError = Object.entries(errors ?? {}).find(
            ([key]) =>
              key.startsWith(`steps.${index}.inputs`) || key.startsWith(`steps.${index}.outputs`),
          )?.[1];
          const field = (id: string) => `step-${index}-${id}`;

          /**
           * A step that lists no inputs of its own takes what the step above
           * produces — the server's own fallback (`resolveStepRows`). Shown as a
           * stated fact rather than a pre-filled row, so that adding a row is a
           * deliberate act of overriding it.
           */
          const previousOutputs = index > 0 ? (steps[index - 1]?.outputs ?? []) : [];
          const previousPrimaryItemId =
            (previousOutputs.find((row) => row.isPrimary) ?? previousOutputs[0])?.itemId ?? null;
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
                <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                  Step {index + 1}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                    title="Move up"
                    aria-label={`Move step ${index + 1} up`}
                    style={{ ...iconButton, opacity: index === 0 ? 0.4 : 1 }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === steps.length - 1}
                    title="Move down"
                    aria-label={`Move step ${index + 1} down`}
                    style={{ ...iconButton, opacity: index === steps.length - 1 ? 0.4 : 1 }}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(steps.filter((_, i) => i !== index))}
                    disabled={disabled || steps.length === 1}
                    title="Remove step"
                    aria-label={`Remove step ${index + 1}`}
                    style={{ ...iconButton, opacity: steps.length === 1 ? 0.4 : 1 }}
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
                                  isPrimary: true,
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
                    disabled={disabled}
                    ariaLabel={`Step ${index + 1} process`}
                    minWidth="100%"
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
                    disabled={disabled}
                    ariaLabel={`Step ${index + 1} performed by`}
                    minWidth={0}
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
                        { value: '', label: 'Pick a work centre…' },
                        ...workCentres.map((l) => ({ value: l.id, label: l.name })),
                      ]}
                      disabled={disabled}
                      ariaLabel={`Step ${index + 1} work centre`}
                      minWidth={0}
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
                      disabled={disabled}
                      ariaLabel={`Step ${index + 1} processor`}
                      minWidth={0}
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
                    disabled={disabled}
                    style={cellInput}
                  />
                </div>

                <div>
                  <span style={fieldLabel}>Rate basis</span>
                  <Select
                    value={step.rateBasis ?? ''}
                    onChange={(value) => update(index, { rateBasis: value || null })}
                    options={[{ value: '', label: 'From the process' }, ...RATE_BASIS_OPTIONS]}
                    disabled={disabled}
                    ariaLabel={`Step ${index + 1} rate basis`}
                    minWidth={0}
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
                    disabled={disabled}
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
                  items={items}
                  stockingUomLabel={stockingUomLabel}
                  uomOptions={uomOptions}
                  showQty={showPlannedQty}
                  disabled={disabled}
                  stepIndex={index}
                  errors={errors}
                  /* Step 1's row for the order's item is a REAL row, locked to
                     that item but carrying its own quantity — see `lockedItemId`.
                     The only thing still shown as a bare fact is a later step
                     that lists nothing and simply takes what the step above
                     produces, where there is no quantity to type: the server
                     plans it from that step's expected output. */
                  emptyHint={
                    previousPrimaryLabel
                      ? `Nothing listed — this step will consume nothing. Add ${previousPrimaryLabel} if it carries on from step ${index}.`
                      : 'Nothing listed — this step will consume nothing.'
                  }
                  badgeFor={(row) => {
                    if (!row.itemId) return null;
                    const from = producedByStep(steps, index, row.itemId);
                    return from
                      ? { text: `From step ${from}`, tone: 'chain' as const }
                      : { text: 'From stock', tone: 'stock' as const };
                  }}
                />

                <ItemList
                  side="outputs"
                  rows={step.outputs ?? []}
                  onChange={(rows) => update(index, { outputs: rows })}
                  items={items}
                  stockingUomLabel={stockingUomLabel}
                  uomOptions={uomOptions}
                  showQty={showPlannedQty}
                  disabled={disabled}
                  stepIndex={index}
                  errors={errors}
                  emptyHint="Nothing listed — this step will produce nothing, and nothing can be received against it. Add what comes back, even if it is the same item that went in."
                  badgeFor={(row) => {
                    if (!row.itemId) return null;
                    const fed = feedsSteps(steps, index, row.itemId, Boolean(row.isPrimary));
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
        🔴 The new step is SEEDED, not inferred. Carrying on from the step above
        is the normal case, so its main output is put in as a real row — visible,
        editable, and deletable — rather than left to the server to add on save.
        Nothing about the row is special once it is there.
      */}
      <button
        type="button"
        onClick={() => {
          const previousOutputs = steps[steps.length - 1]?.outputs ?? [];
          const carriedOn =
            (previousOutputs.find((row) => row.isPrimary) ?? previousOutputs[0])?.itemId ?? null;
          const next = emptyStep() as T;
          onChange([
            ...steps,
            carriedOn ? { ...next, inputs: [{ ...emptyStepItem(), itemId: carriedOn }] } : next,
          ]);
        }}
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
