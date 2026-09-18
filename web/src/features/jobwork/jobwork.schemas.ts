import { z } from 'zod';

/**
 * Shapes and labels shared across the four jobwork document modules.
 *
 * Mirrors the backend's `jobwork.types.ts`. The two are kept in step by hand,
 * because the alternative is generating types from OpenAPI, which this codebase
 * does not do.
 */

/** Prisma serialises Decimal as a STRING over JSON. A `z.number()` here would
 * reject "4850.0000" and blank the field it was meant to render. */
export const decimalString = z.union([z.string(), z.number()]).nullable();

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** Quantities render at up to 2 places but never with trailing zeros — "4850",
 * not "4850.00", which reads as false precision on a shop-floor screen. */
export function formatQty(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : '0';
}

/**
 * "100 m", or just "100" when the item has no unit to name.
 *
 * A unit is genuinely optional — an untracked item may have none — and the
 * template that reads `${qty} ${unit}` renders a double space for it, which looks
 * like a rendering fault on every screen that shows a quantity.
 */
export function qtyWithUnit(
  value: string | number | null | undefined,
  unit: string | null | undefined,
): string {
  return unit ? `${formatQty(value)} ${unit}` : formatQty(value);
}

/** ₹ to two places, Indian digit grouping — "₹11,263.16". */
export function formatMoney(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return `₹${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole days between a past date and now, floored. Negative dates read as 0. */
export function daysSince(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

export const PROCESSOR_TYPE_OPTIONS = [
  { value: 'vendor', label: 'Vendor (jobworker)' },
  { value: 'customer', label: 'Customer' },
  { value: 'internal', label: 'In-house' },
] as const;

export function processorTypeLabel(value: string | null | undefined): string {
  return PROCESSOR_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
}

export const OWNERSHIP_OPTIONS = [
  { value: 'own', label: 'Ours' },
  { value: 'customer', label: 'Customer’s (inward jobwork)' },
] as const;

/**
 * Status labels and the colour each carries.
 *
 * The colours are load-bearing on a queue screen: `draft` is grey because
 * nothing has physically happened yet, `in_progress` blue because material is
 * out with someone, `short_closed` amber because it finished and the numbers did
 * not balance — which is a normal outcome, not an error, so it is not red.
 *
 * The keys are snake_case because they are DATABASE VALUES, not identifiers —
 * they have to match `job_orders.status` exactly, so camelCasing them would
 * simply make every lookup miss. Same call `AppLayout`'s `ICON_MAP` makes.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const JOB_ORDER_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#475569', bg: '#f1f5f9' },
  in_progress: { label: 'In Progress', color: '#1d4ed8', bg: '#eff6ff' },
  completed: { label: 'Completed', color: '#15803d', bg: '#f0fdf4' },
  short_closed: { label: 'Closed Short', color: '#b45309', bg: '#fffbeb' },
  cancelled: { label: 'Cancelled', color: '#b91c1c', bg: '#fef2f2' },
};

export const STEP_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Not started', color: '#475569', bg: '#f1f5f9' },
  issued: { label: 'At processor', color: '#1d4ed8', bg: '#eff6ff' },
  partially_received: { label: 'Partly back', color: '#7c3aed', bg: '#f5f3ff' },
  completed: { label: 'Complete', color: '#15803d', bg: '#f0fdf4' },
  short_closed: { label: 'Closed short', color: '#b45309', bg: '#fffbeb' },
};

export const ISSUE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  // Grey, and the same grey a draft job order uses — a draft is the one status
  // here that describes paperwork rather than goods, so it must not read as a
  // stage of the material's journey.
  draft: { label: 'Draft', color: '#475569', bg: '#f1f5f9' },
  issued: { label: 'Out', color: '#1d4ed8', bg: '#eff6ff' },
  cancelled: { label: 'Cancelled', color: '#b91c1c', bg: '#fef2f2' },
  /**
   * 🔴 `partially_received` and `closed` were removed on 2026-09-07 with challan
   * closing itself — a challan is parked, out, or withdrawn. How much of it has
   * come back is a ledger question, answered per batch at the processor's own
   * location, and a status column was always a coarser answer to it.
   *
   * `statusMeta` falls back to the raw value, so a row somewhere that still holds
   * one of the old strings renders as itself rather than blank.
   */
};

/**
 * Receipts. This map is new: the two lists used to render `status === 'cancelled'
 * ? 'Cancelled' : 'Posted'` inline, in three places, and a third status made all
 * three quietly label a draft "Posted" — which is the exact opposite of what it
 * is. A map means a fourth status is a line here rather than a bug there.
 */
export const RECEIPT_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#475569', bg: '#f1f5f9' },
  posted: { label: 'Posted', color: '#15803d', bg: '#f0fdf4' },
  cancelled: { label: 'Cancelled', color: '#b91c1c', bg: '#fef2f2' },
};

/* eslint-enable @typescript-eslint/naming-convention */

export const RESPONSIBILITY_OPTIONS = [
  { value: 'ours', label: 'Ours' },
  { value: 'theirs', label: 'Theirs' },
] as const;

/**
 * A blank steps-grid row. It lives here rather than beside the grid component so
 * that file exports only components — which is what keeps Vite's fast refresh
 * working for it (`react-refresh/only-export-components`).
 */
/**
 * 🔴 ONE ITEM A STEP CONSUMES OR PRODUCES (domain §5.7).
 *
 * A step takes a SET of items and returns a SET of items, and the two sets have
 * nothing to do with each other in length or in unit: stitching consumes panels,
 * thread and buttons and returns shirts and rejects. Seven items in and one out
 * is as normal as one in and ten out.
 *
 * `plannedQty` is meaningful on an input, `expectedQty` and `isPrimary` on an
 * output. One shape carries all four because the two grids are the same control
 * with different columns, and splitting them would mean two copies of the add /
 * remove / keyboard handling.
 */
export interface StepItemRow {
  itemId: string;
  uomId?: string | null;
  /** Inputs, job orders only. */
  plannedQty?: number | null;
  /** Inputs, job orders only. Copied from the item when it is picked; a blank row
   * is filled with the item's default on save (landed-cost plan D10). */
  tolerancePct?: number | null;
  /** Outputs, job orders only. */
  expectedQty?: number | null;
  /** Outputs — charge per accepted unit, on routes and job orders (D1). */
  rate?: number | null;
  /** Outputs, job orders only — share of the input's material, in % (R1b). Only
   * asked on a step `shareSplitRows` picks out; never defaulted. */
  sharePct?: number | null;
  /** Outputs only — the one that absorbs the step's cost (§9.2.1). No longer
   * asked for on the grid; see `primaryOutputIndex`. */
  isPrimary?: boolean;
  /**
   * Inputs, job orders only. Which batches the planner means this row to come out
   * of — a NOTE, not a reservation: nothing is held back and two orders may name
   * the same batch. The server refuses a set that does not add up to `plannedQty`.
   */
  plannedBatches?: PlannedBatchWrite[];
}

/** What the form sends for one planned batch. A row is a batch AT A LOCATION —
 * and, once the org runs a unit level, optionally ONE PACKAGE of it. */
export interface PlannedBatchWrite {
  batchId: string;
  /** Which roll the planner meant, when they ticked one. Null is the batch
   * generally, which is what every plan meant before the level existed. */
  batchUnitId?: string | null;
  locationId: string;
  qty: number;
}

export interface StepGridRow {
  processId: string;
  processorType?: string;
  processorId?: string | null;
  workCentreLocationId?: string | null;
  /** 🔴 What the step consumes and what it produces (§5.7). */
  inputs?: StepItemRow[];
  outputs?: StepItemRow[];
  expectedYield?: number | null;
  /** Job orders only — a template has no quantity to plan. */
  plannedInputQty?: number | null;
  remarks?: string | null;
}

export const emptyStep = (): StepGridRow => ({
  processId: '',
  processorType: 'vendor',
  processorId: null,
  workCentreLocationId: null,
  inputs: [emptyStepItem()],
  outputs: [emptyStepItem()],
  expectedYield: null,
  plannedInputQty: null,
  remarks: null,
});

/** A blank row on either grid. */
export const emptyStepItem = (): StepItemRow => ({
  itemId: '',
  uomId: null,
  plannedQty: null,
  tolerancePct: null,
  expectedQty: null,
  isPrimary: false,
});

/**
 * 🔴 WHERE EACH INPUT COMES FROM — the client's copy of `classifyStepInputs`
 * (§6.4), for labelling only.
 *
 * The server computes and stores this at save; this is the same answer rendered
 * live while somebody types, so reordering a step visibly changes what feeds it
 * instead of silently changing it on save.
 *
 * Returns the 1-based seq of the nearest EARLIER step that produces the item, or
 * `null` when nothing above it does — which means it is drawn from stock, and is
 * a label rather than a problem: thread comes from the godown, not from the
 * operation above.
 */
export function producedByStep(steps: readonly StepGridRow[], index: number, itemId: string) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if ((steps[i]?.outputs ?? []).some((row) => row.itemId === itemId)) return i + 1;
  }
  return null;
}

/** Quantities are stored at four decimal places, so the balance below is compared
 * there too — float subtraction drifts (100 − 33.3 − 33.3 ≠ 33.4) and a warning
 * raised over a rounding error nobody typed is a warning people learn to ignore. */
const roundQty = (qty: number) => Math.round(qty * 10_000) / 10_000;

/**
 * 🔴 HOW MUCH OF AN ITEM THE STEPS ABOVE STILL HAVE TO GIVE — the client's copy
 * of the balance `planQuantities` walks (§6.4.0).
 *
 * `null` means there is no ceiling to speak of, and it covers two different
 * cases on purpose: nothing above produces the item (it comes from stock, and
 * how much thread exists is not this document's business), or a step above does
 * produce it but left its expected quantity blank — a limit read off a number
 * nobody supplied is a limit this code invented.
 *
 * A step's own inputs are settled BEFORE its outputs are added, because a step
 * does not feed itself: a process that returns what it took would otherwise
 * double its own output.
 */
export function spareFromEarlierSteps(
  steps: readonly StepGridRow[],
  index: number,
  itemId: string,
  /** What the steps ALREADY on the order have left over. Append dialog only. */
  priorSpare?: ReadonlyMap<string, number>,
): number | null {
  let spare = priorSpare?.get(itemId) ?? null;

  for (let i = 0; i < index; i += 1) {
    const step = steps[i];
    if (!step) continue;

    for (const row of step.inputs ?? []) {
      // `spare === null` is a from-stock row: it takes nothing from the chain,
      // so it deducts nothing — the same call the server makes on `fromStock`.
      if (row.itemId !== itemId || spare === null) continue;
      // A blank chain-fed box is not "nothing": the server plans it at whatever
      // is left, so mirroring anything else would show a ceiling that is already
      // spoken for.
      const taken = row.plannedQty ?? (spare > 0 ? spare : null);
      if (taken !== null) spare = roundQty(spare - taken);
    }
    for (const row of step.outputs ?? []) {
      if (row.itemId !== itemId || row.expectedQty === null || row.expectedQty === undefined) {
        continue;
      }
      spare = roundQty((spare ?? 0) + row.expectedQty);
    }
  }
  return spare;
}

/**
 * 🔴 A NOTE, NOT A REFUSAL (§6.4.0).
 *
 * Planning more of an item than the steps above return is usually a typo and
 * occasionally the plan: cutting sends back 90 panels and stitching runs 120,
 * because 30 are already in the godown from a short-closed order. The server
 * refused this for one afternoon on 2026-08-11 and the refusal was wrong for
 * exactly that case — a row's supply is a MIX, and `fromStock` is one flag.
 *
 * So it is said, not enforced, and it is said HERE rather than in a save
 * response: a warning that only arrives after a successful save is a warning
 * about a decision already made.
 */
export function overPlanWarning(
  steps: readonly StepGridRow[],
  index: number,
  row: StepItemRow,
  priorSpare?: ReadonlyMap<string, number>,
): string | null {
  if (!row.itemId || row.plannedQty === null || row.plannedQty === undefined) return null;
  const spare = spareFromEarlierSteps(steps, index, row.itemId, priorSpare);
  if (spare === null || roundQty(row.plannedQty) <= roundQty(spare)) return null;
  return `Only ${formatQty(Math.max(spare, 0))} comes back from the steps above — the rest has to come from stock.`;
}

/** One side of a step's plan, in numbers — grid rows and saved rows both map to it. */
export interface PlanInputRow {
  itemId: string;
  uomId?: string | null;
  plannedQty?: number | null;
}
export interface PlanOutputRow {
  itemId: string;
  uomId?: string | null;
  expectedQty?: number | null;
  sharePct?: number | null;
}

/**
 * 🔴 R1b — WHICH OUTPUTS SPLIT THE INPUT BY SHARE. The client's copy of the server's
 * `shareSplitOutputs` (`receipts/landedCost.ts`); keep the two in step.
 *
 * One input, and two or more outputs that are not that input coming back. The
 * leftover pass-through (R1a) takes no share. Returns the output indexes.
 */
export function shareSplitIndexes(
  inputs: readonly { itemId: string }[],
  outputs: readonly { itemId: string }[],
): Set<number> {
  const inputIds = new Set(inputs.filter((row) => row.itemId).map((row) => row.itemId));
  if (inputIds.size !== 1) return new Set();
  const products = outputs.flatMap((row, index) =>
    row.itemId && !inputIds.has(row.itemId) ? [index] : [],
  );
  return products.length >= 2 ? new Set(products) : new Set();
}

export const shareSplitRows = (step: StepGridRow) =>
  shareSplitIndexes(step.inputs ?? [], step.outputs ?? []);
/** A composite's recipe; `null` for a plain item; `undefined` while not yet known. */
export type RecipeLookup = (
  itemId: string,
) => readonly { componentItemId: string; qtyPerUnit: number }[] | null | undefined;

/**
 * 🔴 WHAT STOPS A STEP'S FIRST CHALLAN — the client's copy of the server's V4 check
 * in `jobIssues.service.ts` (landed-cost plan D11). Item ids, so each screen names
 * them its own way. Keep the two in step.
 */
export function planGaps(
  inputs: readonly PlanInputRow[],
  outputs: readonly PlanOutputRow[],
  /** The step already sent material out — a step planned before shares existed
   * keeps its old split rather than being frozen mid-run (`missingShares`). */
  sentBefore = false,
) {
  const listedOutputs = outputs.filter((row) => row.itemId);
  const split = [...shareSplitIndexes(inputs, outputs)].map((index) => outputs[index]!);
  const blankShares = split.filter((row) => row.sharePct == null);
  const legacy = sentBefore && split.length > 0 && blankShares.length === split.length;
  const shareTotal = split.reduce((sum, row) => sum + (row.sharePct ?? 0), 0);
  return {
    noShare: legacy ? [] : blankShares.map((row) => row.itemId),
    /** The total, when every share is filled and they do not make 100%. */
    shareTotalOff:
      !legacy && split.length > 0 && blankShares.length === 0 && Math.abs(shareTotal - 100) > 0.01
        ? roundQty(shareTotal)
        : null,
    noOutputs: listedOutputs.length === 0,
    noPlanned: inputs
      .filter((row) => row.itemId && !(row.plannedQty && row.plannedQty > 0))
      .map((row) => row.itemId),
    noExpected: listedOutputs
      .filter((row) => !(row.expectedQty && row.expectedQty > 0))
      .map((row) => row.itemId),
  };
}

/**
 * 🔴 THE PLAN WARNINGS (landed-cost plan §3) — said, not enforced here, keyed by the
 * INPUT item they concern. Only the last is also a server refusal.
 *
 *   · less planned in than the expected output needs — fabric does stretch;
 *   · Expected equal to Planned on a plain same-unit step — no loss is planned, so
 *     shrinkage lands as job order loss instead of inside the landed cost;
 *   · an input nothing produced is made from — the server refuses the save (V5);
 *     said here first so the row is flagged before Save is pressed.
 *
 * What an output draws from an input is R1: itself when it passes straight through,
 * its recipe quantity when it is a composite, 1 when it is a plain output of a
 * single-input step. A plain output in a different unit carries a conversion, not a
 * loss, so it is not compared. Nothing is said while any output's recipe is unknown —
 * a guess here would be a false "nothing is made from this".
 */
export function planWarnings(
  inputs: readonly PlanInputRow[],
  outputs: readonly PlanOutputRow[],
  recipeOf: RecipeLookup,
): Map<string, string> {
  const warnings = new Map<string, string>();
  const ins = inputs.filter((row) => row.itemId);
  const outs = outputs.filter((row) => row.itemId);
  if (ins.length === 0 || outs.length === 0) return warnings;
  const inputIds = new Set(ins.map((row) => row.itemId));
  if (outs.some((out) => !inputIds.has(out.itemId) && recipeOf(out.itemId) === undefined)) {
    return warnings;
  }

  const draw = (out: PlanOutputRow, inputId: string): { qty: number; plain: boolean } | null => {
    if (inputIds.has(out.itemId)) return out.itemId === inputId ? { qty: 1, plain: true } : null;
    const recipe = recipeOf(out.itemId);
    if (recipe) {
      const component = recipe.find((row) => row.componentItemId === inputId);
      return component ? { qty: component.qtyPerUnit, plain: false } : null;
    }
    return ins.length === 1 ? { qty: 1, plain: true } : null;
  };

  for (const input of ins) {
    const draws = outs
      .map((out) => ({ out, by: draw(out, input.itemId) }))
      .filter((row): row is { out: PlanOutputRow; by: { qty: number; plain: boolean } } =>
        Boolean(row.by),
      );
    if (draws.length === 0) {
      warnings.set(
        input.itemId,
        'Nothing listed as produced is made from this — remove it, or the step will not save.',
      );
      continue;
    }

    // A share-split step (R1b) states its split in %, and its outputs may be in any
    // unit — quantities are not comparable there, so nothing is said about them.
    if (shareSplitIndexes(ins, outs).size > 0) continue;
    const planned = input.plannedQty;
    if (!planned || draws.some((row) => !row.out.expectedQty)) continue;
    const comparable = draws.every(
      (row) => !row.by.plain || (row.out.uomId ?? null) === (input.uomId ?? null),
    );
    if (!comparable) continue;

    const need = roundQty(draws.reduce((sum, row) => sum + row.out.expectedQty! * row.by.qty, 0));
    if (roundQty(planned) < need) {
      warnings.set(
        input.itemId,
        `${formatQty(planned)} planned, but the expected output needs ${formatQty(need)} — fine if it stretches, otherwise check the quantities.`,
      );
    } else if (roundQty(planned) === need && draws.every((row) => row.by.plain)) {
      warnings.set(
        input.itemId,
        'Expected equals planned, so no loss is planned — any shrinkage will be booked as job order loss, not as part of the landed cost.',
      );
    }
  }
  return warnings;
}

/**
 * 🔴 THE RECEIPT COST PREVIEW — the client's copy of the server's landed-cost
 * engine (`receipts/landedCost.ts`, plan R1–R7) and of challan closure R11–R12
 * (`usedByItem`'s floor, `allocateConsumption`'s closed-first walk). Keep the two
 * in step.
 *
 * It only lets the gate see the figure before pressing Receive: the server works
 * the same thing out from what it actually posts, and that is the number stored.
 */
export interface CostPreviewPlan {
  inputs: readonly { itemId: string; plannedQty: number | null }[];
  outputs: readonly {
    itemId: string;
    expectedQty: number | null;
    components: readonly { componentItemId: string; qtyPerUnit: number }[];
    sharePct?: number | null;
  }[];
}

/** One open challan line, oldest first — the order the server allocates in. */
export interface CostPreviewLine {
  itemId: string;
  outstanding: number;
  /** The line's average cost per unit at the processor — used only when `layers` is absent. */
  unitCost: number;
  /** The line's FIFO cost layers at the processor, oldest first — what the server consumes. */
  layers?: readonly { qty: number; unitCost: number }[];
  /** On a challan this receipt closes — consumed to zero, and served first (R11–R12). */
  closed?: boolean;
}

export interface CostPreviewReturned {
  itemId: string;
  acceptedQty: number;
  reworkQty: number;
  rate: number | null;
}

export interface UsedPreview {
  outstanding: number;
  /** The plan's figure (R3), before any cap. */
  calculated: number;
  /** What the closed challans still hold of this item — used at least this (R11). */
  floor: number;
  /** What is used when nothing is typed: the calculation raised to the floor,
   * capped at what is out. */
  suggested: number;
  used: number;
  /** Material value of `used`, FIFO across the lines. */
  value: number;
  /** The calculation ran past what is out — a warning, never a refusal (R4). */
  capped: boolean;
  /** Typed above what is out — the server refuses it. */
  overOutstanding: boolean;
  /** Typed, but nothing received draws on it — the server refuses it. */
  undrawn: boolean;
  /** Typed below what closing consumes — the server refuses it (R11). */
  belowFloor: boolean;
  /** On a closed challan, but nothing received draws on it — the server refuses it (R13). */
  closedUndrawn: boolean;
}

export interface OutputCostPreview {
  material: number;
  charge: number;
  /** Material on the accepted side plus the whole charge (R7). */
  acceptedValue: number;
  perUnit: number | null;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** `splitByQty`: shares by weight, the last taking the remainder so nothing is lost. */
function splitByWeight(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return weights.map(() => 0);
  let given = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return round4(total - given);
    const share = round4((total * weight) / sum);
    given += share;
    return share;
  });
}

/** R1 — how much of an input one unit of an output draws. */
function drawPerUnit(
  plan: CostPreviewPlan,
  outputItemId: string,
  inputItemId: string,
  rework: boolean,
): number {
  if (rework) return outputItemId === inputItemId ? 1 : 0;
  const inputIds = new Set(plan.inputs.map((row) => row.itemId));
  if (inputIds.has(outputItemId)) return outputItemId === inputItemId ? 1 : 0;
  const planned = plan.outputs.find((row) => row.itemId === outputItemId);
  // R1b: share ÷ expected, so each output draws its share of the plan in any unit.
  const split = [...shareSplitIndexes(plan.inputs, plan.outputs)];
  if (planned && split.length > 0 && split.every((i) => plan.outputs[i]!.sharePct != null)) {
    if (!inputIds.has(inputItemId) || !planned.expectedQty || planned.expectedQty <= 0) return 0;
    return planned.sharePct! / planned.expectedQty;
  }
  if (planned && planned.components.length > 0) {
    return planned.components.find((row) => row.componentItemId === inputItemId)?.qtyPerUnit ?? 0;
  }
  return inputIds.size === 1 && inputIds.has(inputItemId) ? 1 : 0;
}

/** R1a — a pass-through returned beside something else made from the same input is
 * leftover, and comes back 1:1. Its expected quantity, or null. */
function leftoverExpected(plan: CostPreviewPlan, inputItemId: string): number | null {
  const passThrough = plan.outputs.find((row) => row.itemId === inputItemId);
  if (!passThrough?.expectedQty || passThrough.expectedQty <= 0) return null;
  const drawnElsewhere = plan.outputs.some(
    (row) => row.itemId !== inputItemId && drawPerUnit(plan, row.itemId, inputItemId, false) > 0,
  );
  return drawnElsewhere ? passThrough.expectedQty : null;
}

export function receiptCostPreview(input: {
  plan: CostPreviewPlan;
  rework: boolean;
  lines: readonly CostPreviewLine[];
  returned: readonly CostPreviewReturned[];
  /** Typed Used figures by item; an item absent here is calculated. */
  typed: ReadonlyMap<string, number>;
}): { used: Map<string, UsedPreview>; rows: Map<string, OutputCostPreview> } {
  const { plan, rework, lines, returned, typed } = input;

  const outstanding = new Map<string, number>();
  for (const line of lines) {
    outstanding.set(line.itemId, round4((outstanding.get(line.itemId) ?? 0) + line.outstanding));
  }

  // R2 + R3: need = (accepted + rework) × w × planned ÷ Σ(expected × w) — except a
  // leftover pass-through, which needs exactly what came back (R1a).
  const needs = new Map<string, Map<string, number>>();
  for (const inputItemId of outstanding.keys()) {
    let ratio = 1;
    let leftover: number | null = null;
    if (!rework) {
      let planned = plan.inputs.find((row) => row.itemId === inputItemId)?.plannedQty ?? 0;
      if (planned <= 0) continue;
      const weighted = (row: CostPreviewPlan['outputs'][number]) =>
        (row.expectedQty ?? 0) * drawPerUnit(plan, row.itemId, inputItemId, false);
      const all = plan.outputs.reduce((sum, row) => sum + weighted(row), 0);
      const others = plan.outputs
        .filter((row) => row.itemId !== inputItemId)
        .reduce((sum, row) => sum + weighted(row), 0);
      leftover = leftoverExpected(plan, inputItemId);
      if (leftover !== null && planned - leftover <= 0) leftover = null;
      let denominator = all;
      if (leftover !== null) {
        planned -= leftover;
        denominator = others;
      }
      if (denominator <= 0) continue;
      ratio = planned / denominator;
    }
    const byOutput = new Map<string, number>();
    for (const row of returned) {
      const draw = drawPerUnit(plan, row.itemId, inputItemId, rework);
      const units = row.acceptedQty + row.reworkQty;
      if (draw <= 0 || units <= 0) continue;
      const need = round4(
        units * draw * (leftover !== null && row.itemId === inputItemId ? 1 : ratio),
      );
      if (need > 0) byOutput.set(row.itemId, need);
    }
    if (byOutput.size > 0) needs.set(inputItemId, byOutput);
  }

  // R12: closed challans' lines first, then oldest first — a stable sort keeps both orders.
  const walk = [...lines].sort((a, b) => Number(Boolean(b.closed)) - Number(Boolean(a.closed)));

  // R4 + R5 + R11: what each input uses, what that is worth, and where the value goes.
  const used = new Map<string, UsedPreview>();
  const material = new Map<string, number>();
  for (const [itemId, out] of outstanding) {
    const byOutput = needs.get(itemId);
    const calculated = round4([...(byOutput?.values() ?? [])].reduce((sum, n) => sum + n, 0));
    const floor = round4(
      lines
        .filter((line) => line.closed && line.itemId === itemId)
        .reduce((sum, line) => sum + line.outstanding, 0),
    );
    const suggested = Math.min(Math.max(calculated, floor), out);
    const typedQty = typed.get(itemId);
    const qty = typedQty ?? suggested;

    let left = qty;
    let value = 0;
    for (const line of walk) {
      if (line.itemId !== itemId || left <= 0) continue;
      let take = Math.min(left, line.outstanding);
      left = round4(left - take);
      // FIFO within the line, exactly as the server posts it.
      for (const layer of line.layers ?? []) {
        if (take <= 0) break;
        const fromLayer = Math.min(take, layer.qty);
        value = round4(value + fromLayer * layer.unitCost);
        take = round4(take - fromLayer);
      }
      if (take > 0) value = round4(value + take * line.unitCost);
    }

    used.set(itemId, {
      outstanding: out,
      calculated,
      floor,
      suggested,
      used: qty,
      value,
      capped: typedQty === undefined && calculated - out > 0.001,
      overOutstanding: typedQty !== undefined && typedQty - out > 0.00005,
      undrawn: typedQty !== undefined && typedQty > 0 && calculated <= 0,
      belowFloor: typedQty !== undefined && floor - typedQty > 0.00005,
      closedUndrawn: floor > 0 && calculated <= 0,
    });

    if (!byOutput) continue;
    const shares = splitByWeight(value, [...byOutput.values()]);
    [...byOutput.keys()].forEach((outputItemId, index) => {
      material.set(outputItemId, round4((material.get(outputItemId) ?? 0) + (shares[index] ?? 0)));
    });
  }

  // R6 + R7: the charge is on accepted only, and lands on the accepted side.
  const rows = new Map<string, OutputCostPreview>();
  for (const row of returned) {
    const rowMaterial = material.get(row.itemId) ?? 0;
    const charge = round4((row.rate ?? 0) * row.acceptedQty);
    const [materialAccepted = 0] = splitByWeight(rowMaterial, [row.acceptedQty, row.reworkQty]);
    const acceptedValue = round4(materialAccepted + charge);
    rows.set(row.itemId, {
      material: rowMaterial,
      charge,
      acceptedValue,
      perUnit: row.acceptedQty > 0 ? acceptedValue / row.acceptedQty : null,
    });
  }
  return { used, rows };
}

/**
 * 🔴 WHERE THE STOCK IS STILL AWAY FROM US. Re-exported, not redefined: the list
 * now lives beside the `Location` type it tests (`configuration/locations`),
 * because items, purchases, inventory and settings all ask the same question.
 *
 * Jobwork uses it for the one thing a server answer cannot do — keep the option
 * off the Received-into dropdown in the first place, so nobody types a whole
 * receipt against a location the save will refuse.
 */
export { EXTERNAL_LOCATION_TYPES } from '../configuration/locations/locations.api';

/**
 * 🔴 WHICH OUTPUT CARRIES THE STEP'S COST — the client's copy of the server's
 * `flagPrimaryOutput` (§9.2.1).
 *
 * The grid stopped asking: a radio decided nothing in the common case (one item
 * back) and was one more thing to get wrong in the uncommon one — the same call
 * the Receive form already makes for its returned rows. So the rule is the
 * server's own fallback: whatever a saved row is already flagged with, and
 * otherwise the FIRST row. Read it here rather than reading `row.isPrimary`
 * directly, or the chain badge labels a step's main output "Ends here" while the
 * server feeds it onward.
 */
export function primaryOutputIndex(rows: readonly StepItemRow[]): number {
  const flagged = rows.findIndex((row) => row.isPrimary);
  return flagged >= 0 ? flagged : 0;
}

/**
 * 🔴 WHAT THE EXPECTED BOX WILL BE FILLED WITH IF IT IS LEFT BLANK — the client's
 * copy of the server's `derivedExpectedQty` (§6.3).
 *
 * Shown as a grey placeholder rather than written into the row: a value copied in
 * freezes, and nothing could then tell it apart from a number somebody typed on
 * purpose.
 *
 * `null` means the server will store nothing either, and the box is genuinely
 * asking. That happens on exactly the case worth asking about — the output's unit
 * differs from the principal input's, with no yield stated, so 4,800 M of fabric
 * has no derivable answer in PCS of panels. Every other row either says nothing
 * (a by-product) or can be assumed 1:1.
 */
export function derivedExpectedQty(
  step: StepGridRow,
  rowIndex: number,
  /** An item's stocking unit id, or null when it has none. */
  unitOf: (itemId: string | null | undefined) => string | null,
): number | null {
  const outputs = step.outputs ?? [];
  // Single-output steps only — the server's own rule (landed-cost plan §6.3).
  if (outputs.filter((row) => row.itemId).length !== 1) return null;
  if (rowIndex !== primaryOutputIndex(outputs)) return null;

  const row = outputs[rowIndex];
  const principal = (step.inputs ?? [])[0] ?? null;
  const planned = principal?.plannedQty;
  if (!row?.itemId || !principal?.itemId || planned === null || planned === undefined) return null;

  // A stated yield IS the conversion, so it answers across units too.
  if (step.expectedYield !== null && step.expectedYield !== undefined) {
    return roundQty(planned * step.expectedYield);
  }
  return unitOf(row.itemId) === unitOf(principal.itemId) ? roundQty(planned) : null;
}

/**
 * Which later steps consume this output — "some goes to the next step and some
 * does not", made visible.
 *
 * An output nothing downstream takes is not an error: offcuts and finished goods
 * both end their journey here and go to the godown. The point of showing it is
 * that the OTHER case — an output somebody meant to feed onward and mistyped —
 * is invisible otherwise until the next step's batch picker turns up empty.
 *
 * A step that lists no inputs of its own inherits the previous step's PRIMARY
 * output (the server's own fallback), so that implicit link is shown too.
 */
export function feedsSteps(
  steps: readonly StepGridRow[],
  index: number,
  itemId: string,
  isPrimary: boolean,
): number[] {
  const fed: number[] = [];
  for (let i = index + 1; i < steps.length; i += 1) {
    const inputs = steps[i]?.inputs ?? [];
    if (inputs.length === 0) {
      if (isPrimary && i === index + 1) fed.push(i + 1);
      continue;
    }
    if (inputs.some((row) => row.itemId === itemId)) fed.push(i + 1);
  }
  return fed;
}

/**
 * 🔴 NAMING A DOCUMENT THAT CARRIES SEVERAL ITEMS.
 *
 * One challan moves fabric, thread and buttons; one receipt returns shirts and
 * rejects. A list column that shows the first item alone names one of them and
 * silently hides the rest — which is exactly what the `job_issues.itemId` and
 * `job_receipts.output_item_id` header columns did before they were dropped on
 * 2026-08-12. This says how many are not being shown.
 *
 * The COUNT is the honest part. "Grey Fabric" on a three-item challan is a
 * wrong answer; "Grey Fabric +2" is a true one that still fits a column.
 */
export function itemSummary(rows: readonly { item?: { name: string } | null }[]): string {
  const names = [...new Set(rows.map((row) => row.item?.name).filter(Boolean))] as string[];
  if (names.length === 0) return '-';
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
}

/**
 * …and its unit, which only exists when every row shares one.
 *
 * A total across metres, cones and pieces is not a quantity (§6.5), so a
 * multi-unit document prints its number with no unit rather than borrowing the
 * first row's and implying the sum means something.
 */
export function sharedUnit(
  rows: readonly { uom?: { symbol?: string | null; unitName: string } | null }[],
): string {
  const units = [
    ...new Set(rows.map((row) => (row.uom ? (row.uom.symbol ?? row.uom.unitName) : null))),
  ].filter(Boolean) as string[];
  return units.length === 1 ? units[0]! : '';
}

/** Small coloured pill. One component so a status never renders two ways. */
export function statusMeta(
  map: Record<string, { label: string; color: string; bg: string }>,
  value: string | null | undefined,
) {
  return map[value ?? ''] ?? { label: value ?? '-', color: '#475569', bg: '#f1f5f9' };
}

/** Reference shapes the document endpoints include on every read. */
export const itemRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  inventoryTracking: z.string().optional(),
});

export const uomRefSchema = z.object({
  id: z.string(),
  unitName: z.string(),
  symbol: z.string().nullable().optional(),
});

export const namedRefSchema = z.object({ id: z.string(), name: z.string() });

/**
 * One row of a step's bill of materials as the server returns it (§5.7).
 *
 * `fromStock` is on the input side only and is READ-ONLY here: the server works
 * it out at save by walking the earlier steps (`classifyStepInputs`), and a
 * client that could send it could label a chain-fed input as stock and hide a
 * broken chain. `plannedQty` / `expectedQty` / `isPrimary` are likewise absent on
 * the side they mean nothing.
 */
/**
 * One planned batch as the server returns it.
 *
 * 🔴 The LABEL is `supplierBatchRef` — what is on the physical tag. `batchNumber`
 * is internal and is deliberately never sent (2026-08-14), so there is nothing to
 * fall back to and nothing to accidentally render.
 */
export const plannedBatchReadSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  /**
   * 🔴 Which package the plan named, when it named one. It was missing from this
   * schema while the WRITE shape carried it, so a planned roll survived the save
   * and then vanished on the way back — the Issue screen could not pre-fill it and
   * editing the job order wrote the plan back without it.
   */
  batchUnitId: z.string().nullable().optional(),
  locationId: z.string(),
  qty: decimalString,
  batch: z
    .object({
      id: z.string(),
      supplierBatchRef: z.string().nullable(),
      manufacturerBatch: z.string().nullable(),
    })
    .nullable()
    .optional(),
  location: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});

export type PlannedBatchRead = z.infer<typeof plannedBatchReadSchema>;

export const stepItemRowSchema = z.object({
  id: z.string(),
  seq: z.number(),
  itemId: z.string(),
  uomId: z.string().nullable(),
  plannedQty: decimalString.optional(),
  /** Inputs only — copied from the item on the job order (landed-cost plan D10). */
  tolerancePct: decimalString.optional(),
  expectedQty: decimalString.optional(),
  /** Outputs only — charge per accepted unit. */
  rate: decimalString.optional(),
  /** Outputs only — share of the input's material, in % (R1b). */
  sharePct: decimalString.optional(),
  fromStock: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  item: itemRefSchema.nullable().optional(),
  uom: uomRefSchema.nullable().optional(),
  /** Inputs only. Hydrated with the batch's label and godown so the grid can render
   * a saved plan without a second round trip. */
  plannedBatches: z.array(plannedBatchReadSchema).default([]),
  /** Outputs only, on the Overview payload — the composite's recipe frozen onto the
   * step (§5.2), which the Issue screen's plan warnings read. */
  components: z
    .array(z.object({ componentItemId: z.string(), qtyPerUnit: decimalString }))
    .default([]),
});

export type StepItemRowRead = z.infer<typeof stepItemRowSchema>;
