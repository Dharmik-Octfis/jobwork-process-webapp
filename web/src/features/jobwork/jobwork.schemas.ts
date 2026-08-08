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
  /** Outputs only — the one that absorbs the step's cost (§9.2.1). */
  isPrimary?: boolean;
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

/**
 * Which later steps consume this output — "some goes to the next step and some
 * does not", made visible.
 *
 * An output nothing downstream takes is not an error: offcuts and finished goods
 * both end their journey here and go to the godown. The point of showing it is
 * that the OTHER case — an output somebody meant to feed onward and mistyped —
 * is invisible otherwise until the next step's lot picker turns up empty.
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
  lotTracking: z.string().optional(),
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
});

export type StepItemRowRead = z.infer<typeof stepItemRowSchema>;
