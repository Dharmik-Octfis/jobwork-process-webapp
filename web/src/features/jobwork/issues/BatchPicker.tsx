import { useMemo, useState } from 'react';
import { useCombobox } from 'downshift';
import { Check, ChevronDown, PackagePlus, Trash2 } from 'lucide-react';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatch } from '../batches/batches.api';

export interface BatchSelection {
  /**
   * 🔴 THE BATCH ITSELF, not just its id.
   *
   * The list underneath this picker is a SEARCH result: typing narrows it, and a
   * batch already picked can drop straight out of it on the next keystroke.
   * Holding only an id would leave the row it selected with nothing to render and
   * nothing to check the quantity against — the pick would appear to have been
   * forgotten. Keeping the row means what is picked stays picked no matter what
   * the search does.
   */
  batch: AvailableBatch;
  qty: number;
}

interface Props {
  /** The current search window. NOT the selection — see `BatchSelection`. */
  batches: AvailableBatch[];
  /** Keyed by batchId, shared across every item section in the dialog. */
  selection: Record<string, BatchSelection>;
  onChange: (selection: Record<string, BatchSelection>) => void;
  itemId: string;
  uomLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  /** True once the server returned a full page — more batches exist than are
   * shown, and the only way to reach them is a narrower search. */
  isCapped: boolean;
  /** When the process demands one batch, picking a second is refused with the
   * reason shown rather than silently ignored. */
  singleBatchOnly: boolean;
  onSingleBatchBlocked: () => void;
  onAddStock: () => void;
  isLoading: boolean;
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#333' };

const qtyInput: React.CSSProperties = {
  width: 110,
  padding: '5px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  minHeight: 30,
};

const addStockButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  color: '#0062ff',
  background: '#fff',
  border: '1px solid #bfdbfe',
  borderRadius: 4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * 🔴 THE CORE OF THE ISSUE DIALOG. Every row here came from an availability query
 * over the stock ledger — this is not a batch master, filtered.
 *
 * 🔴 THE USER PICKS THE BATCH, AND NOTHING PICKS ONE FOR THEM. Until 2026-08-13
 * this rendered every available batch as a row with a quantity box, which reads as
 * a form pre-filled with an answer when there are two batches and is unusable when
 * there are three hundred — the number a mill actually carries. It is now a
 * search box that adds batches to a list, and the list starts empty: what leaves
 * the godown is a decision somebody made, not the first row that happened to sort
 * first.
 *
 * Granularity stops at the BATCH. Material is issued as a typed quantity checked
 * against the batch's own available balance. Per-taka checkboxes went with
 * package-level tracking on 2026-08-12.
 */
export function BatchPicker({
  batches,
  selection,
  onChange,
  itemId,
  uomLabel,
  search,
  onSearchChange,
  isCapped,
  singleBatchOnly,
  onSingleBatchBlocked,
  onAddStock,
  isLoading,
}: Props) {
  const [inputValue, setInputValue] = useState('');

  /**
   * 🔴 Scoped to THIS item (§5.7). The dialog shows a section per input item and
   * they share one selection map, so counting the whole map would make picking
   * fabric block picking thread on any single-batch process. Two items are
   * necessarily two batches; the rule is about two batches of the SAME item, which
   * is what shade variation means, and the server checks it exactly this way.
   */
  const picked = useMemo(
    () => Object.values(selection).filter((sel) => sel.batch.itemId === itemId),
    [selection, itemId],
  );
  const pickedIds = useMemo(() => new Set(picked.map((sel) => sel.batch.batchId)), [picked]);

  /** Already-picked batches leave the dropdown: they are on screen below it, with
   * their own quantity box. Offering them twice offers a second row for one batch. */
  const options = useMemo(
    () => batches.filter((batch) => !pickedIds.has(batch.batchId)),
    [batches, pickedIds],
  );

  /** Checked on ADDING a batch, not on typing into one. A second row sitting at
   * zero is a pick the server would refuse the moment a quantity landed in it, so
   * it never gets added at all — the refusal arrives while the user is still
   * choosing rather than at save. */
  const blockedByBatchRule = singleBatchOnly && picked.length > 0;

  const addBatch = (batch: AvailableBatch) => {
    if (blockedByBatchRule) {
      onSingleBatchBlocked();
      return;
    }
    onChange({ ...selection, [batch.batchId]: { batch, qty: 0 } });
  };

  const setQty = (batchId: string, qty: number) => {
    const current = selection[batchId];
    if (!current) return;
    onChange({ ...selection, [batchId]: { ...current, qty } });
  };

  const removeBatch = (batchId: string) => {
    const next = { ...selection };
    delete next[batchId];
    onChange(next);
  };

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    openMenu,
  } = useCombobox({
    items: options,
    inputValue,
    // Nothing stays selected in the box: a pick becomes a row below, and the box
    // goes back to being empty and ready for the next one.
    selectedItem: null,
    itemToString: (batch) => (batch ? batch.batchNumber : ''),
    /**
     * Clearing the box on a pick has to happen HERE, not in `onSelectedItemChange`.
     * Downshift emits the input-value change and the selection change from the
     * same state transition, so a clear written in the callback races the batch
     * number downshift puts there — and loses often enough to leave the last pick
     * sitting in the search box, filtering the list down to itself.
     */
    stateReducer: (_state, { type, changes }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          // Stays open: picking three batches off one challan is one gesture, not
          // three trips back to the box.
          return { ...changes, inputValue: '', isOpen: true, highlightedIndex: 0 };
        /**
         * 🔴 A CLICK ALWAYS OPENS IT. Downshift TOGGLES on a click, and the first
         * click on an unfocused input also fires `focus` — so opening it there and
         * letting the toggle run closed it again, and the list only appeared on
         * the SECOND click. Forcing open here means focus and click agree.
         */
        case useCombobox.stateChangeTypes.InputClick:
          return { ...changes, isOpen: true };
        default:
          return changes;
      }
    },
    onInputValueChange: ({ inputValue: next }) => {
      setInputValue(next ?? '');
      onSearchChange(next ?? '');
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) addBatch(selectedItem);
    },
  });

  const emptyMessage = isLoading
    ? 'Looking up available stock…'
    : search
      ? 'No batch here matches that.'
      : 'No stock of this item is available at that location for this job order’s ownership.';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Sized to a batch number, not to the dialog. It stretched the full width
            before, which read as the main field of the form when it is a way in to
            one. The dropdown under it is free to be wider. */}
        <div style={{ position: 'relative', width: 300, maxWidth: '100%' }}>
          <input
            {...getInputProps({
              // Focus alone opens it: the first thing anyone wants here is to see
              // what there is, and making them type first hides an empty godown.
              // Paired with the `InputClick` case above — without that, this and
              // the click cancelled each other out.
              onFocus: () => {
                if (!isOpen) openMenu();
              },
              placeholder: 'Pick a batch…',
              'aria-label': 'Search and pick a batch to issue from',
              style: {
                width: '100%',
                padding: '7px 30px 7px 10px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                boxSizing: 'border-box',
                minHeight: 34,
                background: '#fff',
              },
            })}
          />
          <button
            type="button"
            {...getToggleButtonProps()}
            aria-label="Show available batches"
            style={{
              position: 'absolute',
              right: 4,
              top: 4,
              height: 26,
              width: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#94a3b8',
              borderRadius: 3,
            }}
          >
            <ChevronDown
              size={14}
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform .15s',
              }}
            />
          </button>

          <ul
            {...getMenuProps()}
            style={{
              position: 'absolute',
              zIndex: 20,
              top: '100%',
              left: 0,
              // Wider than the box that opens it: a batch row carries a number, a
              // supplier reference and a balance, and cramming those into the
              // trigger's width is what made the trigger want to be huge.
              minWidth: '100%',
              width: 420,
              maxWidth: '90vw',
              margin: '4px 0 0 0',
              padding: 0,
              listStyle: 'none',
              maxHeight: 260,
              overflowY: 'auto',
              background: '#fff',
              border: isOpen ? '1px solid #e2e8f0' : 'none',
              borderRadius: 4,
              boxShadow: isOpen ? '0 8px 24px rgba(15,23,42,0.12)' : 'none',
            }}
          >
            {isOpen &&
              (options.length === 0 ? (
                <li style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>
                  {emptyMessage}
                </li>
              ) : (
                <>
                  {options.map((batch, index) => (
                    <li
                      key={batch.batchId}
                      {...getItemProps({ item: batch, index })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 12px',
                        fontSize: 13,
                        cursor: 'pointer',
                        background: highlightedIndex === index ? '#eff6ff' : '#fff',
                      }}
                    >
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 500, color: '#111' }}>{batch.batchNumber}</span>
                        {batch.supplierBatchRef && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            Supplier ref {batch.supplierBatchRef}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatQty(batch.availableQty)} {uomLabel}
                        {batch.costPerUnit !== null && ` · ${formatQty(batch.costPerUnit)}/unit`}
                      </span>
                    </li>
                  ))}
                  {isCapped && (
                    <li style={{ padding: '8px 12px', fontSize: 11, color: '#92400e' }}>
                      Only the first {batches.length} batches are listed — type to narrow.
                    </li>
                  )}
                </>
              ))}
          </ul>
        </div>

        {/* Stock that is not on the books yet is the commonest reason this picker
            comes back empty, and sending the user off to the Item screen to fix it
            loses the challan they were half-way through. */}
        <button type="button" onClick={onAddStock} style={addStockButton}>
          <PackagePlus size={14} /> Add stock
        </button>
      </div>

      {picked.length === 0 ? (
        <div
          style={{
            marginTop: 10,
            padding: '14px 16px',
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            borderRadius: 4,
            color: '#475569',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {isLoading
            ? 'Looking up available stock…'
            : batches.length === 0 && !search
              ? 'No stock of this item is available at that location for this job order’s ownership. Add stock, or pick a different godown to issue from.'
              : 'No batch picked yet — search above and choose the batch this material is going out of.'}
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            border: '1px solid #eef0f3',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                <th style={th} scope="col">
                  Batch
                </th>
                <th style={th} scope="col">
                  Available
                </th>
                <th style={th} scope="col">
                  Cost / unit
                </th>
                <th style={{ ...th, width: 150 }} scope="col">
                  Qty to issue
                </th>
                <th style={{ ...th, width: 44 }} scope="col">
                  <span style={{ position: 'absolute', left: -9999 }}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {picked.map(({ batch, qty }) => (
                <tr key={batch.batchId} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                    {batch.batchNumber}
                    {batch.supplierBatchRef && (
                      <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
                        {batch.supplierBatchRef}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {formatQty(batch.availableQty)} {uomLabel}
                  </td>
                  <td style={td}>
                    {batch.costPerUnit === null ? '-' : formatQty(batch.costPerUnit)}
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      max={toNumber(batch.availableQty)}
                      value={qty || ''}
                      onChange={(e) => setQty(batch.batchId, Number(e.target.value))}
                      aria-label={`Quantity to issue from batch ${batch.batchNumber}`}
                      style={qtyInput}
                    />
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => removeBatch(batch.batchId)}
                      aria-label={`Remove batch ${batch.batchNumber}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        border: '1px solid #e2e8f0',
                        borderRadius: 4,
                        background: '#fff',
                        color: '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {singleBatchOnly && picked.length > 0 && (
        <p style={{ margin: '8px 0 0 0', fontSize: 11, color: '#92400e' }}>
          <Check size={11} style={{ verticalAlign: -1 }} /> This process runs on a single batch, so
          only one can be picked per item.
        </p>
      )}
    </div>
  );
}
