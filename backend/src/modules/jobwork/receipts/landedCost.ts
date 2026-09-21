import { Prisma } from '../../../../generated/prisma/client.ts';
import { splitByQty } from '../../../lib/splitByQty.ts';

/**
 * 🔴 THE LANDED-COST ENGINE (docs/JOBWORK_LANDED_COST_PLAN.md §3, R1–R7, and
 * docs/JOBWORK_CHALLAN_CLOSURE_PLAN.md §3, R10–R14) — pure
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
  /** Share of the input's material, in % (R1b). Null where shares do not apply. */
  sharePct?: Prisma.Decimal | null;
}

/**
 * 🔴 R1b — WHICH OUTPUTS SPLIT THE INPUT BY SHARE (2026-09-18).
 *
 * On a step with ONE input and two or more outputs made from it, "one unit out draws
 * one unit in" is only true when every output uses the input evenly. 91 m of plain
 * cloth and 1 m of a nine-layer item both come off 100 m, and splitting by quantity
 * charged the plain cloth 98.9 m. So each output states its share of the material,
 * and — because a share is a fraction of the input rather than a quantity — outputs
 * in different units can sit on one step (V3 went with this).
 *
 * The leftover pass-through (R1a) is not one of them: it comes back 1:1, and the
 * shares split what is left. Returns the outputs that take a share, or none.
 */
export function shareSplitOutputs<T extends { itemId: string }>(
  inputItemIds: readonly string[],
  outputs: readonly T[],
): T[] {
  const inputs = new Set(inputItemIds);
  if (inputs.size !== 1) return [];
  const products = outputs.filter((row) => !inputs.has(row.itemId));
  return products.length >= 2 ? products : [];
}

/** R1b applies to this plan: the split exists and every output in it has a share.
 * A step planned before shares existed has none, and keeps splitting by quantity. */
function sharesApply(plan: CostPlan): boolean {
  const split = shareSplitOutputs(
    plan.inputs.map((row) => row.itemId),
    plan.outputs,
  );
  return split.length > 0 && split.every((row) => row.sharePct != null);
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
 *   · a share-split step (R1b): share ÷ expected, so Σ expected × w is Σ shares and
 *     each output draws its share of the plan whatever its unit;
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
  if (planned && sharesApply(plan)) {
    if (!inputIds.has(inputItemId) || !planned.expectedQty?.greaterThan(0)) return ZERO;
    return planned.sharePct!.dividedBy(planned.expectedQty);
  }
  if (planned && planned.components.length > 0) {
    return (
      planned.components.find((row) => row.componentItemId === inputItemId)?.qtyPerUnit ?? ZERO
    );
  }
  return inputIds.size === 1 && inputIds.has(inputItemId) ? ONE : ZERO;
}

/**
 * 🔴 R1a — LEFTOVER COMES BACK 1:1 (2026-09-18).
 *
 * A pass-through output returned BESIDE something else made from the same input is
 * unused material: fabric sent for shirts, 40 m of it back untouched. Spreading the
 * plan's loss over it valued 40 m returned as 42.1 m used, and that loss belongs to
 * the shirts. So it draws exactly what comes back, and the plan ratio for the other
 * outputs is worked out on what is left: `(planned − leftover expected) ÷ Σ others`.
 *
 * A pass-through on its own — washing fabric, fabric back — is not leftover: the
 * step's shrinkage is its own and stays in the ratio. Returns the leftover's
 * expected quantity, or null when the input has none.
 */
function leftoverExpected(plan: CostPlan, inputItemId: string): Prisma.Decimal | null {
  const passThrough = plan.outputs.find((row) => row.itemId === inputItemId);
  if (!passThrough?.expectedQty || passThrough.expectedQty.lessThanOrEqualTo(0)) return null;
  const drawnElsewhere = plan.outputs.some(
    (row) =>
      row.itemId !== inputItemId &&
      drawPerUnit(plan, row.itemId, inputItemId, false).greaterThan(0),
  );
  return drawnElsewhere ? passThrough.expectedQty : null;
}

/**
 * R2 + R3 — what each returned row needs of each input:
 * `(accepted + rework) × w × planned ÷ Σ(expected × w)`, to 4 dp — except a
 * leftover pass-through, which needs exactly what came back (R1a).
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
    let leftover: Prisma.Decimal | null = null;
    if (!rework) {
      planned = plan.inputs.find((row) => row.itemId === inputItemId)?.plannedQty ?? null;
      if (!planned || planned.lessThanOrEqualTo(0)) continue;
      const weighted = (row: CostPlanOutput) =>
        (row.expectedQty ?? ZERO).times(drawPerUnit(plan, row.itemId, inputItemId, false));
      const all = plan.outputs.reduce((sum, row) => sum.plus(weighted(row)), ZERO);
      const others = plan.outputs
        .filter((row) => row.itemId !== inputItemId)
        .reduce((sum, row) => sum.plus(weighted(row)), ZERO);

      leftover = leftoverExpected(plan, inputItemId);
      // A leftover that leaves nothing for the rest is an incoherent plan; cost it
      // the plain way rather than divide by nothing.
      if (leftover && planned.minus(leftover).lessThanOrEqualTo(0)) leftover = null;
      if (leftover) {
        planned = planned.minus(leftover);
        denominator = others;
      } else {
        denominator = all;
      }
      if (denominator.lessThanOrEqualTo(0)) continue;
    }

    const byOutput = new Map<string, Prisma.Decimal>();
    for (const row of returned) {
      const draw = drawPerUnit(plan, row.itemId, inputItemId, rework);
      const units = row.acceptedQty.plus(row.reworkQty);
      if (draw.lessThanOrEqualTo(0) || units.lessThanOrEqualTo(0)) continue;
      const need =
        rework || (leftover && row.itemId === inputItemId)
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
  /** Typed below what closing a challan consumes — the caller refuses these (R11). */
  belowFloor: string[];
  /** On a closed challan, but nothing on the receipt draws on it — refused (R13). */
  closedUndrawn: string[];
}

/**
 * R4 + R11 — how much of each input this receipt uses: the typed figure where one
 * was given, otherwise the need capped at what is still outstanding.
 *
 * `closedFloor` is what the challans this receipt closes still hold, per item
 * (challan-closure R11). Closing one consumes all of it, so it is a floor under
 * both branches: `min(max(need, floor), outstanding)`. The floor never warns —
 * it is a decision, not a surprise.
 */
export function usedByItem(
  needs: NeedTable,
  inputItemIds: readonly string[],
  typed: ReadonlyMap<string, Prisma.Decimal>,
  outstanding: ReadonlyMap<string, Prisma.Decimal>,
  closedFloor: ReadonlyMap<string, Prisma.Decimal> = new Map(),
): UsedResult {
  const used = new Map<string, Prisma.Decimal>();
  const capped: string[] = [];
  const undrawn: string[] = [];
  const belowFloor: string[] = [];
  const closedUndrawn: string[] = [];
  for (const itemId of new Set(inputItemIds)) {
    const need = [...(needs.get(itemId)?.values() ?? [])].reduce((sum, n) => sum.plus(n), ZERO);
    const floor = closedFloor.get(itemId) ?? ZERO;
    if (floor.greaterThan(0) && need.lessThanOrEqualTo(0)) closedUndrawn.push(itemId);
    const typedQty = typed.get(itemId);
    if (typedQty !== undefined) {
      used.set(itemId, typedQty);
      if (typedQty.greaterThan(0) && need.lessThanOrEqualTo(0)) undrawn.push(itemId);
      if (typedQty.lessThan(floor)) belowFloor.push(itemId);
      continue;
    }
    const out = outstanding.get(itemId) ?? ZERO;
    used.set(itemId, Prisma.Decimal.min(Prisma.Decimal.max(need, floor), out));
    if (need.minus(out).greaterThan(CAP_NOISE)) capped.push(itemId);
  }
  return { used, capped, undrawn, belowFloor, closedUndrawn };
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
