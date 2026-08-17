import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCombobox } from 'downshift';
import { ChevronDown, PackagePlus, Trash2 } from 'lucide-react';
import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { formatQty, toNumber } from '../jobwork.schemas';
import type { AvailableBatch } from '../batches/batches.api';

/**
 * 🔴 THE KEY IS THE BATCH **AND** THE GODOWN (2026-08-14).
 *
 * A challan may draw from every godown in a dispatch site, and one batch can sit
 * in two of them with two independent balances — so it is offered twice and can
 * be picked twice, with a different quantity from each. Keying the selection on
 * `batchId` alone silently collapsed those into one row, and whichever was picked
 * second overwrote the first.
 */
const rowKey = (batch: Pick<AvailableBatch, 'batchId' | 'locationId'>) =>
  `${batch.batchId}@${batch.locationId}`;

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
  /** Keyed by `rowKey` — batch AND godown — and shared across every item section
   * in the dialog. */
  selection: Record<string, BatchSelection>;
  onChange: (selection: Record<string, BatchSelection>) => void;
  itemId: string;
  uomLabel: string;
  search: string;
  onSearchChange: (search: string) => void;
  /** True once the server returned a full page — more batches exist than are
   * shown, and the only way to reach them is a narrower search. */
  isCapped: boolean;
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

/** Sits on the same line as the search box and Add stock — it used to be a dashed
 * panel below them, which cost a block of height to say nothing was picked yet. */
const emptyHint: React.CSSProperties = { fontSize: 12, color: '#94a3b8', lineHeight: 1.4 };

/** A batch row carries a number, a supplier reference and a balance, so the menu
 * is wider than the box that opens it. */
const MENU_WIDTH = 420;
const MENU_MAX_HEIGHT = 260;
/** Above `Modal`'s overlay (1100) — the menu is a sibling of it on `document.body`. */
const MENU_Z_INDEX = 1200;
/** Below this much room under the anchor, the menu opens upwards instead. */
const MENU_MIN_HEIGHT = 160;

/**
 * 🔴 WHAT A BATCH IS CALLED ON SCREEN (2026-08-14).
 *
 * The reference off the physical tag, and nothing else. `batchNumber` is an
 * internal key — never rendered, never printed, never searched — so it is not a
 * fallback here either. A batch with no reference belongs to an untracked item,
 * whose batches nobody is supposed to be identifying in the first place; it gets
 * a dated placeholder rather than a blank cell or a leaked internal number.
 */
function batchLabel(batch: AvailableBatch): string {
  return batch.supplierBatchRef?.trim() || `Stock of ${formatShortDate(batch.createdAt)}`;
}

/**
 * The line UNDER the label, and the reason it exists: references are deliberately
 * not unique — Zoho allows duplicates and so do we — so two live rows can both
 * read `jv2`. These are the facts that actually tell them apart, and a mill hand
 * recognises "12 Aug, ₹104" far faster than any identifier.
 */
function batchDetail(batch: AvailableBatch, uomLabel: string, showGodown: boolean): string {
  const parts = [
    // 🔴 First, when the site has more than one godown. Which rack the goods are
    // in is the thing that decides whether the picker's two `jv2` rows are the
    // same material or not, and it is what the loader needs to be told.
    showGodown ? batch.locationName : null,
    batch.manufacturerBatch?.trim() ? `MFR ${batch.manufacturerBatch.trim()}` : null,
    formatShortDate(batch.createdAt),
    batch.costPerUnit !== null ? `${formatQty(batch.costPerUnit)}/${uomLabel || 'unit'}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

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
  onAddStock,
  isLoading,
}: Props) {
  const [inputValue, setInputValue] = useState('');

  /**
   * 🔴 Scoped to THIS item (§5.7). The dialog shows a section per input item and
   * they share one selection map, so the rows rendered below — and the ones taken
   * out of the dropdown — have to be this item's, not the whole challan's.
   */
  const picked = useMemo(
    () => Object.values(selection).filter((sel) => sel.batch.itemId === itemId),
    [selection, itemId],
  );
  const pickedKeys = useMemo(() => new Set(picked.map((sel) => rowKey(sel.batch))), [picked]);

  /**
   * Whether to name the godown on each row. Only when the site actually has stock
   * of this item in more than one — a single-godown customer, which is most of
   * them, would just see the same name repeated on every line.
   *
   * Read off the offered rows plus what is already picked: a picked row leaves the
   * dropdown, so counting `batches` alone would drop the label the moment the
   * second godown's row was taken.
   */
  const spansGodowns = useMemo(() => {
    const seen = new Set(batches.map((batch) => batch.locationId));
    for (const sel of picked) seen.add(sel.batch.locationId);
    return seen.size > 1;
  }, [batches, picked]);

  /** Already-picked rows leave the dropdown: they are on screen below it, with
   * their own quantity box. Offering them twice offers a second row for one pick.
   * By (batch, godown) — the same batch in another godown is a different row and
   * stays on offer. */
  const options = useMemo(
    () => batches.filter((batch) => !pickedKeys.has(rowKey(batch))),
    [batches, pickedKeys],
  );

  const addBatch = (batch: AvailableBatch) => {
    onChange({ ...selection, [rowKey(batch)]: { batch, qty: 0 } });
  };

  const setQty = (key: string, qty: number) => {
    const current = selection[key];
    if (!current) return;
    onChange({ ...selection, [key]: { ...current, qty } });
  };

  const removeBatch = (key: string) => {
    const next = { ...selection };
    delete next[key];
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
    itemToString: (batch) => (batch ? batchLabel(batch) : ''),
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

  /**
   * 🔴 THE MENU IS PORTALLED OUT OF THE DIALOG, and it has to be.
   *
   * Everything between this picker and the viewport clips it: each item section
   * in the Issue dialog sets `overflow: hidden` for its rounded header strip, and
   * the dialog body is the scroll container. An absolutely positioned menu was cut
   * off at the section's edge — the list opened *inside* the card and only the
   * first row or two were ever visible, with no way to scroll to the rest.
   *
   * `position: fixed` on `document.body` escapes both, at the price of measuring
   * the anchor. Re-measured on scroll in the CAPTURE phase: the scroller is the
   * dialog body, and `scroll` does not bubble, so a listener on `window` never
   * hears it and the menu would hang in mid-air as the dialog scrolled under it.
   */
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

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
      : 'No stock of this item is available at that location for this job order’s ownership.';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Sized to a batch number, not to the dialog. It stretched the full width
            before, which read as the main field of the form when it is a way in to
            one. The menu is measured off this element — see `anchorRef`. */}
        <div ref={anchorRef} style={{ position: 'relative', width: 300, maxWidth: '100%' }}>
          <input
            {...getInputProps({
              // Focus alone opens it: the first thing anyone wants here is to see
              // what there is, and making them type first hides an empty godown.
              // Paired with the `InputClick` case above — without that, this and
              // the click cancelled each other out.
              onFocus: () => {
                if (!isOpen) openMenu();
              },
              placeholder: 'Select a batch…',
              'aria-label': 'Search and select a batch to issue from',
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
        </div>

        {/* Stock that is not on the books yet is the commonest reason this picker
            comes back empty, and sending the user off to the Item screen to fix it
            loses the challan they were half-way through. */}
        <button type="button" onClick={onAddStock} style={addStockButton}>
          <PackagePlus size={14} /> Add stock
        </button>

        {picked.length === 0 && (
          <span style={emptyHint}>
            {isLoading
              ? 'Looking up available stock…'
              : batches.length === 0 && !search
                ? 'No stock of this item here — add stock, or issue from a different godown.'
                : 'No batch selected yet'}
          </span>
        )}
      </div>

      {/* Rendered whether open or not: downshift needs `getMenuProps`' ref on a live
          element to know a click landed inside its own menu rather than outside it. */}
      {createPortal(
        <ul
          {...getMenuProps()}
          style={{
            position: 'fixed',
            zIndex: MENU_Z_INDEX,
            display: isOpen ? 'block' : 'none',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 4,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            ...menuPosition,
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
                    key={rowKey(batch)}
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
                      <span style={{ fontWeight: 500, color: '#111' }}>{batchLabel(batch)}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {batchDetail(batch, uomLabel, spansGodowns)}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                      {formatQty(batch.availableQty)} {uomLabel}
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
        </ul>,
        document.body,
      )}

      {picked.length > 0 && (
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
                <tr key={rowKey(batch)} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                    {batchLabel(batch)}
                    {/* Repeated from the dropdown on purpose: once a row is down
                        here the menu is closed, and two picked rows both reading
                        `jv2` are otherwise indistinguishable. */}
                    <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
                      {batchDetail(batch, uomLabel, spansGodowns)}
                    </span>
                  </td>
                  <td style={td}>
                    {formatQty(batch.availableQty)} {uomLabel}
                  </td>
                  <td style={td}>
                    <input
                      type="number"
                      onWheel={blurOnWheel}
                      step="0.0001"
                      min="0"
                      max={toNumber(batch.availableQty)}
                      value={qty || ''}
                      onChange={(e) => setQty(rowKey(batch), Number(e.target.value))}
                      aria-label={`Quantity to issue from batch ${batchLabel(batch)}`}
                      style={qtyInput}
                    />
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => removeBatch(rowKey(batch))}
                      aria-label={`Remove batch ${batchLabel(batch)}`}
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
    </div>
  );
}
