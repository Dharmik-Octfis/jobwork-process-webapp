import { z } from 'zod';

/**
 * Shapes and labels shared across the four jobwork document modules.
 *
 * Mirrors the backend's `jobwork.types.ts`. The two lists are kept in step by
 * hand — the same arrangement `processes.schemas.ts` already has for
 * `RATE_BASES` — because the alternative is generating types from OpenAPI, which
 * this codebase does not do.
 */

/** Prisma serialises Decimal as a STRING over JSON. A `z.number()` here would
 * reject "4850.0000" and blank the field it was meant to render. */
export const decimalString = z.union([z.string(), z.number()]).nullable();

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** Quantities render at up to 4 places but never with trailing zeros — "4850",
 * not "4850.0000", which reads as false precision on a shop-floor screen. */
export function formatQty(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : '0';
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
  issued: { label: 'Out', color: '#1d4ed8', bg: '#eff6ff' },
  partially_received: { label: 'Partly back', color: '#7c3aed', bg: '#f5f3ff' },
  closed: { label: 'Closed', color: '#15803d', bg: '#f0fdf4' },
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
  /** Inputs, job orders only. Blank falls through to the step's — fabric at 3%
   * beside thread at 25%, because small quantities vary more. */
  tolerancePct?: number | null;
  /** Outputs, job orders only. */
  expectedQty?: number | null;
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

/** What the form sends for one planned batch. A row is a batch AT A LOCATION. */
export interface PlannedBatchWrite {
  batchId: string;
  locationId: string;
  qty: number;
}

export interface StepGridRow {
  processId: string;
  processorType?: string;
  processorId?: string | null;
  workCentreLocationId?: string | null;
  rate?: number | null;
  rateBasis?: string | null;
  /** 🔴 What the step consumes and what it produces (§5.7). */
  inputs?: StepItemRow[];
  outputs?: StepItemRow[];
  expectedYield?: number | null;
  tolerancePct?: number | null;
  /** Job orders only — a template has no quantity to plan. */
  plannedInputQty?: number | null;
  remarks?: string | null;
}

export const emptyStep = (): StepGridRow => ({
  processId: '',
  processorType: 'vendor',
  processorId: null,
  workCentreLocationId: null,
  rate: null,
  rateBasis: null,
  inputs: [],
  outputs: [],
  expectedYield: null,
  tolerancePct: null,
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

/**
 * 🔴 WHICH OUTPUT CARRIES THE STEP'S COST — the client's copy of the server's
 * `flagPrimaryOutput` (§9.2.1).
 *
 * The grid stopped asking: a radio decided nothing in the common case (one item
 * back) and was one more thing to get wrong in the uncommon one — the same call
 * `ReceiveDialog` already made for its returned rows. So the rule is the
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
 * Shown as a grey placeholder rather than written into the row, for the same
 * reason as the tolerance one: a value copied in freezes, and nothing could then
 * tell it apart from a number somebody typed on purpose.
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
 * silently hides the rest — which is exactly what the `job_issues.item_id` and
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
  /** Inputs only — blank falls through to the step's. */
  tolerancePct: decimalString.optional(),
  expectedQty: decimalString.optional(),
  fromStock: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  item: itemRefSchema.nullable().optional(),
  uom: uomRefSchema.nullable().optional(),
  /** Inputs only. Hydrated with the batch's label and godown so the grid can render
   * a saved plan without a second round trip. */
  plannedBatches: z.array(plannedBatchReadSchema).default([]),
});

export type StepItemRowRead = z.infer<typeof stepItemRowSchema>;
