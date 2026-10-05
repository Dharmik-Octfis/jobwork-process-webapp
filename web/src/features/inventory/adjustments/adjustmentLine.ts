import type { AvailableBatch } from '../../jobwork/batches/batches.api';
import { selectionKey, type BatchSelection } from '../../jobwork/issues/batchSelection';
import type { InitialBillBatch } from '../../purchases/bills/AddBillBatchesModal';
import type {
  AdjustmentBatchPayload,
  AdjustmentLinePayload,
  DraftBatch,
  StockAdjustmentDetailLine,
} from './adjustments.schemas';

/**
 * One item's adjustment as a form holds it — shared by the Adjust Stock dialog
 * on the item page (one line) and the Inventory → New Adjustment page (many), so
 * the two cannot come to disagree about what a line means.
 */

export const QTY_EPSILON = 0.00005;

export const round4 = (value: number) => Number(value.toFixed(4));

/** 0 for a box nobody has typed in. */
export const numberOf = (text: string) => {
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : 0;
};

/** What a line needs to know about its item. */
export interface AdjustableItem {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  inventoryTracking?: string | null;
  costPrice?: number | string | null;
  sellingPrice?: number | string | null;
  stockingUom?: { symbol: string } | null;
}

export const isBatchTracked = (item: AdjustableItem | null) =>
  String(item?.inventoryTracking ?? '').toLowerCase() === 'batch';

export const uomOf = (item: AdjustableItem | null) => item?.stockingUom?.symbol || item?.unit || '';

export interface LineDraft {
  /**
   * ONE typed figure, and which box it was typed in — the other box is derived
   * from it at render. Holding both as text would let them drift apart when the
   * quantity available changes under them (another location, a late balance).
   */
  typed: { box: 'adjusted' | 'new'; text: string };
  costPrice: string;
  /** Increase: the rows the bill's Add Batches dialog produced. */
  inBatches: InitialBillBatch[];
  /** Decrease: what the Select Batches dialog produced. */
  outSelection: Record<string, BatchSelection>;
  /**
   * Decrease rows read back from a SAVED draft. A selection needs the live batch
   * behind each row, which only the picker's own query has — so these wait here,
   * and are sent back unchanged, until the picker is opened.
   */
  outSaved: DraftBatch[];
}

export const emptyLine = (item?: AdjustableItem | null): LineDraft => ({
  typed: { box: 'adjusted', text: '' },
  costPrice:
    item?.costPrice !== null && item?.costPrice !== undefined ? String(item.costPrice) : '',
  inBatches: [],
  outSelection: {},
  outSaved: [],
});

/** The signed quantity a line stands for, given what is available now. */
export function adjustedOf(line: LineDraft, available: number): number {
  if (line.typed.text.trim() === '') return 0;
  return line.typed.box === 'adjusted'
    ? numberOf(line.typed.text)
    : round4(numberOf(line.typed.text) - available);
}

/** What each of the two boxes shows. */
export function boxTexts(line: LineDraft, available: number) {
  const blank = line.typed.text.trim() === '';
  const adjusted = adjustedOf(line, available);
  return {
    adjusted: line.typed.box === 'adjusted' ? line.typed.text : blank ? '' : String(adjusted),
    newQty:
      line.typed.box === 'new'
        ? line.typed.text
        : blank
          ? ''
          : String(round4(available + adjusted)),
  };
}

/**
 * Type into one of the two boxes. The batch rows belong to one direction, so a
 * change of sign drops them — they answer a question no longer being asked.
 */
export function withQuantity(
  line: LineDraft,
  box: 'adjusted' | 'new',
  text: string,
  available: number,
): LineDraft {
  const next = { ...line, typed: { box, text } };
  return Math.sign(adjustedOf(next, available)) === Math.sign(adjustedOf(line, available))
    ? next
    : { ...next, inBatches: [], outSelection: {}, outSaved: [] };
}

export const withoutBatches = (line: LineDraft): LineDraft => ({
  ...line,
  inBatches: [],
  outSelection: {},
  outSaved: [],
});

const hasSelection = (line: LineDraft) => Object.keys(line.outSelection).length > 0;

/** How many batches a line names, and what they add up to. */
export function batchSummary(line: LineDraft, adjusted: number) {
  if (adjusted > 0) {
    return {
      count: line.inBatches.length,
      total: line.inBatches.reduce((sum, row) => sum + numberOf(String(row.quantity ?? '')), 0),
    };
  }
  if (hasSelection(line)) {
    const rows = Object.values(line.outSelection);
    return {
      count: new Set(rows.map((row) => row.batch.batchId)).size,
      total: rows.reduce((sum, row) => sum + row.qty, 0),
    };
  }
  return {
    count: new Set(line.outSaved.map((row) => row.batchId)).size,
    total: line.outSaved.reduce((sum, row) => sum + row.quantity, 0),
  };
}

/** The batch button's words: "Add Batches" / "Select Batches", then "1 Batch added" / "2 Batches selected". */
export function batchButtonText(
  count: number,
  adjusted: number,
  words: { singular: string; plural: string },
) {
  if (count === 0) return `${adjusted > 0 ? 'Add' : 'Select'} ${words.plural}`;
  return `${count} ${count === 1 ? words.singular : words.plural} ${adjusted > 0 ? 'added' : 'selected'}`;
}

/**
 * Why this line cannot be ADJUSTED yet, or null. A draft is allowed to be
 * incomplete, so this is asked only on Adjust.
 */
export function lineProblem(
  line: LineDraft,
  item: AdjustableItem,
  available: number,
  words: { batches: string },
): { field: 'quantity' | 'costPrice' | 'batches'; message: string } | null {
  const adjusted = adjustedOf(line, available);
  const magnitude = Math.abs(adjusted);
  if (magnitude < QTY_EPSILON) {
    return { field: 'quantity', message: `${item.name}: enter a quantity to adjust.` };
  }
  if (adjusted < 0 && magnitude > available + QTY_EPSILON) {
    return { field: 'quantity', message: `${item.name}: only ${available} is available here.` };
  }
  if (adjusted > 0 && (line.costPrice.trim() === '' || numberOf(line.costPrice) < 0)) {
    return { field: 'costPrice', message: `${item.name}: enter the cost price.` };
  }
  if (isBatchTracked(item)) {
    const picked = batchSummary(line, adjusted);
    if (picked.count === 0) {
      return {
        field: 'batches',
        message: `${item.name}: ${adjusted > 0 ? 'add' : 'select'} the ${words.batches}.`,
      };
    }
    if (Math.abs(picked.total - magnitude) > QTY_EPSILON) {
      return {
        field: 'batches',
        message: `${item.name}: ${words.batches} add up to ${picked.total}, not ${magnitude}.`,
      };
    }
  }
  return null;
}

/** The line as the API takes it. */
export function toLinePayload(
  line: LineDraft,
  item: AdjustableItem,
  available: number,
): AdjustmentLinePayload {
  const adjusted = adjustedOf(line, available);
  let batches: AdjustmentBatchPayload[] | undefined;
  if (isBatchTracked(item)) {
    if (adjusted > 0) {
      batches = line.inBatches.map((batch) => ({
        batchId: batch.batchId || undefined,
        supplierBatchRef: batch.supplierBatchRef || undefined,
        manufacturerBatch: batch.manufacturerBatch || undefined,
        manufacturedDate: batch.manufacturedDate ? String(batch.manufacturedDate) : undefined,
        expiryDate: batch.expiryDate ? String(batch.expiryDate) : undefined,
        mrp: batch.mrp === null || batch.mrp === undefined ? undefined : Number(batch.mrp),
        sellingPrice:
          batch.sellingPrice === null || batch.sellingPrice === undefined
            ? undefined
            : Number(batch.sellingPrice),
        quantity: Number(batch.quantity),
        units: batch.units?.map((unit) => ({
          batchUnitId: unit.batchUnitId || undefined,
          label: unit.label || undefined,
          quantity: Number(unit.quantity),
        })),
      }));
    } else if (hasSelection(line)) {
      batches = Object.values(line.outSelection).map((row) => ({
        batchId: row.batch.batchId,
        batchUnitId: row.unit?.batchUnitId ?? null,
        quantity: row.qty,
      }));
    } else {
      batches = line.outSaved.map((row) => ({
        batchId: row.batchId,
        batchUnitId: row.batchUnitId ?? null,
        quantity: row.quantity,
      }));
    }
  }
  return {
    itemId: item.id,
    quantityAdjusted: adjusted,
    costPrice: adjusted > 0 && line.costPrice.trim() !== '' ? numberOf(line.costPrice) : null,
    batches,
  };
}

/**
 * A VALUE line reuses the same two boxes — "New Value" and "Adjusted Value" —
 * with the current value standing where the quantity available stands.
 */
export function valueProblem(
  line: LineDraft,
  item: AdjustableItem,
  current: { qty: number; value: number },
): { field: 'value'; message: string } | null {
  const change = adjustedOf(line, current.value);
  if (Math.abs(change) < 0.005) {
    return { field: 'value', message: `${item.name}: enter a value to adjust.` };
  }
  if (current.qty <= QTY_EPSILON) {
    return { field: 'value', message: `${item.name}: no stock here to change the value of.` };
  }
  if (change < 0 && -change > current.value + 0.005) {
    return {
      field: 'value',
      message: `${item.name}: at most ${current.value.toFixed(2)} can be taken off.`,
    };
  }
  return null;
}

export const toValueLinePayload = (
  line: LineDraft,
  item: AdjustableItem,
  currentValue: number,
): AdjustmentLinePayload => ({
  itemId: item.id,
  valueAdjusted: adjustedOf(line, currentValue),
});

/** A saved, unposted line back into form state — for editing a draft. */
export function fromSavedLine(saved: StockAdjustmentDetailLine): LineDraft {
  if (saved.valueAdjusted !== null) {
    return {
      ...emptyLine(),
      typed: { box: 'adjusted', text: String(Number(saved.valueAdjusted)) },
    };
  }
  const quantity = Number(saved.quantityAdjusted);
  const drafts = saved.draftBatches ?? [];
  return {
    typed: { box: 'adjusted', text: String(quantity) },
    costPrice:
      saved.costPrice !== null
        ? String(Number(saved.costPrice))
        : saved.item.costPrice !== null && saved.item.costPrice !== undefined
          ? String(saved.item.costPrice)
          : '',
    inBatches: quantity > 0 ? (drafts as InitialBillBatch[]) : [],
    outSelection: {},
    outSaved: quantity < 0 ? drafts : [],
  };
}

/**
 * Turn a saved draft's decrease rows into a live selection, against what the
 * picker has just loaded. A row whose batch is no longer here is dropped — the
 * stock moved on while the draft waited, and the picker will say so by its total.
 */
export function selectionFromSaved(
  saved: readonly DraftBatch[],
  batches: readonly AvailableBatch[],
): Record<string, BatchSelection> {
  const selection: Record<string, BatchSelection> = {};
  for (const row of saved) {
    const batch = batches.find((one) => one.batchId === row.batchId);
    if (!batch) continue;
    const unit = row.batchUnitId
      ? (batch.units.find((one) => one.batchUnitId === row.batchUnitId) ?? null)
      : null;
    if (row.batchUnitId && !unit) continue;
    selection[selectionKey(batch, unit?.batchUnitId ?? null)] = { batch, unit, qty: row.quantity };
  }
  return selection;
}
