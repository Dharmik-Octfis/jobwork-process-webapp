/**
 * 🔴 THE PACKAGE RULES, STATED ONCE — for the four screens that enter a batch:
 * Bills, Opening Stock (modal AND page), and the Job Receipt allocation.
 *
 * These are not cosmetic: every label unique inside its batch, every quantity
 * positive, the total never above the batch's. Four copies of a rule is how the
 * two Bill posting paths drifted apart before they were merged, so there is one
 * copy and every screen calls it.
 *
 * 🔴 A LABEL IS OPTIONAL SINCE 2026-09-03 — only the quantity is required. Leave
 * it blank and the server names the package `#seq`, its position inside the
 * batch. Nothing about tracking depended on the label: a package's quantity and
 * its value are both `SUM` over `stock_ledger.batch_unit_id`, which is a uuid.
 * What the label buys is the match to a PHYSICAL tag, so an org that tags its
 * rolls should still type them.
 *
 * Checked here so the user is told at the row rather than by a 400 after Save —
 * but never ONLY here. Every one of these is enforced again beside the write,
 * because a dialog is not the only way a document can be posted.
 *
 * Separate from `BatchUnitsGrid.tsx` because that file exports a component and
 * Fast Refresh only works when a module exports nothing else.
 */

/** Anything under this is the same number — the tolerance every quantity
 * comparison in this codebase uses, so `3 × 33.3333` is not rejected for being a
 * billionth off. */
export const QTY_EPSILON = 0.00005;

export interface BatchUnitRow {
  /** Local key. Where the row came back from the server this is its real
   * `batch_units.id`; the call site tracks which is which. */
  id: string;
  label: string;
  quantity: string;
  /**
   * 🔴 Set on an "Existing {unit}" row: the `batch_units.id` being TOPPED UP,
   * rather than a package being named for the first time. Exactly the New/Existing
   * split the batch row above it has, and for the same reason — a label is a
   * physical tag, so re-typing one that exists is a duplicate, never an addition
   * to that roll. `label` is filled in from the picked package for display only;
   * the server reads the id.
   */
  batchUnitId?: string | null;
}

/** An existing package a row may be pointed at — what the picker offers. No
 * `seq`: a label is unique inside its batch, so it identifies the package on its
 * own and the internal number would only be noise in the list. */
export interface ExistingBatchUnitOption {
  batchUnitId: string;
  label: string;
}

/**
 * True when the row tops up a package instead of naming a new one.
 *
 * 🔴 Tests for the FIELD, not for a value in it. A row added by "Existing {unit}"
 * starts as `''` — it is an existing-kind row whose package has not been picked
 * yet — and a truthiness test called that a NEW row, so the grid rendered a label
 * box where the dropdown belonged. `null`/`undefined` is a new row; anything
 * else, empty string included, is an existing one.
 */
export const isExistingUnit = (unit: BatchUnitRow) =>
  unit.batchUnitId !== undefined && unit.batchUnitId !== null;

/** True when an existing-kind row has actually been pointed at a package. */
export const isPickedUnit = (unit: BatchUnitRow) => Boolean(unit.batchUnitId);

/** Every row the user actually meant — an untouched blank row is not an error,
 * and an "Existing" row nobody picked into and typed nothing on is just as blank
 * as a new one with no label. */
function named(units: readonly BatchUnitRow[]): BatchUnitRow[] {
  return units.filter(
    (unit) => unit.label.trim() !== '' || unit.quantity.trim() !== '' || isPickedUnit(unit),
  );
}

/**
 * The row is worth SENDING: an "Existing" row somebody actually picked into, or a
 * new one they actually filled in.
 *
 * 🔴 One copy, called by every screen that posts packages, because it used to be
 * four inline `unit.label.trim() !== ''` tests — and when the label stopped being
 * mandatory on 2026-09-03, every one of them would have silently dropped the
 * unnamed packages the user had just typed quantities against. A dropped package
 * is not an error anywhere: the batch total still balances, so the document saves
 * and the taka is simply not there.
 *
 * A QUANTITY is what makes a new row real now. `validateBatchUnits` has already
 * refused anything half-filled by the time this runs.
 */
export function isSubmittableUnit(unit: BatchUnitRow): boolean {
  return isExistingUnit(unit)
    ? isPickedUnit(unit)
    : unit.label.trim() !== '' || parseFloat(unit.quantity) > 0;
}

export function unitsTotal(units: readonly BatchUnitRow[]): number {
  return units.reduce((sum, unit) => sum + (parseFloat(unit.quantity) || 0), 0);
}

/**
 * Returns the message to show, or null.
 *
 * 🔴 A total BELOW the batch is legal and deliberately not flagged: the rest is
 * the batch's untagged remainder, which is physically real (a delivery where only
 * some rolls carried a tag). Only MORE is impossible.
 */
export function validateBatchUnits(args: {
  units: readonly BatchUnitRow[];
  batchQty: number;
  /** How to name this batch in a message — its reference, or the word "Batch". */
  batchName: string;
  singular: string;
  plural: string;
  uomLabel?: string;
}): string | null {
  const rows = named(args.units);
  if (rows.length === 0) return null;

  for (const unit of rows) {
    // An "Existing" row is answered by picking, not typing — so it is the picker
    // that is empty. A quantity typed against no pick is a real mistake: silently
    // dropping that row on save is how a taka goes missing without a word.
    //
    // 🔴 A NEW row needs NO label (2026-09-03). Blank means "this roll carries no
    // tag of its own", and the server names it `#seq`. Only the quantity is
    // required — the one number that is physically true of every package.
    if (isExistingUnit(unit) && !isPickedUnit(unit)) {
      return `Select which ${args.singular.toLowerCase()} in ${args.batchName} this quantity is for.`;
    }
    if (!(parseFloat(unit.quantity) > 0)) {
      const name = unit.label.trim() || args.singular;
      return `${name} needs a quantity greater than zero.`;
    }
  }

  // Two rows adding to the SAME existing package is the top-up version of a
  // duplicate label: afterwards the two are indistinguishable, and the user meant
  // one number.
  const pickedIds = rows.map((unit) => unit.batchUnitId).filter(Boolean) as string[];
  const repeatedId = pickedIds.find((id, index) => pickedIds.indexOf(id) !== index);
  if (repeatedId) {
    const name =
      rows.find((unit) => unit.batchUnitId === repeatedId)?.label.trim() || args.singular;
    return (
      `${args.batchName} adds to "${name}" twice. ` +
      'Combine them into one row with the total quantity.'
    );
  }

  // New rows only: an existing one cannot collide, it IS the row it points at.
  // Blanks are skipped — two unnamed packages are not a duplicate, they are two
  // packages, and the server gives each its own `#seq`.
  const labels = rows
    .filter((unit) => !isExistingUnit(unit) && unit.label.trim() !== '')
    .map((unit) => unit.label.trim().toLowerCase());
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate) {
    return (
      `${args.batchName} has two ${args.plural.toLowerCase()} labelled "${duplicate}". ` +
      'Each label is a physical tag, so it has to be unique.'
    );
  }

  /**
   * 🔴 ONCE ANY PACKAGE IS NAMED, THE PACKAGES MUST ACCOUNT FOR THE WHOLE BATCH.
   *
   * This was an inequality until 2026-09-02 — a total below the batch was legal
   * and the difference posted as an untagged remainder. It is now an equality:
   * either the batch is broken down completely or not at all. A batch with NO
   * packages is still fine, which is what keeps every org that does not run the
   * level, and every batch received before it existed, working exactly as before.
   */
  const total = unitsTotal(rows);
  const gap = Number((args.batchQty - total).toFixed(4));
  if (Math.abs(gap) > QTY_EPSILON) {
    const uom = args.uomLabel ? ` ${args.uomLabel}` : '';
    return gap > 0
      ? `${args.batchName}: its ${args.plural.toLowerCase()} add up to ${total}${uom} of ` +
          `${args.batchQty}${uom} — ${gap}${uom} is not in any ${args.singular.toLowerCase()}.`
      : `${args.batchName}: its ${args.plural.toLowerCase()} add up to ${total}${uom}, ` +
          `which is ${-gap}${uom} more than the ${args.batchQty}${uom} the batch holds.`;
  }

  return null;
}
