import { Prisma } from '../../../../generated/prisma/client.ts';
import { splitByQty } from '../../../lib/splitByQty.ts';

/**
 * 🔴 THE LANDED-COST ENGINE (docs/JOBWORK_LANDED_COST_PLAN.md §3, R1–R7) — pure
 * arithmetic, no database. `jobReceipts.service.ts` feeds it the step's frozen
 * plan and what came back, and posts what it returns.
 *
 * Every receipt's cost is final the moment it posts: material is drawn by the
 * ratio the job order's own plan states (planned input against expected output),
 * the charge is the output's rate on what was accepted, and whatever the plan did
 * not account for stays at the processor until the step is completed.
 */

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const QTY_DP = 4;
const VALUE_DP = 4;
/** A cap smaller than this is rounding, not a processor who wasted less (R4). */
const CAP_NOISE = new Prisma.Decimal('0.001');

export interface CostPlanInput {
  itemId: string;
  plannedQty: Prisma.Decimal | null;
}

export interface CostPlanOutput {
  itemId: string;
  expectedQty: Prisma.Decimal | null;
  /** The recipe frozen onto the step (§5.2); empty for a plain item. */
  components: readonly { componentItemId: string; qtyPerUnit: Prisma.Decimal }[];
}

export interface CostPlan {
  inputs: readonly CostPlanInput[];
  outputs: readonly CostPlanOutput[];
}

export interface ReturnedQty {
  itemId: string;
  acceptedQty: Prisma.Decimal;
  reworkQty: Prisma.Decimal;
}

/** need[inputItemId][outputItemId], only where it is above zero. */
export type NeedTable = Map<string, Map<string, Prisma.Decimal>>;

/**
 * R1 — how much of an input one unit of an output draws.
 *
 *   · rework: the output item itself, 1 for 1;
 *   · an output that is one of the inputs passes straight through (V1/V2 exempt);
 *   · a composite: its recipe quantity;
 *   · a plain output of a single-input step: 1, whatever the units — the plan
 *     ratio carries any conversion (D9).
 */
export function drawPerUnit(
  plan: CostPlan,
  outputItemId: string,
  inputItemId: string,
  rework: boolean,
): Prisma.Decimal {
  if (rework) return outputItemId === inputItemId ? ONE : ZERO;
  const inputIds = new Set(plan.inputs.map((row) => row.itemId));
  if (inputIds.has(outputItemId)) return outputItemId === inputItemId ? ONE : ZERO;
  const planned = plan.outputs.find((row) => row.itemId === outputItemId);
  if (planned && planned.components.length > 0) {
    return (
      planned.components.find((row) => row.componentItemId === inputItemId)?.qtyPerUnit ?? ZERO
    );
  }
  return inputIds.size === 1 && inputIds.has(inputItemId) ? ONE : ZERO;
}

/**
 * R2 + R3 — what each returned row needs of each input:
 * `(accepted + rework) × w × planned ÷ Σ(expected × w)`, to 4 dp.
 *
 * 🔴 The plan ratio is never rounded on its own. Rounding k to six places first
 * leaves 0.0002 m of dust per receipt, which completion then books as loss.
 * Rework has no plan of its own, so k = 1 (R2).
 */
export function needTable(
  plan: CostPlan,
  inputItemIds: readonly string[],
  returned: readonly ReturnedQty[],
  rework: boolean,
): NeedTable {
  const table: NeedTable = new Map();
  for (const inputItemId of new Set(inputItemIds)) {
    let planned: Prisma.Decimal | null = null;
    let denominator: Prisma.Decimal | null = null;
    if (!rework) {
      planned = plan.inputs.find((row) => row.itemId === inputItemId)?.plannedQty ?? null;
      denominator = plan.outputs.reduce(
        (sum, row) =>
          sum.plus(
            (row.expectedQty ?? ZERO).times(drawPerUnit(plan, row.itemId, inputItemId, false)),
          ),
        ZERO,
      );
      if (!planned || planned.lessThanOrEqualTo(0) || denominator.lessThanOrEqualTo(0)) continue;
    }

    const byOutput = new Map<string, Prisma.Decimal>();
    for (const row of returned) {
      const draw = drawPerUnit(plan, row.itemId, inputItemId, rework);
      const units = row.acceptedQty.plus(row.reworkQty);
      if (draw.lessThanOrEqualTo(0) || units.lessThanOrEqualTo(0)) continue;
      const need = rework
        ? units.times(draw)
        : units.times(draw).times(planned!).dividedBy(denominator!);
      const rounded = need.toDecimalPlaces(QTY_DP);
      if (rounded.greaterThan(0)) byOutput.set(row.itemId, rounded);
    }
    if (byOutput.size > 0) table.set(inputItemId, byOutput);
  }
  return table;
}

export interface UsedResult {
  used: Map<string, Prisma.Decimal>;
  /** Calculated above what is outstanding — a warning, never a refusal (R4). */
  capped: string[];
  /** Typed, but nothing on the receipt draws on it — the caller refuses these. */
  undrawn: string[];
}

/**
 * R4 — how much of each input this receipt uses: the typed figure where one was
 * given, otherwise the need capped at what is still outstanding.
 */
export function usedByItem(
  needs: NeedTable,
  inputItemIds: readonly string[],
  typed: ReadonlyMap<string, Prisma.Decimal>,
  outstanding: ReadonlyMap<string, Prisma.Decimal>,
): UsedResult {
  const used = new Map<string, Prisma.Decimal>();
  const capped: string[] = [];
  const undrawn: string[] = [];
  for (const itemId of new Set(inputItemIds)) {
    const need = [...(needs.get(itemId)?.values() ?? [])].reduce((sum, n) => sum.plus(n), ZERO);
    const typedQty = typed.get(itemId);
    if (typedQty !== undefined) {
      used.set(itemId, typedQty);
      if (typedQty.greaterThan(0) && need.lessThanOrEqualTo(0)) undrawn.push(itemId);
      continue;
    }
    const out = outstanding.get(itemId) ?? ZERO;
    used.set(itemId, Prisma.Decimal.min(need, out));
    if (need.minus(out).greaterThan(CAP_NOISE)) capped.push(itemId);
  }
  return { used, capped, undrawn };
}

/**
 * R5 — each input's consumed value split across the rows that draw on it, in
 * proportion to their need, through `splitByQty` so no paisa goes missing. One
 * item, one unit, so the ratio is legitimate.
 */
export function materialByOutput(
  needs: NeedTable,
  consumedValueByItem: ReadonlyMap<string, Prisma.Decimal>,
): Map<string, Prisma.Decimal> {
  const material = new Map<string, Prisma.Decimal>();
  for (const [inputItemId, byOutput] of needs) {
    const value = consumedValueByItem.get(inputItemId) ?? ZERO;
    const outputIds = [...byOutput.keys()];
    const shares = splitByQty(value, [...byOutput.values()]);
    for (const [index, outputId] of outputIds.entries()) {
      material.set(outputId, (material.get(outputId) ?? ZERO).plus(shares[index] ?? ZERO));
    }
  }
  return material;
}

/**
 * R6 + R7 — one returned row's value. The charge is the rate on the ACCEPTED
 * quantity only (D2); accepted and rework split the material by quantity, and the
 * charge lands on the accepted side, so a rework piece is charged once — on the
 * receipt where it is finally accepted. `null` rate = not agreed = ₹0.
 */
export function outputValues(
  material: Prisma.Decimal,
  rate: Prisma.Decimal | null,
  acceptedQty: Prisma.Decimal,
  reworkQty: Prisma.Decimal,
) {
  const charge = (rate ?? ZERO).times(acceptedQty).toDecimalPlaces(VALUE_DP);
  const [materialAccepted, materialRework] = splitByQty(material, [acceptedQty, reworkQty]) as [
    Prisma.Decimal,
    Prisma.Decimal,
  ];
  return {
    charge,
    acceptedValue: materialAccepted.plus(charge),
    reworkValue: materialRework,
  };
}
