import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import {
  allocateNumber,
  getNumberPreference,
  reserveSuppliedNumber,
  setNumberPreference,
} from '../../../lib/numberSequence.ts';
import { getMemberDirectory, type MemberDirectory } from '../../../lib/memberDirectory.ts';
import { pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import { type Ownership } from '../../inventory/stock-ledger/stockLedger.service.ts';
import {
  assertItemsBelongToOrg,
  assertLocationsBelongToOrg,
  assertProcessesBelongToOrg,
  assertUomsBelongToOrg,
  resolveProcessorName,
} from '../jobwork.refs.ts';
import { POSTED_DOC_STATUS, runAsDocument, type ProcessorType } from '../jobwork.types.ts';
import { lockJobOrderSteps, lockStep } from '../jobwork.posting.ts';
import { writeOffStep } from './jobOrders.writeOff.ts';
import { shareSplitOutputs } from '../receipts/landedCost.ts';
import {
  getAllStepTotals,
  getChainWarnings,
  recomputeJobOrder,
  recomputeStep,
} from './jobOrders.status.ts';
import type { ItemFlow, OutputFlow, StepTotals } from './jobOrders.status.ts';
import type {
  AppendJobOrderStepsInput,
  CreateJobOrderInput,
  JobOrderStepInput,
  PlannedBatchRow,
  StepInputRow,
  StepOutputRow,
  UpdateJobOrderInput,
} from './jobOrders.schemas.ts';

/**
 * Job Orders — one run of work, and the document everything in Sprints 3 and 4
 * hangs off.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD
 *
 * 1. 🔴 Steps are a SNAPSHOT of the route, taken once (§2.4). The route is read
 *    here and never again. Editing or deleting a route afterwards cannot reach
 *    an order that is already running, which is what makes routes safe to edit.
 *
 * 2. 🔴 A step consumes a SET of items and produces a SET of items (§5.7), and
 *    the chain between them is a CLASSIFICATION, not a rule (§6.4). Each input is
 *    labelled fed-by-an-earlier-step or from-stock and saved either way; only an
 *    input produced solely by a LATER step is refused. This replaced the hard
 *    "step n's output is step n+1's input" check, which rejected thread and
 *    buttons — i.e. most real steps.
 *
 * 3. 🔴 THIS FILE NO LONGER WRITES TO THE LEDGER AT ALL. Material In was retired
 *    on 2026-08-07 (docs/PURCHASE_RECEIVED_AND_ITEMS_SPEC.md §D3) — stock comes
 *    from Purchase Received and Opening Stock. A job order is a PLAN, and until
 *    those ship there may be nothing to issue against one. That is expected.
 */

const DUPLICATE_NUMBER = 'A job order with this number already exists in this organization.';

function jobOrderListWhere(organizationId: string, opts: ListQuery): Prisma.JobOrderWhereInput {
  const baseWhere = {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.JobOrderWhereInput>('job_order', opts.filter),
  };

  if (!opts.search) return baseWhere;

  return {
    ...baseWhere,
    OR: [
      { jobOrderNumber: { contains: opts.search, mode: 'insensitive' } },
      { routeNameSnapshot: { contains: opts.search, mode: 'insensitive' } },
      { remarks: { contains: opts.search, mode: 'insensitive' } },
      { inputItem: { name: { contains: opts.search, mode: 'insensitive' } } },
    ],
  };
}

/** Item and unit, as every grid renders them. Both lists select the same shape. */
const ROW_INCLUDE = {
  item: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
};

const STEP_INCLUDE = {
  // 🔴 The bill of materials (§5.7). Ordered by seq, because the first input is
  // the principal one — what the step is fundamentally about — and every screen
  // renders it first.
  inputs: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      ...ROW_INCLUDE,
      /* The planner's batch note, read back so the form round-trips and the Issue
         dialog can pre-fill from it. `batch` is included for the label — the grid
         renders `supplierBatchRef`, never `batchNumber` (2026-08-14). */
      plannedBatches: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        include: {
          batch: { select: { id: true, supplierBatchRef: true, manufacturerBatch: true } },
          /** Which package was planned, when the org runs a unit level. Null on
           * every plan row written before it, and on one naming a batch generally. */
          batchUnit: { select: { id: true, seq: true, label: true } },
          location: { select: { id: true, name: true } },
        },
      },
    },
  },
  outputs: { where: { isDeleted: false }, orderBy: { seq: 'asc' }, include: ROW_INCLUDE },
  process: {
    select: { id: true, name: true, code: true },
  },
  workCentre: { select: { id: true, name: true } },
} satisfies Prisma.JobOrderStepInclude;

const JOB_ORDER_INCLUDE = {
  inputItem: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  inputUom: { select: { id: true, unitName: true, symbol: true } },
  route: { select: { id: true, name: true } },
  steps: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: STEP_INCLUDE,
  },
} satisfies Prisma.JobOrderInclude;

const JOB_ORDER_LIST_INCLUDE = {
  inputItem: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  inputUom: { select: { id: true, unitName: true, symbol: true } },
  route: { select: { id: true, name: true } },
  steps: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    // Omit `include: STEP_INCLUDE` for list view to avoid massive N+1 queries.
    // The frontend only needs `order.steps.length` and step scalar fields for lists.
  },
} satisfies Prisma.JobOrderInclude;

export async function getJobOrdersList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.jobOrder.findMany({
      where: jobOrderListWhere(organizationId, opts),
      // Newest first: a job order list is a work queue, not a directory.
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: JOB_ORDER_LIST_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countJobOrders(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.jobOrder.count({ where: jobOrderListWhere(organizationId, opts) }),
  );
}

/**
 * 🔴 THE TERNARY IS ON THE QUERY, NOT INSIDE `include` (2026-09-01).
 *
 * `include: light ? LIST : FULL` type-checks and returns the right rows, but
 * Prisma infers the payload from the union of the two includes and keeps only
 * what both guarantee — so `steps.inputs` vanished from the type of a call that
 * returns it at runtime, and reading it was a `tsc` error in code that worked.
 * Two call sites, each with one literal `include`, is what lets it be inferred.
 */
function findJobOrderFull(tx: TenantClient, organizationId: string, id: string) {
  return tx.jobOrder.findFirst({
    where: { id, organizationId, isDeleted: false },
    include: JOB_ORDER_INCLUDE,
  });
}

function findJobOrderLight(tx: TenantClient, organizationId: string, id: string) {
  return tx.jobOrder.findFirst({
    where: { id, organizationId, isDeleted: false },
    include: JOB_ORDER_LIST_INCLUDE,
  });
}

type FullJobOrder = Awaited<ReturnType<typeof findJobOrderFull>>;
type LightJobOrder = Awaited<ReturnType<typeof findJobOrderLight>>;

/** Omitting `light`, or passing a literal `false`, keeps the full payload's type
 * — which is what a caller reading `steps[].inputs` needs. A caller switching on
 * a runtime boolean gets the union and has to narrow, as it should. */
export async function getJobOrderById(
  organizationId: string,
  id: string,
  light?: false,
): Promise<FullJobOrder>;
export async function getJobOrderById(
  organizationId: string,
  id: string,
  light: boolean,
): Promise<FullJobOrder | LightJobOrder>;
export async function getJobOrderById(organizationId: string, id: string, light = false) {
  return runAsTenant(organizationId, (tx) =>
    light ? findJobOrderLight(tx, organizationId, id) : findJobOrderFull(tx, organizationId, id),
  );
}

export async function getJobOrderWithStepsById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: JOB_ORDER_WITH_STEPS_SELECT,
    }),
  );
}

interface ResolvedInput {
  itemId: string;
  uomId: string | null;
  plannedQty: number | null;
  /** Typed on the row and stored as typed — nothing fills a blank one in.
   * 0 = none allowed; null = unchecked. */
  tolerancePct: number | null;
  fromStock: boolean;
  /** The planner's batch note. Empty for every untracked item and for anyone who
   * simply did not fill it in — see `JobOrderStepInputBatch`. */
  plannedBatches: PlannedBatchRow[];
}

interface RecipeRow {
  componentItemId: string;
  qtyPerUnit: Prisma.Decimal;
  uomId: string | null;
  seq: number;
}

interface ResolvedOutput {
  itemId: string;
  uomId: string | null;
  expectedQty: number | null;
  isPrimary: boolean;
  /** Charge per ACCEPTED unit (landed-cost plan D1–D2). */
  rate: number | null;
  /** Share of the input's material, in % (R1b). Cleared where shares do not apply. */
  sharePct: number | null;
  /** The composite's recipe, frozen onto the step (§5.2). Empty for a plain item. */
  components: RecipeRow[];
}

interface ResolvedStep extends JobOrderStepInput {
  processNameSnapshot: string;
  resolvedInputs: ResolvedInput[];
  resolvedOutputs: ResolvedOutput[];
}

/**
 * The two lists a step carries (§5.7), taken from the request or derived from
 * the scalar columns they replaced.
 *
 * 🔴 WHAT IS SENT IS WHAT IS SAVED, and there is nothing left to infer it from
 * (2026-08-12). Nothing comes from the step above, nothing from the process's
 * `itemChanges` flag, and — since Migration B dropped them — nothing from the
 * `issueItemId` / `receiveItemId` scalars that used to stand in for a client
 * without the nested grids.
 *
 * Both inferences read well on paper and were unusable on screen: the grid had
 * to render a row nobody had typed, labelled "automatic", and the honest
 * question that produced was "so what actually goes into the database?" — which
 * is not a question a form should leave anyone asking. The client seeds those
 * rows visibly instead, where they can be seen, changed, or deleted before
 * saving.
 *
 * 🔴 The header contributes no item either (2026-08-07). It used to prepend
 * `inputItemId` to step 1, back when a job order named one item and one quantity
 * — which a step consuming a SET cannot be described by. What the order runs on
 * is simply what step 1 lists.
 */
function resolveStepRows(
  step: JobOrderStepInput,
  index: number,
): { inputs: StepInputRow[]; outputs: StepOutputRow[] } {
  const inputs: StepInputRow[] = [...(step.inputs ?? [])];
  const outputs: StepOutputRow[] = [...(step.outputs ?? [])];

  assertNoRepeatedItem(inputs, index, 'inputs');
  assertNoRepeatedItem(outputs, index, 'outputs');

  return { inputs, outputs };
}

/**
 * One row per item on each list.
 *
 * `@@unique([jobOrderStepId, itemId])` would catch this as a 409 with a
 * constraint name in it; the same slip caught here says which row. Listing an
 * item twice is data entry going wrong, not a second requirement — the two
 * quantities would have to be added together anyway.
 */
function assertNoRepeatedItem(
  rows: readonly { itemId: string }[],
  stepIndex: number,
  list: 'inputs' | 'outputs',
) {
  const seen = new Set<string>();
  for (const [rowIndex, row] of rows.entries()) {
    if (seen.has(row.itemId)) {
      throw new ApiError(400, `Step ${stepIndex + 1} lists the same item twice.`, {
        [`steps.${stepIndex}.${list}.${rowIndex}.itemId`]: 'This item is already on the step.',
      });
    }
    seen.add(row.itemId);
  }
}

/**
 * 🔴 EXACTLY ONE PRIMARY OUTPUT PER STEP (§9.2.1).
 *
 * It absorbs the step's whole cost, so two of them would mean the operation was
 * paid for twice and none would mean the cost lands nowhere. Apportioning by
 * quantity is not available as a fallback — 2,880 PCS and 80 KG have no ratio
 * between them — so when nobody chooses, the first row is it.
 */
function flagPrimaryOutput(rows: readonly StepOutputRow[], stepIndex: number): ResolvedOutput[] {
  const flagged = rows.filter((row) => row.isPrimary);
  if (flagged.length > 1) {
    throw new ApiError(
      400,
      `Step ${stepIndex + 1} marks ${flagged.length} outputs as primary. Only one output can carry ` +
        'the cost of the step; the others take an explicit value.',
      { [`steps.${stepIndex}.outputs`]: 'Mark exactly one output as primary.' },
    );
  }
  return rows.map((row, index) => ({
    itemId: row.itemId,
    uomId: row.uomId ?? null,
    expectedQty: row.expectedQty ?? null,
    isPrimary: flagged.length === 1 ? Boolean(row.isPrimary) : index === 0,
    rate: row.rate ?? null,
    sharePct: row.sharePct ?? null,
    // Filled in `buildSteps`, once one query has read every composite's recipe.
    components: [],
  }));
}

/**
 * 🔴 THE CHAIN IS A CLASSIFICATION, NOT A RULE (§6.4). IT REJECTS NOTHING.
 *
 * It used to reject a step whose input was not the previous step's output. Since
 * §5.7 that is false by design: thread and buttons come from the godown, not
 * from the operation above, and a rule that refuses them refuses most real
 * steps. So each input is instead LABELLED — fed by an earlier step, or drawn
 * from stock — and saved either way.
 *
 * 🔴 An input produced only by a LATER step is labelled `fromStock: true` too,
 * and that is the honest answer rather than a concession (2026-08-11). The flag
 * means one thing — "nothing above this step supplies it" — and at the moment
 * this step runs, a later step's output does not exist, so the material can only
 * come off the shelf. It used to raise a 400 telling somebody to reorder the
 * steps, and that refused whole documents over an arrangement the grid itself
 * invites: steps are typed top-down, the same item is picked again a row later,
 * and the save carrying both was the one rejected. `fromStock` only ever drives
 * a badge, so nothing downstream needed the refusal.
 *
 * 🔴 WHAT REPLACED IT IS A WARNING, NOT A RULE — `overPlanWarning` on the client,
 * off the balance `planQuantities` walks. Picking the same item in the next step
 * is allowed; planning more of it than the steps above hand over is worth saying
 * out loud, but not worth refusing: the difference can legitimately come from
 * stock, which is exactly the mixed supply a single `fromStock` flag cannot
 * express.
 *
 * The only hard gate is at issue time: real stock in the ledger. A mistyped chain
 * surfaces there as "no stock of Dyed Fabric at Main Godown" — later than a
 * save-time error, but on the screen where somebody can act on it. An input fed
 * by a step that has returned nothing yet is a warning there (`getChainWarnings`).
 */
function classifyStepInputs(
  steps: readonly { resolvedInputs: ResolvedInput[]; resolvedOutputs: ResolvedOutput[] }[],
  /**
   * Items produced by steps that already exist on the order and are NOT in
   * `steps` — the append path (§append). Everything here ran before everything
   * being built, so an input matching one is chain-fed, not drawn from stock.
   */
  producedEarlier: ReadonlySet<string> = new Set(),
) {
  // Grows as the walk advances, so a step is only ever compared against what ran
  // BEFORE it. One pass and one set — no producer index to build and re-scan per
  // row, and no second lookup for the later-producer case that no longer exists.
  const producedAbove = new Set(producedEarlier);
  for (const step of steps) {
    for (const input of step.resolvedInputs) {
      input.fromStock = !producedAbove.has(input.itemId);
    }
    // After its own inputs, never before: a step does not feed itself.
    for (const output of step.resolvedOutputs) producedAbove.add(output.itemId);
  }
}

/**
 * Freeze the Process master's name onto the step (§2.4).
 *
 * Nothing else comes from the process any more: the rate is per output row and
 * its basis is gone (landed-cost plan D1–D2), and tolerance is typed per input row.
 *
 * The items are NOT set here — they are two lists now (`resolveStepRows`), and
 * the units that follow them cannot be known until every step's items are. See
 * `applyRowUnits`.
 */
function applyStepDefaults(
  step: JobOrderStepInput,
  process: { name: string },
): JobOrderStepInput & { processNameSnapshot: string } {
  return { ...step, processNameSnapshot: process.name };
}

/**
 * 🔴 A STEP TRANSACTS IN ITS OWN ITEMS' STOCKING UNITS.
 *
 * One item has exactly one stocking unit (§5.1), and `postMovement` writes the
 * BATCH's unit into the ledger whatever the document says. So a step carrying a
 * different unit makes the challan and the ledger describe one movement in two
 * units: `jobIssues.service.ts` copies `step.issueUomId` onto the challan while
 * the ledger records metres. Nothing errors. The stock that left is simply not
 * the stock the paperwork says left.
 *
 * Transacting in a unit other than the item's is real (§5.1's left column) but
 * needs `ItemUomConversion`, which does not exist yet. Until it does, the item's
 * own unit is the only correct answer.
 *
 * The step's own uom is the only fallback left. `Process.defaultIssueUomId` /
 * `defaultReceiveUomId` used to answer for an item with no stocking uom, and they
 * went on 2026-08-10 — an org-wide "issue in KG" was a guess about one item made
 * on the operation master, and it was exactly the guess that produced the
 * two-units-one-movement bug above. An item with no stocking uom now resolves to
 * null, which the Issue dialog already refuses, instead of to a plausible wrong
 * unit nothing warns about.
 */
function applyRowUnits<T extends { itemId: string; uomId: string | null }>(
  rows: readonly T[],
  stockingUomByItem: ReadonlyMap<string, string | null>,
): T[] {
  return rows.map((row) => ({
    ...row,
    uomId: stockingUomByItem.get(row.itemId) ?? row.uomId ?? null,
  }));
}

/**
 * Quantities are stored at four decimal places (`Decimal(18, 4)`), so the running
 * balance below is kept there too. Plain float subtraction drifts — 100 − 33.3 −
 * 33.3 is 33.400000000000006, not 33.4 — and that drift would be written onto a
 * row as a planned quantity nobody typed.
 */
const roundQty = (qty: number) => Math.round(qty * 10_000) / 10_000;

/**
 * 🔴 WHAT THE PRIMARY OUTPUT IS EXPECTED TO RETURN WHEN NOBODY SAID — and, just
 * as importantly, when this refuses to answer (2026-08-12).
 *
 * It used to answer always: `principal.plannedQty × (expectedYield ?? 1)`. With
 * `expectedYield` off the steps grid since 2026-08-10, that reduced to 1:1 — so
 * cutting 4,800 M of fabric silently planned **4,800 PCS** of panels. Metres and
 * pieces have no ratio (§5.1); the number was not an estimate, it was a category
 * error. And it did not stay put: it became the next step's planned input, which
 * is the base its tolerance ceiling is computed from, so an invented figure
 * quietly set the over-issue limit on a real challan.
 *
 * Two things count as a basis, and nothing else does:
 *
 *   - **A stated yield.** Somebody typed the ratio, so it answers across units —
 *     0.6 turns 4,800 M into 2,880 PCS because a human said it does.
 *   - **The same unit on both sides.** Dyeing takes metres and returns metres,
 *     washing takes pieces and returns pieces. 1:1 is the honest default, and a
 *     shortfall is what the receipt and the tolerance are for.
 *
 * Otherwise: `null`. The client shows the derivable case as a grey placeholder in
 * the Expected box and leaves the cross-unit case empty, so the one number the
 * system genuinely cannot know is the one it asks for.
 *
 * Both units null — an item with no stocking uom, which the Sprint 1 backfill
 * left some of — counts as "same". They are equally unknown, so this is no worse
 * than the behaviour it replaces, and `applyRowUnits` has already resolved every
 * row it could by this point.
 */
function derivedExpectedQty(
  row: { isPrimary: boolean; uomId: string | null },
  principal: { plannedQty: number | null; uomId: string | null } | null,
  expectedYield: number | null,
): number | null {
  if (!row.isPrimary || principal?.plannedQty == null) return null;
  if (expectedYield !== null) return roundQty(principal.plannedQty * expectedYield);
  return row.uomId === principal.uomId ? roundQty(principal.plannedQty) : null;
}

/**
 * Plan the quantities — 🔴 PER ITEM, because there is no single number that
 * covers metres, cones and pieces at once (§5.7).
 *
 * Every quantity is typed on its own row. An input fed by an earlier step falls
 * back to what is still unclaimed of that step's expected output; an input drawn
 * FROM STOCK gets nothing, because how much thread a run needs is a bill of
 * materials this system does not hold and a guessed number would read as an
 * estimate somebody made.
 *
 * The primary output is expected to yield planned × expected yield, or the same
 * quantity when no yield is declared — "no expectation recorded" is not "expect
 * nothing". A by-product gets nothing for the same reason thread does.
 *
 * 🔴 THE BALANCE IS A RUNNING ONE, not "what the nearest step produced": two
 * steps can both draw on step 1's output, and the second may only take what the
 * first left. One map over one pass, so a fifty-step order costs one walk.
 *
 * 🔴 AND IT REFUSES NOTHING — deliberately, and this is the second time that
 * decision has been made here (2026-08-11).
 *
 * Planning more of an item than the steps above produce was briefly a 400. It is
 * a warning on the client instead (`overPlanWarning`), because the refusal has a
 * false positive that is an ordinary plan: cutting returns 90 panels and
 * stitching plans 120, because 30 panels are already in the godown from a
 * short-closed order. A row's supply is a MIX — partly chain-fed, partly off the
 * shelf — and `fromStock` is a single flag, so a ceiling read off it assumes an
 * exclusivity the domain does not have. That is the same assumption the old
 * chain rule made when it refused thread and buttons (§6.4).
 *
 * So the balance survives as what it is genuinely good for — deriving the blank
 * rows — and the hard gate stays where the domain already put it: real stock
 * availability in the ledger, at issue time.
 *
 * 🔴 This is a PLAN, computed once and stored, and it is never used as a
 * conversion factor at receipt time (§6.3). What actually comes back is measured,
 * not derived.
 */
function planQuantities(steps: ResolvedStep[], seeded: ReadonlyMap<string, number> = new Map()) {
  // How much of each item the steps above still have to give. Seeded on the
  // append path with what the steps ALREADY on the order have left over.
  const available = new Map<string, number>(seeded);

  return steps.map((step) => {
    const resolvedInputs = step.resolvedInputs.map((row, rowIndex) => {
      // `plannedInputQty` seeds the principal row only, and only for a client
      // that has not grown the per-item boxes. It goes with Migration B.
      const sent = row.plannedQty ?? (rowIndex === 0 ? (step.plannedInputQty ?? null) : null);
      // A from-stock row has no upstream figure, and neither does one whose
      // producer left its expected quantity blank — deriving from either would
      // put a number on the row that nobody supplied.
      const upstream = row.fromStock ? null : (available.get(row.itemId) ?? null);

      const plannedQty = sent ?? (upstream !== null && upstream > 0 ? roundQty(upstream) : null);

      // Claimed, so a second step drawing on the same output is offered what is
      // left rather than the whole of it a second time.
      if (!row.fromStock && plannedQty !== null) {
        available.set(row.itemId, roundQty((available.get(row.itemId) ?? 0) - plannedQty));
      }
      return { ...row, plannedQty };
    });

    const principal = resolvedInputs[0] ?? null;
    // 🔴 Only on a single-output step (landed-cost plan §6.3). With two outputs
    // sharing one input, handing the primary the WHOLE planned input distorts the
    // plan ratio every receipt is costed by, and books the gap as false loss.
    const derivable = step.resolvedOutputs.length === 1;
    const resolvedOutputs = step.resolvedOutputs.map((row) => ({
      ...row,
      expectedQty:
        row.expectedQty ??
        (derivable ? derivedExpectedQty(row, principal, step.expectedYield ?? null) : null),
    }));

    // Added AFTER this step's own inputs are settled: a step does not feed itself,
    // and a process that returns what it took would otherwise double its output.
    for (const row of resolvedOutputs) {
      if (row.expectedQty !== null) {
        available.set(row.itemId, roundQty((available.get(row.itemId) ?? 0) + row.expectedQty));
      }
    }

    return {
      ...step,
      resolvedInputs,
      resolvedOutputs,
      // The old scalar column, kept in step with the principal input until
      // Migration B — the Overview page and the Issue dialog still read it.
      plannedInputQty: principal?.plannedQty ?? step.plannedInputQty ?? null,
    };
  });
}

async function assertStepRefs(
  tx: TenantClient,
  organizationId: string,
  steps: readonly JobOrderStepInput[],
) {
  const rows = steps.flatMap((s) => [...(s.inputs ?? []), ...(s.outputs ?? [])]);
  await assertProcessesBelongToOrg(
    tx,
    organizationId,
    steps.map((s) => s.processId),
  );
  await assertItemsBelongToOrg(
    tx,
    organizationId,
    rows.map((row) => row.itemId),
  );
  await assertUomsBelongToOrg(
    tx,
    organizationId,
    rows.map((row) => row.uomId),
  );
  await assertLocationsBelongToOrg(
    tx,
    organizationId,
    steps.map((s) => s.workCentreLocationId),
  );
}

/**
 * Turn the request's steps into rows: process defaults applied, processor names
 * snapshotted, quantities planned, seq renumbered from array position.
 *
 * The processor NAME is resolved here and frozen, not joined at read time. A
 * vendor deleted next year must still print on this order's step (§2.3).
 */
/**
 * What the steps already on the order produce, for the append path. Empty on
 * create and on the full-rewrite edit, where the array IS the whole order.
 */
interface PriorSteps {
  /** Items an existing step produces — chain-fed, not from stock. */
  producedItemIds: ReadonlySet<string>;
  /** …and how much of each is still SPARE — expected out of those steps, less
   * what they already plan to consume — so an appended step plans from the
   * remainder rather than from an output another step is already taking. */
  producedQty: ReadonlyMap<string, number>;
  /** `seq` of the first new step. `1` everywhere except append. */
  startSeq: number;
}

const NO_PRIOR_STEPS: PriorSteps = {
  producedItemIds: new Set(),
  producedQty: new Map(),
  startSeq: 1,
};

/**
 * The steps already on an order, with the one fact that decides whether each may
 * be rewritten: whether anything has moved against it.
 *
 * 🔴 Soft-deleted steps are included on purpose — `@@unique([jobOrderId, seq])` is
 * a FULL index, so a deleted step still occupies its number and `seq` must be
 * allocated past it.
 *
 * Cancelled documents do not count. A cancelled challan is a challan that was
 * withdrawn, and it must not freeze a step forever.
 */
async function loadExistingSteps(tx: TenantClient, organizationId: string, jobOrderId: string) {
  return tx.jobOrderStep.findMany({
    where: { organizationId, jobOrderId },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      seq: true,
      isDeleted: true,
      processNameSnapshot: true,
      status: true,
      processorType: true,
      processorId: true,
      inputs: {
        where: { isDeleted: false },
        select: { itemId: true, plannedQty: true, fromStock: true },
      },
      outputs: { where: { isDeleted: false }, select: { itemId: true, expectedQty: true } },
      // Posted documents only. A DRAFT must not lock the steps grid: the lock
      // exists because a live challan's step number is printed on paperwork a
      // processor is holding, and a draft has been handed to nobody. Editing the
      // step under a parked draft is safe because posting re-validates the draft
      // against the step as it stands then, and refuses it if the item is gone.
      _count: {
        select: {
          issues: { where: { isDeleted: false, status: POSTED_DOC_STATUS } },
          receipts: { where: { isDeleted: false, status: POSTED_DOC_STATUS } },
        },
      },
    },
  });
}

/**
 * Complete a step: a human saying nothing more is coming back (landed-cost D7).
 *
 * 🔴 Whatever is still at the processor is written off in the same transaction
 * (R8), and the step is then closed to every document (R9) — so a draft still
 * parked against it would be a document that can never post. Those are refused
 * by name rather than silently stranded. There is no reopen.
 */
export async function manuallyCompleteStep(
  organizationId: string,
  jobOrderId: string,
  stepId: string,
  userId: string | undefined,
) {
  return withUniqueViolation('Order already closed or not found', async () => {
    // A fifty-line challan writes fifty scrap rows (jobwork.types.ts).
    await runAsDocument(organizationId, async (tx) => {
      await lockStep(tx, organizationId, stepId);
      const step = await tx.jobOrderStep.findFirst({
        where: { id: stepId, jobOrderId, organizationId, isDeleted: false },
        select: { id: true, seq: true, status: true },
      });
      if (!step) throw ApiError.notFound('Step not found.');
      if (step.status === 'completed' || step.status === 'short_closed') {
        throw ApiError.conflict('Step is already completed or closed short.');
      }

      const draftIssues = await tx.jobIssue.findMany({
        where: { organizationId, jobOrderStepId: step.id, isDeleted: false, status: 'draft' },
        select: { challanNumber: true },
      });
      const draftReceipts = await tx.jobReceipt.findMany({
        where: { organizationId, jobOrderStepId: step.id, isDeleted: false, status: 'draft' },
        select: { receiptNumber: true },
      });
      const drafts = [
        ...draftIssues.map((row) => row.challanNumber),
        ...draftReceipts.map((row) => row.receiptNumber),
      ];
      if (drafts.length > 0) {
        throw new ApiError(
          409,
          `Step ${step.seq} still has drafts parked against it: ${drafts.join(', ')}. Post or ` +
            'delete them first — once the step is completed they can never be posted.',
          { drafts: drafts.join(', ') },
        );
      }

      await writeOffStep(tx, organizationId, step.id, {
        reason: 'Step completed — still at the processor, written off as job order loss.',
        userId,
      });

      await tx.jobOrderStep.update({
        where: { id: step.id },
        data: {
          isCompleted: true,
          updatedBy: userId,
        },
      });

      await recomputeStep(tx, organizationId, step.id);
    });
    return getJobOrderOverview(organizationId, jobOrderId);
  });
}

type ExistingStep = Awaited<ReturnType<typeof loadExistingSteps>>[number];

const hasDocuments = (step: ExistingStep) => step._count.issues > 0 || step._count.receipts > 0;

/**
 * What a set of already-saved steps hands on to the steps built after them.
 *
 * 🔴 NET, not gross — the outputs those steps expect, LESS what they already plan
 * to consume of the same item. Seeding the gross figure would offer a new step
 * panels that an existing step is already eating.
 *
 * Expected, not received. What actually came back is measured at receipt time and
 * never derived (§6.3); this is a plan, and it stays typed-over-able.
 */
function priorFrom(steps: readonly ExistingStep[], startSeq: number): PriorSteps {
  const producedItemIds = new Set<string>();
  const producedQty = new Map<string, number>();

  for (const step of steps) {
    if (step.isDeleted) continue;
    for (const output of step.outputs) {
      producedItemIds.add(output.itemId);
      if (output.expectedQty !== null) {
        producedQty.set(
          output.itemId,
          (producedQty.get(output.itemId) ?? 0) + Number(output.expectedQty),
        );
      }
    }
    for (const input of step.inputs) {
      if (input.fromStock || input.plannedQty === null) continue;
      producedQty.set(
        input.itemId,
        (producedQty.get(input.itemId) ?? 0) - Number(input.plannedQty),
      );
    }
  }

  // Orders written before the balance existed can already over-claim. A negative
  // remainder would plan the next step at less than nothing; nothing spare is
  // simply nothing spare.
  for (const [itemId, spare] of producedQty) {
    if (spare < 0) producedQty.set(itemId, 0);
  }

  return { producedItemIds, producedQty, startSeq };
}

/**
 * 🔴 WHAT A STEP MAY LOOK LIKE (landed-cost plan §3, V1, V2, V5) — so that every
 * output can later be costed by what it is made from.
 *
 *   V1  more than one input item → every output is a composite, whose recipe says
 *       what it is made from. There is no "made from" column (D3).
 *   V2  every component of an output composite is one of the step's inputs, and a
 *       composite with no recipe is refused.
 *   V3  GONE (2026-09-18). One input with several outputs in different units used
 *       to be refused because `Σ expected × w` cannot add pieces to metres. Such a
 *       step now splits by share (R1b), which never adds them.
 *   V5  every input is drawn on by some output (R1). One nothing draws on is never
 *       consumed by a receipt and was only ever written off at completion — lace
 *       beside a shirt whose recipe has none (2026-09-18, was a warning).
 *
 * An output that is itself one of the inputs passes straight through — leftover
 * fabric returned beside the shirts — and is exempt from V1 and V2. A step that
 * lists no inputs yet is a draft being typed, with nothing to check V1 or V2
 * against; one that lists no outputs is left to V4 at issue.
 *
 * Only steps being written are checked: a locked step already has documents and
 * cannot be re-planned, so it is never passed in here.
 */
function assertStepShape(
  step: {
    resolvedInputs: readonly { itemId: string; uomId: string | null }[];
    resolvedOutputs: readonly { itemId: string; uomId: string | null }[];
  },
  stepIndex: number,
  itemById: ReadonlyMap<string, { name: string; itemStructure: string }>,
  recipeByComposite: ReadonlyMap<string, readonly RecipeRow[]>,
  nameById: ReadonlyMap<string, string>,
) {
  const inputIds = new Set(step.resolvedInputs.map((row) => row.itemId));
  const nameOf = (id: string) => itemById.get(id)?.name ?? nameById.get(id) ?? 'An item';
  const refuse = (rowIndex: number, message: string): never => {
    throw new ApiError(400, `Step ${stepIndex + 1}: ${message}`, {
      [`steps.${stepIndex}.outputs.${rowIndex}.itemId`]: message,
    });
  };

  if (inputIds.size > 0) {
    for (const [rowIndex, output] of step.resolvedOutputs.entries()) {
      if (inputIds.has(output.itemId)) continue;
      const isComposite = itemById.get(output.itemId)?.itemStructure === 'composite';

      if (inputIds.size > 1 && !isComposite) {
        refuse(
          rowIndex,
          `${nameOf(output.itemId)} is not a composite item. A step that consumes several items ` +
            'can only produce composites, whose recipe says what each is made from.',
        );
      }
      if (!isComposite) continue;

      const components = recipeByComposite.get(output.itemId) ?? [];
      if (components.length === 0) {
        refuse(
          rowIndex,
          `${nameOf(output.itemId)} has no recipe yet, so nothing says what it is made from. ` +
            'Add its components first.',
        );
      }
      const missing = components.find((row) => !inputIds.has(row.componentItemId));
      if (missing) {
        refuse(
          rowIndex,
          `${nameOf(output.itemId)} is made from ${nameOf(missing.componentItemId)}, which this ` +
            'step does not consume. Add it to the inputs, or pick a different output.',
        );
      }
    }
  }

  if (inputIds.size > 0 && step.resolvedOutputs.length > 0) {
    // Mirrors R1 (`drawPerUnit`): a pass-through draws itself, a composite its
    // recipe, a plain output of a single-input step that one input.
    const drawn = new Set<string>();
    for (const output of step.resolvedOutputs) {
      if (inputIds.has(output.itemId)) drawn.add(output.itemId);
      else if (itemById.get(output.itemId)?.itemStructure === 'composite') {
        for (const row of recipeByComposite.get(output.itemId) ?? []) {
          drawn.add(row.componentItemId);
        }
      } else if (inputIds.size === 1) drawn.add(step.resolvedInputs[0]!.itemId);
    }
    const unused = step.resolvedInputs.findIndex((row) => !drawn.has(row.itemId));
    if (unused >= 0) {
      const message =
        `Nothing this step produces is made from ${nameOf(step.resolvedInputs[unused]!.itemId)}. ` +
        'Remove it, or add it to the recipe of what the step produces.';
      throw new ApiError(400, `Step ${stepIndex + 1}: ${message}`, {
        [`steps.${stepIndex}.inputs.${unused}.itemId`]: message,
      });
    }
  }
}

/**
 * 🔴 R1b AT SAVE — every share-split output states its share, and they make 100%.
 *
 * Checked when the job order is saved rather than at the first challan like the
 * quantities (V4): the planner is the one who knows the split, and a blank must
 * never be read as "the first output takes it all". Only steps being written come
 * through here, so a locked step planned before shares existed is not re-checked.
 */
function assertShares(
  outputs: readonly ResolvedOutput[],
  split: ReadonlySet<ResolvedOutput>,
  stepIndex: number,
  itemById: ReadonlyMap<string, { name: string }>,
) {
  if (split.size === 0) return;
  const rows = [...outputs.entries()].filter(([, row]) => split.has(row));
  const blank = rows.find(([, row]) => row.sharePct === null);
  if (blank) {
    const [rowIndex, row] = blank;
    const message = `Enter the share % for ${itemById.get(row.itemId)?.name ?? 'this item'}.`;
    throw new ApiError(400, `Step ${stepIndex + 1}: ${message}`, {
      [`steps.${stepIndex}.outputs.${rowIndex}.sharePct`]: message,
    });
  }
  const total = roundQty(rows.reduce((sum, [, row]) => sum + row.sharePct!, 0));
  if (Math.abs(total - 100) > 0.01) {
    const message = `The shares add up to ${total}%. They must total 100%.`;
    throw new ApiError(
      400,
      `Step ${stepIndex + 1}: ${message}`,
      Object.fromEntries(
        rows.map(([rowIndex]) => [`steps.${stepIndex}.outputs.${rowIndex}.sharePct`, message]),
      ),
    );
  }
}

async function buildSteps(
  tx: TenantClient,
  organizationId: string,
  steps: readonly JobOrderStepInput[],
  prior: PriorSteps = NO_PRIOR_STEPS,
  /** Where `steps` begin in the grid the client holds. The update path builds only
   * the tail past the work front, and an error keyed from 0 would mark the wrong row. */
  indexOffset = 0,
) {
  const processes = await tx.process.findMany({
    where: {
      id: { in: [...new Set(steps.map((s) => s.processId))] },
      organizationId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      itemChanges: true,
    },
  });
  const byId = new Map(processes.map((p) => [p.id, p]));

  // Sequential, not `map`: a step that names no input of its own falls back to
  // what the step above produces, so it cannot be resolved until that one has.
  const resolved: ResolvedStep[] = [];
  for (const [index, step] of steps.entries()) {
    const process = byId.get(step.processId);
    if (!process) throw ApiError.badRequest('Unknown process.');

    // A step can still resolve to NO inputs and no outputs — a draft the form is
    // halfway through. That saved before Sprint 5 (both scalars simply stayed
    // null) and still saves; tightening it here would block a legitimate
    // work-in-progress. It is refused where it becomes a real problem: the Issue
    // dialog, which has nothing to offer and says so.
    const { inputs, outputs } = resolveStepRows(step, index + indexOffset);

    resolved.push({
      ...applyStepDefaults(step, process),
      resolvedInputs: inputs.map((row) => ({
        itemId: row.itemId,
        uomId: row.uomId ?? null,
        plannedQty: row.plannedQty ?? null,
        tolerancePct: row.tolerancePct ?? null,
        // Overwritten by `classifyStepInputs` below, once every step's outputs
        // are known. Nothing may read it before then.
        fromStock: true,
        plannedBatches: row.plannedBatches ?? [],
      })),
      resolvedOutputs: flagPrimaryOutput(outputs, index + indexOffset),
    });
  }

  // One query for every item any step touches, so the units below are the items'
  // own rather than an org-wide guess off the process master. Names and structure
  // ride along for the shape rules.
  const itemIds = [
    ...new Set(
      resolved.flatMap((step) => [
        ...step.resolvedInputs.map((row) => row.itemId),
        ...step.resolvedOutputs.map((row) => row.itemId),
      ]),
    ),
  ];
  const chainItems = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId, isDeleted: false },
        select: {
          id: true,
          name: true,
          itemStructure: true,
          stockingUomId: true,
        },
      })
    : [];
  const itemById = new Map(chainItems.map((item) => [item.id, item]));
  const stockingUomByItem = new Map(chainItems.map((item) => [item.id, item.stockingUomId]));

  // Every composite output's recipe in ONE query, never one per row — it is both
  // what V2 checks and what the step freezes (§5.2).
  const compositeIds = [
    ...new Set(
      resolved
        .flatMap((step) => step.resolvedOutputs.map((row) => row.itemId))
        .filter((id) => itemById.get(id)?.itemStructure === 'composite'),
    ),
  ];
  const recipeRows = compositeIds.length
    ? await tx.compositeItemComponent.findMany({
        where: { organizationId, compositeItemId: { in: compositeIds }, isDeleted: false },
        orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
        select: {
          compositeItemId: true,
          componentItemId: true,
          qtyPerUnit: true,
          uomId: true,
          seq: true,
          component: { select: { name: true } },
        },
      })
    : [];
  const recipeByComposite = new Map<string, RecipeRow[]>();
  const componentNameById = new Map<string, string>();
  for (const { compositeItemId, component, ...row } of recipeRows) {
    recipeByComposite.set(compositeItemId, [
      ...(recipeByComposite.get(compositeItemId) ?? []),
      row,
    ]);
    componentNameById.set(row.componentItemId, component.name);
  }

  const withUnits = resolved.map((step) => ({
    ...step,
    resolvedInputs: applyRowUnits(step.resolvedInputs, stockingUomByItem),
    resolvedOutputs: applyRowUnits(step.resolvedOutputs, stockingUomByItem).map((row) => ({
      ...row,
      components: recipeByComposite.get(row.itemId) ?? [],
    })),
  }));

  for (const [index, step] of withUnits.entries()) {
    assertStepShape(step, index + indexOffset, itemById, recipeByComposite, componentNameById);
    // A share means nothing off a share-split step (R1b) — two inputs, one product,
    // the leftover row — so none is kept there to be misread later.
    const split = new Set(
      shareSplitOutputs(
        step.resolvedInputs.map((row) => row.itemId),
        step.resolvedOutputs,
      ),
    );
    for (const row of step.resolvedOutputs) if (!split.has(row)) row.sharePct = null;
    assertShares(step.resolvedOutputs, split, index + indexOffset, itemById);
  }

  classifyStepInputs(withUnits, prior.producedItemIds);

  const planned = planQuantities(withUnits, prior.producedQty);

  const rows = [];
  for (const [index, step] of planned.entries()) {
    const processorType = (step.processorType ?? 'vendor') as ProcessorType;
    rows.push({
      seq: prior.startSeq + index,
      processId: step.processId,
      processNameSnapshot: step.processNameSnapshot,
      processorType,
      processorId: step.processorId ?? null,
      processorNameSnapshot: await resolveProcessorName(
        tx,
        organizationId,
        processorType,
        step.processorId,
      ),
      workCentreLocationId: step.workCentreLocationId ?? null,
      expectedYield: step.expectedYield ?? null,
      plannedInputQty: step.plannedInputQty,
      remarks: step.remarks?.trim() || null,
      customFields: step.customFields,
      inputs: step.resolvedInputs,
      outputs: step.resolvedOutputs,
    });
  }
  return rows;
}

const ROW_OVERVIEW_INCLUDE = {
  item: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
} satisfies Prisma.JobOrderStepInputInclude;

const STEP_OVERVIEW_INCLUDE = {
  inputs: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      ...ROW_OVERVIEW_INCLUDE,
      /**
       * 🔴 The plan rides along, or the Issue screen cannot pre-fill from it.
       *
       * That screen is reached from a step's Issue button and is fed by THIS
       * payload, not by `STEP_INCLUDE` — so leaving the plan out here made the
       * seeding effect in `IssueForm` dead code: `plannedBatches` arrived absent,
       * the schema's `.default([])` turned it into an empty array, and the effect
       * returned early on every item.
       *
       * SCALARS ONLY, unlike `STEP_INCLUDE`. The seeding matches on ids and takes
       * its labels from the availability query it has already run, so hydrating
       * the batch, package and godown here would be three more round trips for
       * strings nothing reads.
       */
      plannedBatches: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          batchId: true,
          batchUnitId: true,
          locationId: true,
          qty: true,
        },
      },
    },
  },
  outputs: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      ...ROW_OVERVIEW_INCLUDE,
      // The frozen recipe (§5.2), scalars only — the Issue screen's plan warnings
      // read what each output draws on from it.
      components: {
        where: { isDeleted: false },
        orderBy: { seq: 'asc' },
        select: { componentItemId: true, qtyPerUnit: true },
      },
    },
  },
  process: { select: { id: true, name: true, code: true } },
  workCentre: { select: { id: true, name: true } },
} satisfies Prisma.JobOrderStepInclude;

export const JOB_ORDER_OVERVIEW_INCLUDE = {
  inputItem: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  inputUom: { select: { id: true, unitName: true, symbol: true } },
  route: { select: { id: true, name: true } },
  steps: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: STEP_OVERVIEW_INCLUDE,
  },
} satisfies Prisma.JobOrderInclude;

export const JOB_ORDER_WITH_STEPS_SELECT = {
  id: true,
  steps: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      seq: true,
      processNameSnapshot: true,
      processorNameSnapshot: true,
    },
  },
} satisfies Prisma.JobOrderSelect;

export async function createNewJobOrder(
  organizationId: string,
  data: CreateJobOrderInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, steps, ...header } = data;

  // `runAsDocument`, not `runAsTenant`: Material In for a fifty-taka consignment
  // writes ~150 rows and blows Prisma's 5-second default (jobwork.types.ts).
  return runAsDocument(organizationId, async (tx) => {
    await assertStepRefs(tx, organizationId, steps);

    const ownership = (header.ownership ?? 'own') as Ownership;
    if (ownership === 'customer' && !header.ownerPartyId) {
      throw new ApiError(400, 'Customer-owned work needs the customer it belongs to.', {
        ownerPartyId: 'Required when the material belongs to a customer.',
      });
    }
    if (ownership === 'own' && header.ownerPartyId) {
      throw new ApiError(400, 'Only customer-owned work may name an owning party.', {
        ownership: 'Set this to "customer" to name an owner.',
      });
    }
    if (header.ownerPartyId) {
      const customer = await tx.customer.findFirst({
        where: { id: header.ownerPartyId, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!customer) throw ApiError.badRequest('Unknown customer.');
    }

    /**
     * 🔴 The route is read HERE and never again — only its name is kept, frozen
     * (§2.4). Every default it supplied has already been copied into the steps
     * the client sent, so from this line on the order is independent of it.
     */
    let routeNameSnapshot: string | null = null;
    if (header.routeId) {
      const route = await tx.route.findFirst({
        where: { id: header.routeId, organizationId, isDeleted: false },
        select: { name: true },
      });
      if (!route) throw ApiError.badRequest('Unknown route.');
      routeNameSnapshot = route.name;
    }

    const defs = await loadActiveDefinitions(tx, organizationId, 'job_order');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    const stepRows = await buildSteps(tx, organizationId, steps);

    // 🔴 CALC+ — the header columns are DERIVED from step 1, never sent. They
    // exist for the list page and for orders written before the header lost its
    // item; nothing reads them to decide anything.
    const headerItem = headerItemFrom(stepRows);

    // Allocated inside this transaction, so an interrupted save reuses the
    // number rather than leaving a gap in the series (numberSequence.ts). A number
    // the user typed over the offered one is honoured instead, and pushes the
    // series past it so the next save is not handed a number this row now holds.
    const jobOrderNumber = header.jobOrderNumber
      ? await reserveSuppliedNumber(tx, organizationId, 'job_order', header.jobOrderNumber)
      : await allocateNumber(tx, organizationId, 'job_order');

    const orderDate = header.orderDate ?? new Date();
    // A job order posts no stock, but it is still a document on these books and
    // every challan raised under it inherits its period.
    await assertOnOrAfterMigration(tx, {
      organizationId,
      date: orderDate,
      field: 'orderDate',
      label: 'job order',
    });

    const created = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.jobOrder.create({
        data: {
          organizationId,
          jobOrderNumber,
          orderDate,
          targetDate: header.targetDate ?? null,
          inputItemId: headerItem.itemId,
          inputUomId: headerItem.uomId,
          inputQty: headerItem.qty,
          routeId: header.routeId ?? null,
          routeNameSnapshot,
          ownership,
          ownerPartyId: header.ownerPartyId ?? null,
          remarks: header.remarks?.trim() || null,
          customFields,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
    );

    await writeSteps(tx, organizationId, created.id, stepRows, userId);

    return readBack(tx, organizationId, created.id);
  });
}

type StepRow = Awaited<ReturnType<typeof buildSteps>>[number];

/**
 * 🔴 The header's item and quantity, DERIVED from step 1's first consumed row.
 *
 * They stopped being fields anyone fills in on 2026-08-07: a step consumes a SET
 * of items (§5.7), and one item and one quantity on the header could only ever
 * name one of them. What survives is a stored projection — the list page needs a
 * column, and orders written before the change have to keep reading — so it is
 * CALC+, exactly like `status`: stored, never sent by a client, and never
 * consulted to decide anything.
 *
 * All three are null for a step that lists nothing yet, which is why the columns
 * became nullable in the same change rather than having a value invented.
 */
function headerItemFrom(rows: readonly StepRow[]) {
  const principal = rows[0]?.inputs[0];
  return {
    itemId: principal?.itemId ?? null,
    uomId: principal?.uomId ?? null,
    qty: principal?.plannedQty ?? null,
  };
}

/**
 * 🔴 EVERY PLANNED BATCH IS A CLAIM UNTIL THIS RUNS.
 *
 * `batchId` and `locationId` arrive from a browser. Postgres checks foreign keys
 * OUTSIDE row-level security, so the FK alone accepts another tenant's batch id —
 * it only rejects one that exists nowhere at all (the same trap documented on
 * `Batch.ownerPartyId`). This is the check that actually matters, and it also
 * catches the subtler error: a batch of a DIFFERENT item than the row it is
 * planned against, which would read as a plan nobody could ever issue.
 *
 * The quantity rule mirrors the Issue dialog: what the batches add up to must be
 * what the row plans to consume. A plan whose parts do not equal its whole is not
 * a plan, it is two numbers.
 */
async function assertPlannedBatches(
  tx: TenantClient,
  organizationId: string,
  rows: readonly StepRow[],
) {
  const wanted = new Map<string, PlannedBatchRow[]>();
  for (const step of rows) {
    for (const input of step.inputs) {
      if (input.plannedBatches.length === 0) continue;
      wanted.set(input.itemId, [...(wanted.get(input.itemId) ?? []), ...input.plannedBatches]);
    }
  }
  if (wanted.size === 0) return;

  const ids = [...new Set([...wanted.values()].flat().map((row) => row.batchId))];
  const batches = await tx.batch.findMany({
    // The `where` is what the query means; RLS is the net under it. Both stay.
    where: { id: { in: ids }, organizationId, isDeleted: false },
    select: { id: true, itemId: true, supplierBatchRef: true },
  });
  const byId = new Map(batches.map((batch) => [batch.id, batch]));

  /**
   * The packages named across every plan row, read in ONE query and checked
   * against the batch each was named under.
   *
   * 🔴 The same reason `postMovement` re-reads its own: a plan pointing at a
   * package of a DIFFERENT batch — or a different organization — is not a number
   * anyone can correct later, it is a row no screen can interpret. RLS is the net
   * under this; the `batchId` comparison is what the query means.
   */
  const unitIds = [
    ...new Set(
      [...wanted.values()]
        .flat()
        .map((row) => row.batchUnitId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const unitsById = new Map(
    unitIds.length === 0
      ? []
      : (
          await tx.batchUnit.findMany({
            where: { id: { in: unitIds }, organizationId, isDeleted: false },
            select: { id: true, batchId: true, label: true },
          })
        ).map((unit) => [unit.id, unit]),
  );

  for (const step of rows) {
    for (const input of step.inputs) {
      if (input.plannedBatches.length === 0) continue;

      for (const planned of input.plannedBatches) {
        const batch = byId.get(planned.batchId);
        if (!batch)
          throw ApiError.badRequest('A planned batch does not exist in this organization.');
        if (batch.itemId !== input.itemId) {
          throw ApiError.badRequest(
            `Batch ${batch.supplierBatchRef ?? 'selected'} belongs to a different item than the row it is planned against.`,
          );
        }
        if (planned.batchUnitId) {
          const unit = unitsById.get(planned.batchUnitId);
          if (!unit || unit.batchId !== planned.batchId) {
            throw ApiError.badRequest(
              `A planned unit is not in batch ${batch.supplierBatchRef ?? 'selected'}.`,
              { plannedBatches: 'A planned unit does not belong to the batch beside it.' },
            );
          }
        }
      }

      /**
       * 🔴 THE SAME PACKAGE TWICE IN ONE ROW is a typo or two rows that should
       * have been one — and since the unique index below now treats untagged rows
       * as equal too, an unchecked duplicate would fail as a 500 from Postgres
       * rather than a sentence the planner can act on.
       */
      const seen = new Set<string>();
      for (const planned of input.plannedBatches) {
        const key = `${planned.batchId}@${planned.locationId}#${planned.batchUnitId ?? ''}`;
        if (seen.has(key)) {
          const batch = byId.get(planned.batchId);
          const unit = planned.batchUnitId ? unitsById.get(planned.batchUnitId) : null;
          throw ApiError.badRequest(
            `${unit?.label ?? `Batch ${batch?.supplierBatchRef ?? 'selected'}`} is planned twice on ` +
              'one row. Combine the two into a single line.',
            { plannedBatches: 'The same batch or unit is planned twice.' },
          );
        }
        seen.add(key);
      }

      const total = roundQty(input.plannedBatches.reduce((sum, row) => sum + row.qty, 0));
      const planned = input.plannedQty ?? 0;
      if (Math.abs(total - roundQty(planned)) > 0.00005) {
        throw ApiError.badRequest(
          `Planned batches add up to ${total}, but the row plans ${planned}. They have to match.`,
          { plannedBatches: `${total} allocated against ${planned} planned.` },
        );
      }
    }
  }
}

async function writeSteps(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
  rows: readonly StepRow[],
  userId?: string,
) {
  await assertPlannedBatches(tx, organizationId, rows);
  const defs = await loadActiveDefinitions(tx, organizationId, 'job_order');
  for (const row of rows) {
    const { customFields: raw, inputs, outputs, ...scalars } = row;
    await tx.jobOrderStep.create({
      data: {
        ...scalars,
        organizationId,
        jobOrderId,
        customFields: validateCustomFields({
          defs,
          input: raw,
          mode: 'create',
        }) as Prisma.InputJsonValue,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        // Written with the step, in its transaction. `customFields` is left at
        // its default: the column exists per convention, but neither list is a
        // registered entity type (`customFields.constants.ts`), so there is
        // nothing an org could have defined to put in it.
        inputs: {
          create: inputs.map((input, index) => ({
            organizationId,
            seq: index + 1,
            itemId: input.itemId,
            uomId: input.uomId,
            plannedQty: input.plannedQty,
            tolerancePct: input.tolerancePct,
            fromStock: input.fromStock,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            /**
             * 🔴 REPLACED WHOLESALE, never soft-deleted. A plan is a statement of
             * CURRENT intent with no history worth keeping — unlike the documents
             * that move stock, where a delete destroys the audit trail. Steps are
             * already re-created on every save, so these ride along and the unique
             * key can never be occupied by a dead row (see the migration's note).
             */
            plannedBatches: {
              create: input.plannedBatches.map((planned) => ({
                organizationId,
                batchId: planned.batchId,
                batchUnitId: planned.batchUnitId ?? null,
                locationId: planned.locationId,
                qty: planned.qty,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
              })),
            },
          })),
        },
        outputs: {
          create: outputs.map((output, index) => ({
            organizationId,
            seq: index + 1,
            itemId: output.itemId,
            uomId: output.uomId,
            expectedQty: output.expectedQty,
            isPrimary: output.isPrimary,
            rate: output.rate,
            sharePct: output.sharePct,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            // The recipe, frozen with the step (§5.2): a later edit to the composite
            // never changes what this order consumes.
            components: {
              create: output.components.map((component) => ({
                organizationId,
                componentItemId: component.componentItemId,
                qtyPerUnit: component.qtyPerUnit,
                uomId: component.uomId,
                seq: component.seq,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
              })),
            },
          })),
        },
      },
    });
  }
}

function readBack(tx: TenantClient, organizationId: string, id: string) {
  return tx.jobOrder.findFirstOrThrow({
    where: { id, organizationId, isDeleted: false },
    include: JOB_ORDER_INCLUDE,
  });
}

/**
 * Edit a job order — header and steps.
 *
 * 🔴 THE LOCK IS PER STEP AND IT IS THE WORK FRONT (§6.6, 2026-08-11).
 *
 * It used to be per ORDER: the whole grid froze the moment anything was issued,
 * and the only way to correct step 5 was to short-close the order and raise
 * another. That is far stricter than the hazard warrants — a step nobody has sent
 * anything to is a plan, and a plan is editable however far along the rest of the
 * order is.
 *
 * So the line is drawn at the LAST step carrying a live challan or receipt. That
 * step and everything behind it are untouchable; everything after it is rewritten
 * exactly as a draft would be.
 *
 * 🔴 WHY THE LINE IS DRAWN THERE AND NOT AT "ANY STEP WITH NO DOCUMENTS".
 *
 * `seq` is printed on challans. Letting an untouched step BETWEEN two live ones be
 * removed or moved would renumber the live steps after it, and a challan would
 * then name a step that no longer describes it — the precise hazard `append` was
 * built append-only to avoid. Trailing steps can be renumbered freely because
 * nothing has ever pointed at them.
 *
 * 🔴 AND WHY THE PAYLOAD MUST CARRY IDS. Below the front, the request is not
 * applied at all — the stored rows are kept verbatim. The ids are how the server
 * proves the client is still looking at the same grid: two steps can run the same
 * process, so position and content could match while the order silently differs.
 *
 * The delete below is a HARD delete and stays one, for the same reason route steps
 * are: `@@unique([jobOrderId, seq])` is a full index, so a soft-deleted step holds
 * its number forever. It is safe here ONLY because it is scoped past the front,
 * where by construction no issue and no receipt exists — `JobIssue.step` and
 * `JobReceipt.step` are `onDelete: Cascade`, and running it over the whole order
 * would silently take every challan and receipt with it.
 */
export async function updateJobOrderById(
  organizationId: string,
  id: string,
  data: UpdateJobOrderInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, steps, ...header } = data;

  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Job order not found');

    // Same refusal as `append`, and for the same reason: these two are sticky, so
    // the order would keep reading as finished while its plan moved underneath.
    if (existing.status === 'short_closed' || existing.status === 'cancelled') {
      throw ApiError.conflict(
        'This job order is closed, so its steps cannot be changed. Raise a new order instead.',
      );
    }

    const existingSteps = await loadExistingSteps(tx, organizationId, id);
    const locked = lockedPrefix(existingSteps);
    // A soft-deleted step holds its `seq` inside the prefix but is invisible to
    // the client, so it is never one of the rows the payload has to account for.
    const lockedLive = locked.filter((step) => !step.isDeleted);

    assertLockedStepsUnchanged(lockedLive, steps);

    /**
     * 🔴 THE ONE FIELD A LOCKED STEP STILL TAKES: its processor. On a step it is
     * only the Issue screen's default — each challan snapshots its own processor,
     * receipts inherit theirs from the challans, and nothing costs or allocates by
     * the step's. So changing it rewrites no document already raised. Everything
     * else on a locked step stays ignored, as above. Not "Done by": switching to
     * in-house needs a work centre, which is a different destination. Not on a
     * finished step either — it takes no more challans, so there is nothing to
     * default.
     */
    for (const [index, stored] of lockedLive.entries()) {
      const sentProcessorId = steps[index]?.processorId;
      if (sentProcessorId === undefined || sentProcessorId === stored.processorId) continue;
      if (stored.processorType === 'internal') continue;
      if (stored.status === 'completed' || stored.status === 'short_closed') continue;
      const processorNameSnapshot = await resolveProcessorName(
        tx,
        organizationId,
        stored.processorType as ProcessorType,
        sentProcessorId,
      );
      await tx.jobOrderStep.updateMany({
        where: { id: stored.id, organizationId },
        data: { processorId: sentProcessorId, processorNameSnapshot, updatedBy: userId ?? null },
      });
    }

    await assertStepRefs(tx, organizationId, steps.slice(lockedLive.length));

    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'job_order');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existing.customFields,
      }) as Prisma.InputJsonValue;
    }

    // Everything past the front is rebuilt, chained onto what the locked steps
    // hand over so a new step 4 plans from step 3's expected output.
    const frontSeq = locked.at(-1)?.seq ?? 0;
    const tail = steps.slice(lockedLive.length);
    const stepRows = tail.length
      ? await buildSteps(
          tx,
          organizationId,
          tail,
          priorFrom(locked, frontSeq + 1),
          lockedLive.length,
        )
      : [];

    /**
     * 🔴 The header follows step 1 and step 1 alone (`headerItemFrom`). Once it is
     * locked the header is locked with it — recomputing from the tail would put
     * step 4's item on a document whose list page has always shown step 1's.
     */
    const headerItem = locked.length === 0 ? headerItemFrom(stepRows) : null;

    const orderDate = header.orderDate ?? existing.orderDate;
    await assertOnOrAfterMigration(tx, {
      organizationId,
      date: orderDate,
      field: 'orderDate',
      label: 'job order',
    });

    await tx.jobOrder.update({
      where: { id },
      data: {
        orderDate,
        targetDate: header.targetDate ?? null,
        ...(headerItem
          ? {
              inputItemId: headerItem.itemId,
              inputUomId: headerItem.uomId,
              inputQty: headerItem.qty,
            }
          : {}),
        remarks: header.remarks?.trim() || null,
        ...(customFields !== undefined ? { customFields } : {}),
        updatedBy: userId ?? null,
      },
    });

    await tx.jobOrderStep.deleteMany({ where: { jobOrderId: id, seq: { gt: frontSeq } } });
    if (stepRows.length) await writeSteps(tx, organizationId, id, stepRows, userId);

    // The step set changed, so the roll-up can have: dropping the only unfinished
    // step completes the order, and adding one reopens it.
    await recomputeJobOrder(tx, organizationId, id);

    return readBack(tx, organizationId, id);
  });
}

/**
 * The steps at and behind the work front — every step up to and including the last
 * one carrying a live challan or receipt.
 *
 * 🔴 It is a PREFIX, so an untouched step sitting between two live ones is locked
 * too. That is not an oversight: removing it would renumber the live steps after
 * it, and their numbers are printed on paperwork somebody is holding.
 *
 * Soft-deleted steps count toward the prefix so their `seq` is never reissued, but
 * they can never be the front themselves — nothing can have been issued against a
 * step that was removed while the order was still editable.
 */
function lockedPrefix(steps: readonly ExistingStep[]): ExistingStep[] {
  let front = -1;
  for (const [index, step] of steps.entries()) {
    if (!step.isDeleted && hasDocuments(step)) front = index;
  }
  return front < 0 ? [] : steps.slice(0, front + 1);
}

/**
 * The payload must still begin with the locked steps, in order, by id.
 *
 * Their content is never read here — the stored rows are authoritative, apart from
 * the processor, which the caller applies — so this is purely a proof that the
 * client is editing the grid it was shown. A stale form
 * that would drop or reorder a step with a challan against it is refused here
 * rather than allowed to cascade.
 */
function assertLockedStepsUnchanged(
  locked: readonly ExistingStep[],
  sent: readonly JobOrderStepInput[],
) {
  if (locked.length === 0) return;

  const conflict = (message: string) =>
    ApiError.conflict(
      `${message} Reopen the job order to see what has already been sent out, then try again.`,
    );

  if (sent.length < locked.length) {
    throw conflict(
      `The first ${locked.length} step${locked.length === 1 ? ' has' : 's have'} already been ` +
        'sent out and cannot be removed.',
    );
  }

  for (const [index, step] of locked.entries()) {
    if (sent[index]?.id === step.id) continue;
    throw conflict(
      `Step ${step.seq} (${step.processNameSnapshot}) has already been sent out, so it cannot ` +
        'be changed, moved or removed.',
    );
  }

  // A locked step repeated further down would be written a second time as a new
  // row, duplicating work that already has challans against it.
  const lockedIds = new Set(locked.map((step) => step.id));
  for (const [index, step] of sent.entries()) {
    if (index < locked.length || !step.id || !lockedIds.has(step.id)) continue;
    throw conflict('A step that has already been sent out appears twice in this order.');
  }
}

/**
 * Add work to the END of a running order — the one change a released order does
 * accept.
 *
 * 🔴 APPEND ONLY, and that is what makes it safe. `seq = max + 1` touches no
 * existing row, so nothing is renumbered and nothing is rewritten: the issues and
 * receipts already hanging off the existing steps keep pointing at steps that
 * still say what their challans say.
 *
 * It survives `updateJobOrderById` growing a partial edit (§6.6) because the two
 * answer different questions. This one adds work past the END of the grid without
 * reading what is there; that one rewrites the tail past the WORK FRONT, and has
 * to prove the client still agrees about everything before it. Appending needs no
 * such proof — there is nothing below `max + 1` to disagree about.
 *
 * 🔴 NO STEP'S STATUS IS CHECKED, deliberately. Appending after a step that is
 * pending, at a processor, or complete is the same operation each time — the new
 * step arrives `pending`, and issuing it is governed like any other step's. A
 * guard here would defend against a hazard that only exists for INSERT, which
 * renumbers.
 *
 * The ORDER's status is another matter, and there is exactly one refusal: see
 * below.
 */
export async function appendJobOrderSteps(
  organizationId: string,
  id: string,
  data: AppendJobOrderStepsInput,
  userId?: string,
) {
  const { steps, reason } = data;

  return runAsTenant(organizationId, async (tx) => {
    const order = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, status: true, remarks: true },
    });
    if (!order) throw ApiError.notFound('Job order not found');

    /**
     * 🔴 A closed order must refuse, or it becomes a document that reads as
     * finished and still takes challans: `short_closed` and `cancelled` are
     * sticky, so `recomputeJobOrder` returns early and the order keeps its label
     * forever, while the new step would happily issue.
     */
    if (order.status === 'short_closed' || order.status === 'cancelled') {
      throw ApiError.conflict(
        'This job order is closed, so no more work can be added to it. Raise a new order instead.',
      );
    }

    await assertStepRefs(tx, organizationId, steps);

    // Deleted steps included, on purpose: `@@unique([jobOrderId, seq])` is a full
    // index, so a soft-deleted step still occupies its number.
    const existing = await loadExistingSteps(tx, organizationId, id);
    const startSeq = existing.reduce((max, step) => Math.max(max, step.seq), 0) + 1;

    // What the order already produces, so the new steps classify and plan against
    // it — see `priorFrom`. Without it a new step's input reads as drawn from
    // stock when it is fed by the step above.
    const stepRows = await buildSteps(tx, organizationId, steps, priorFrom(existing, startSeq));

    // Two people appending at the same moment read the same `startSeq`. The
    // unique index catches the loser; this is what it says instead of a
    // constraint name.
    await withUniqueViolation(
      'Someone else added a step to this job order a moment ago. Reopen it and try again.',
      () => writeSteps(tx, organizationId, id, stepRows, userId),
    );

    // 🔴 The header's item and quantity are NOT recomputed. They derive from step
    // 1 (`headerItemFrom`), and an append never reaches step 1.

    // Work added to a released order is a decision somebody will need to review —
    // the same reasoning that puts the short-close reason in `remarks`.
    const seqs = stepRows.map((row) => row.seq).join(', ');
    const note =
      `Added step${stepRows.length === 1 ? '' : 's'} ${seqs}` +
      (reason ? `: ${reason.trim()}` : '');
    await tx.jobOrder.update({
      where: { id },
      data: {
        remarks: order.remarks ? `${order.remarks}\n${note}` : note,
        updatedBy: userId ?? null,
      },
    });

    // A `completed` order reopens as `in_progress` — there is a pending step on it
    // again. That is the point of the feature, not a side effect.
    await recomputeJobOrder(tx, organizationId, id);

    return readBack(tx, organizationId, id);
  });
}

export async function deleteJobOrderById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, status: true },
    });
    if (!existing) throw ApiError.notFound('Job order not found');

    // A started order has posted ledger rows behind it. Hiding it from the list
    // would leave stock at a processor that no document explains.
    if (existing.status !== 'draft') {
      throw ApiError.conflict(
        'This job order has already moved stock, so it cannot be deleted. Close it short instead.',
      );
    }

    return tx.jobOrder.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

/**
 * Close an order short: finished, and the numbers do not balance.
 *
 * This is the one status transition a human makes rather than a sum — see
 * `jobOrders.status.ts`. It is sticky, so a stray later receipt cannot quietly
 * reopen the order, and the reason is appended to `remarks` because a decision
 * with no recorded why is a decision nobody can review.
 *
 * 🔴 Every step it closes has its remainder at the processor written off first
 * (landed-cost R8), exactly as completing that step would.
 */
export async function shortCloseJobOrder(
  organizationId: string,
  id: string,
  reason: string,
  userId?: string,
) {
  return runAsDocument(organizationId, async (tx) => {
    await lockJobOrderSteps(tx, organizationId, id);
    const existing = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, status: true, remarks: true },
    });
    if (!existing) throw ApiError.notFound('Job order not found');
    if (existing.status === 'short_closed') {
      throw ApiError.conflict('This job order is already closed short.');
    }

    const note = `Closed short: ${reason.trim()}`;
    const closing = await tx.jobOrderStep.findMany({
      where: {
        organizationId,
        jobOrderId: id,
        isDeleted: false,
        status: { notIn: ['completed', 'short_closed'] },
      },
      orderBy: { seq: 'asc' },
      select: { id: true },
    });
    for (const step of closing) {
      await writeOffStep(tx, organizationId, step.id, {
        reason: `${note} — still at the processor, written off as job order loss.`,
        userId,
      });
    }

    await tx.jobOrderStep.updateMany({
      where: {
        organizationId,
        jobOrderId: id,
        isDeleted: false,
        status: { notIn: ['completed', 'short_closed'] },
      },
      data: { status: 'short_closed' },
    });

    return tx.jobOrder.update({
      where: { id },
      data: {
        status: 'short_closed',
        remarks: existing.remarks ? `${existing.remarks}\n${note}` : note,
        updatedBy: userId ?? null,
      },
    });
  });
}

/**
 * The Overview page's data, in one request.
 *
 * Everything here except the stored statuses is DERIVED — issued and received
 * totals from the child documents, stock in hand from the ledger. That is not a
 * performance compromise, it is the point: a balance that is stored is a balance
 * that can disagree with its own history (§5.6), and this page exists to be
 * believed.
 *
 * `canIssue` per step answers the question the button needs — "is there anything
 * to issue" — with the ledger, not the `batches` table. A batch goes on existing long
 * after the last metre of it has left (§10).
 */
export async function getJobOrderOverview(
  organizationId: string,
  id: string,
  filterStepId?: string,
) {
  /**
   * 🔴 TWO TRANSACTIONS SIDE BY SIDE, on two pooled connections — as before, but
   * split by weight rather than by topic, because the response waits for the
   * slower one:
   *
   *   · main    — the order and its plan, the stock balances, the chain;
   *   · figures — the step totals and the activity timeline.
   *
   * Every read is the query it was; only its connection changed. Postgres runs
   * these at READ COMMITTED, where each statement takes its own snapshot even
   * inside one transaction, so reading in two gives the same guarantee as one.
   * A step-filtered request has no timeline and stays in one transaction.
   */
  const figuresPromise = filterStepId
    ? null
    : // Outside the transaction, and before it — `memberships` has no RLS
      // policy, so this is a plain probe (`lib/memberDirectory.ts`).
      getMemberDirectory(organizationId).then((directory) =>
        runAsTenant(organizationId, async (tx) => {
          const stepRows = await tx.jobOrderStep.findMany({
            where: { organizationId, jobOrderId: id, isDeleted: false },
            select: { id: true },
          });
          const totals = await getAllStepTotals(
            tx,
            organizationId,
            stepRows.map((row) => row.id),
          );
          const { events, refs } = await buildActivity(
            tx,
            organizationId,
            id,
            directory,
            undefined,
            flowItemIds(totals),
          );
          return { totals, activity: events, refs };
        }),
      );

  const mainPromise = runAsTenant(organizationId, async (tx) => {
    const includeQuery = filterStepId
      ? {
          ...JOB_ORDER_OVERVIEW_QUERY,
          steps: {
            ...JOB_ORDER_OVERVIEW_QUERY.steps,
            where: { ...JOB_ORDER_OVERVIEW_QUERY.steps.where, id: filterStepId },
          },
        }
      : JOB_ORDER_OVERVIEW_QUERY;

    const found = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: includeQuery,
    });

    if (!found) throw ApiError.notFound('Job order not found');

    if (filterStepId) {
      found.steps = found.steps.filter((s) => s.id === filterStepId);
    }

    const planRefs = await lookupRefs(
      tx,
      organizationId,
      [
        found.inputItemId,
        ...found.steps.flatMap((s) => [...s.inputs, ...s.outputs].map((row) => row.itemId)),
      ],
      [
        found.inputUomId,
        ...found.steps.flatMap((s) => [...s.inputs, ...s.outputs].map((row) => row.uomId)),
      ],
    );
    const order = hydrateOrder(found, planRefs);

    const batches = await tx.batch.findMany({
      where: { organizationId, isDeleted: false, sourceDocId: id },
      // 🔴 No `batchNumber` (2026-08-14) — internal key, never leaves the server.
      select: { id: true, supplierBatchRef: true, itemId: true },
    });

    const principalItemIds = [
      ...new Set(order.steps.map((s) => s.inputs[0]?.itemId).filter(Boolean)),
    ] as string[];

    // Reads every step itself: a filtered overview holds one, and a warning depends
    // on the steps above it.
    const chainWarningsMap = await getChainWarnings(tx, organizationId, id);

    const balances =
      principalItemIds.length > 0
        ? await tx.stockLedgerEntry.groupBy({
            by: ['itemId'],
            where: {
              organizationId,
              itemId: { in: principalItemIds },
              ownership: order.ownership as Ownership,
            },
            _sum: { qtyIn: true, qtyOut: true },
          })
        : [];

    // Filtered: no figures transaction, so the totals are read here.
    const ownFigures = filterStepId
      ? await stepFigures(
          tx,
          organizationId,
          order.steps.map((s) => s.id),
        )
      : null;

    return { order, batches, chainWarningsMap, balances, ownFigures };
  });

  const [main, figures] = await Promise.all([mainPromise, figuresPromise]);
  const { order, batches, chainWarningsMap, balances } = main;

  let { totals: allTotalsMap, refs: flowRefs } = main.ownFigures ?? figures!;
  // A step added between the two transactions' reads has no totals yet. Read
  // just those, rather than render a step with none.
  const missing = order.steps.filter((s) => !allTotalsMap.has(s.id)).map((s) => s.id);
  if (missing.length > 0) {
    const extra = await runAsTenant(organizationId, (tx) =>
      stepFigures(tx, organizationId, missing),
    );
    allTotalsMap = new Map([...allTotalsMap, ...extra.totals]);
    flowRefs = {
      itemById: new Map([...flowRefs.itemById, ...extra.refs.itemById]),
      uomById: new Map([...flowRefs.uomById, ...extra.refs.uomById]),
    };
  }
  const activity = figures?.activity ?? [];

  const firstStep = order.steps[0];
  const firstTotals = firstStep ? allTotalsMap.get(firstStep.id) : null;

  const availableQtyMap = new Map<string, Prisma.Decimal>();
  for (const row of balances as {
    itemId: string;
    _sum: { qtyIn: Prisma.Decimal | null; qtyOut: Prisma.Decimal | null };
  }[]) {
    const inD = row._sum.qtyIn ?? new Prisma.Decimal(0);
    const outD = row._sum.qtyOut ?? new Prisma.Decimal(0);
    availableQtyMap.set(row.itemId, inD.minus(outD));
  }

  const allUnplannedIds = new Set<string>();
  for (const step of order.steps) {
    const totals = allTotalsMap.get(step.id)!;
    const planned = new Set([
      ...step.inputs.map((row) => row.itemId),
      ...step.outputs.map((row) => row.itemId),
    ]);
    for (const flow of totals.perItem) {
      if (!planned.has(flow.itemId)) allUnplannedIds.add(flow.itemId);
    }
    for (const flow of totals.perOutput) {
      if (!planned.has(flow.itemId)) allUnplannedIds.add(flow.itemId);
    }
  }

  const unplannedById = new Map<
    string,
    { name: string; stockingUom: { symbol: string | null; unitName: string } | null }
  >();
  for (const itemId of allUnplannedIds) {
    const item = flowRefs.itemById.get(itemId);
    if (!item) continue;
    const uom = item.stockingUomId ? flowRefs.uomById.get(item.stockingUomId) : undefined;
    unplannedById.set(itemId, {
      name: item.name,
      stockingUom: uom ? { symbol: uom.symbol, unitName: uom.unitName } : null,
    });
  }

  const steps = order.steps.map((step) => {
    const totals = allTotalsMap.get(step.id)!;

    // The issue button is enabled by AVAILABILITY, not by status: a step can be
    // ready on paper and have nothing to send. Measured on the PRINCIPAL input
    // — the first consumed row, which is what the step is fundamentally about.
    const principalInput = step.inputs[0] ?? null;
    let availableQty = new Prisma.Decimal(0);
    if (principalInput) {
      availableQty = availableQtyMap.get(principalInput.itemId) ?? new Prisma.Decimal(0);
    }

    const chainWarnings = chainWarningsMap.get(step.id) ?? [];

    // 🔴 Issued MINUS CONSUMED, both in the input's unit. Subtracting
    // `receivedQty` would mix metres and pieces on any step where the item
    // changes (jobOrders.status.ts).
    const issuedD = totals.issuedQty;
    const consumedD = totals.consumedQty;
    // A completed step's remainder was written off — it is no longer out (R8).
    const outstanding = issuedD.minus(consumedD).minus(totals.writtenOffQty);
    return {
      ...step,
      totals: {
        issuedQty: totals.issuedQty.toString(),
        consumedQty: totals.consumedQty.toString(),
        receivedQty: totals.receivedQty.toString(),
        acceptedQty: totals.acceptedQty.toString(),
        reworkQty: totals.reworkQty.toString(),
        scrapQty: totals.scrapQty.toString(),
        returnedQty: totals.returnedQty.toString(),
        outstandingQty: outstanding.toString(),
        writtenOffQty: totals.writtenOffQty.toString(),
        writtenOffValue: totals.writtenOffValue.toString(),
        issueCount: totals.issueCount,
        receiptCount: totals.receiptCount,
      },
      /**
       * 🔴 THE PAGE'S REAL NUMBERS (§5.7 + §6.5). The six totals above are the
       * principal input's and the primary output's; these are every item's,
       * each in its own unit, and they are what the Overview renders.
       *
       * Both lists include items the PLAN never named — a step can be issued
       * something nobody listed, and a receipt can return something nobody
       * expected. Showing only the planned rows would hide exactly the
       * movements somebody needs to look at.
       */
      itemTotals: buildItemTotals(step, totals, unplannedById),
      availableQty: availableQty.toString(),
      /**
       * Enabled whenever the step lists something to issue, NOT by the ledger:
       * the Issue screen shows what is on hand per godown, and the save refuses
       * any quantity that is not there.
       */
      canIssue: step.inputs.length > 0,
      /**
       * Inputs an earlier step produces and has not returned yet, per item
       * (`getChainWarnings`). Informational — issuing them draws on stock
       * already on hand, and nothing refuses it.
       */
      chainWarnings,
      // Visible once something is out there to come back.
      canReceive: outstanding.greaterThan(0),
    };
  });

  return {
    jobOrder: order,
    batches,
    summary: {
      issuedQty: firstTotals ? firstTotals.issuedQty.toString() : '0',
    },
    steps,
    activity,
  };
}

/** Every item a step's totals mention — the unplanned ones among them need names. */
function flowItemIds(totals: Map<string, StepTotals>): string[] {
  return [...totals.values()].flatMap((t) => [...t.perItem, ...t.perOutput].map((f) => f.itemId));
}

/** Step totals, plus names and units for every item they mention. */
async function stepFigures(tx: TenantClient, organizationId: string, stepIds: string[]) {
  const totals = await getAllStepTotals(tx, organizationId, stepIds);
  const refs = await lookupRefs(tx, organizationId, flowItemIds(totals), []);
  return { totals, refs };
}

/** The overview's order read without any item or unit — `hydrateOrder` attaches
 * those from one lookup. Derived from the include below so the two cannot drift. */
const STEP_OVERVIEW_QUERY = {
  inputs: {
    ...STEP_OVERVIEW_INCLUDE.inputs,
    include: { plannedBatches: STEP_OVERVIEW_INCLUDE.inputs.include.plannedBatches },
  },
  outputs: {
    ...STEP_OVERVIEW_INCLUDE.outputs,
    include: { components: STEP_OVERVIEW_INCLUDE.outputs.include.components },
  },
  process: STEP_OVERVIEW_INCLUDE.process,
  workCentre: STEP_OVERVIEW_INCLUDE.workCentre,
} satisfies Prisma.JobOrderStepInclude;

const JOB_ORDER_OVERVIEW_QUERY = {
  route: JOB_ORDER_OVERVIEW_INCLUDE.route,
  steps: { ...JOB_ORDER_OVERVIEW_INCLUDE.steps, include: STEP_OVERVIEW_QUERY },
} satisfies Prisma.JobOrderInclude;

type OverviewOrderRead = Prisma.JobOrderGetPayload<{ include: typeof JOB_ORDER_OVERVIEW_QUERY }>;
type OverviewOrder = Prisma.JobOrderGetPayload<{ include: typeof JOB_ORDER_OVERVIEW_INCLUDE }>;

/**
 * Put back the item and unit objects the include used to return, same fields.
 * A required item that is missing throws, as Prisma's include would; a missing
 * optional one is null, as it would be.
 */
function hydrateOrder(found: OverviewOrderRead, refs: Refs): OverviewOrder {
  const item = (itemId: string) => {
    const row = refs.itemById.get(itemId);
    if (!row) throw new Error(`Job order overview: item ${itemId} could not be read.`);
    return { id: row.id, name: row.name, sku: row.sku, inventoryTracking: row.inventoryTracking };
  };
  const uom = (uomId: string | null) => {
    const row = uomId ? refs.uomById.get(uomId) : undefined;
    return row ? { id: row.id, unitName: row.unitName, symbol: row.symbol } : null;
  };
  return {
    ...found,
    inputItem:
      found.inputItemId && refs.itemById.has(found.inputItemId) ? item(found.inputItemId) : null,
    inputUom: uom(found.inputUomId),
    steps: found.steps.map((step) => ({
      ...step,
      inputs: step.inputs.map((row) => ({ ...row, item: item(row.itemId), uom: uom(row.uomId) })),
      outputs: step.outputs.map((row) => ({ ...row, item: item(row.itemId), uom: uom(row.uomId) })),
    })),
  };
}

type StepWithRows = Prisma.JobOrderStepGetPayload<{ include: typeof STEP_OVERVIEW_INCLUDE }>;

/**
 * Merge what the step PLANNED with what has actually moved, per item.
 *
 * The plan supplies the item's name, unit and expected quantity; the totals
 * supply what really happened. An item that appears in one and not the other is
 * kept either way — a plan nothing has moved against yet is a row of zeroes, and
 * a movement nobody planned is the row most worth seeing.
 */
function buildItemTotals(
  step: StepWithRows,
  totals: StepTotals,
  unplannedById: Map<
    string,
    { name: string; stockingUom: { symbol: string | null; unitName: string } | null }
  >,
) {
  const issuedByItem = new Map<string, ItemFlow>(
    totals.perItem.map((row) => [row.itemId, row] as const),
  );
  const receivedByItem = new Map<string, OutputFlow>(
    totals.perOutput.map((row) => [row.itemId, row] as const),
  );

  const unitOf = (uom: { symbol: string | null; unitName: string } | null | undefined) =>
    uom ? (uom.symbol ?? uom.unitName) : null;

  /** Where an input's material stands (landed-cost §6.7): still at the processor,
   * on a challan a receipt closed (consumed into cost, challan-closure R10), or
   * written off as job order loss when the step was completed. */
  const atProcessor = (flow: ItemFlow | undefined) => {
    if (!flow) {
      return { stillOutQty: '0', closedQty: '0', writtenOffQty: '0', writtenOffValue: '0' };
    }
    const stillOut = flow.issuedQty.minus(flow.consumedQty).minus(flow.writtenOffQty);
    return {
      stillOutQty: stillOut.greaterThan(0) ? stillOut.toString() : '0',
      closedQty: flow.closedQty.toString(),
      writtenOffQty: flow.writtenOffQty.toString(),
      writtenOffValue: flow.writtenOffValue.toString(),
    };
  };

  /** What an output's accepted goods have landed at so far, per unit — running,
   * from every posted receipt's stored breakdown. Null until something is accepted. */
  const landedOf = (flow: OutputFlow | undefined) => ({
    acceptedQty: (flow?.acceptedQty ?? new Prisma.Decimal(0)).toString(),
    landedCostPerUnit:
      flow && flow.acceptedQty.greaterThan(0)
        ? flow.landedValue.dividedBy(flow.acceptedQty).toDecimalPlaces(4).toString()
        : null,
  });

  /**
   * 🔴 WHAT MOVED, and nothing else.
   *
   * No planned quantity, no tolerance, no consumed-versus-outstanding. The plan
   * lives on the step and — where it is actually acted on — in the Issue dialog,
   * which shows planned, already issued, remaining and the tolerance ceiling at
   * the moment somebody decides how much to send. Repeating it here is the same
   * number in a second place. The disposition split lives on the receipt, which
   * is the document that records it.
   */
  const inputs = [
    ...step.inputs.map((row) => {
      const issued = issuedByItem.get(row.itemId)?.issuedQty ?? new Prisma.Decimal(0);
      const plannedQ = row.plannedQty ?? null;
      const remainingQ = plannedQ ? new Prisma.Decimal(plannedQ).minus(issued) : null;
      return {
        itemId: row.itemId,
        itemName: row.item.name,
        uomSymbol: unitOf(row.uom),
        fromStock: row.fromStock,
        planned: true,
        plannedQty: plannedQ?.toString() ?? null,
        issuedQty: issued.toString(),
        remainingQty: remainingQ ? (remainingQ.greaterThan(0) ? remainingQ.toString() : '0') : null,
        ...atProcessor(issuedByItem.get(row.itemId)),
      };
    }),
    ...[...issuedByItem.values()]
      .filter((flow) => !step.inputs.some((row) => row.itemId === flow.itemId))
      .map((flow) => ({
        itemId: flow.itemId,
        itemName: unplannedById.get(flow.itemId)?.name ?? 'Item',
        uomSymbol: unitOf(unplannedById.get(flow.itemId)?.stockingUom),
        fromStock: true,
        planned: false,
        plannedQty: null,
        issuedQty: flow.issuedQty.toString(),
        remainingQty: null,
        ...atProcessor(flow),
      })),
  ];

  const outputs = [
    ...step.outputs.map((row) => {
      const received = receivedByItem.get(row.itemId)?.receivedQty ?? new Prisma.Decimal(0);
      const expectedQ = row.expectedQty ?? null;
      const remainingQ = expectedQ ? new Prisma.Decimal(expectedQ).minus(received) : null;
      return {
        itemId: row.itemId,
        itemName: row.item.name,
        uomSymbol: unitOf(row.uom),
        isPrimary: row.isPrimary,
        planned: true,
        expectedQty: expectedQ?.toString() ?? null,
        receivedQty: received.toString(),
        remainingQty: remainingQ ? (remainingQ.greaterThan(0) ? remainingQ.toString() : '0') : null,
        ...landedOf(receivedByItem.get(row.itemId)),
      };
    }),
    ...[...receivedByItem.values()]
      .filter((flow) => !step.outputs.some((row) => row.itemId === flow.itemId))
      .map((flow) => ({
        itemId: flow.itemId,
        itemName: unplannedById.get(flow.itemId)?.name ?? 'Item',
        uomSymbol: unitOf(unplannedById.get(flow.itemId)?.stockingUom),
        isPrimary: false,
        // A receipt may return something the plan never named. That row is the
        // one most worth seeing, so it is labelled rather than hidden.
        planned: false,
        expectedQty: null,
        receivedQty: flow.receivedQty.toString(),
        remainingQty: null,
        ...landedOf(flow),
      })),
  ];

  return { inputs, outputs };
}

/**
 * 🔴 WHAT ACTUALLY HAPPENED — every challan out and every receipt back, in the
 * order it happened, with the rows each document carried.
 *
 * The totals above answer "how much"; this answers "how". They are different
 * questions and the page needs both: a step reading `issued 4,800 / received
 * 4,650` says nothing about whether that was one delivery or four, which batches
 * it went out of, who signed for it, or that 100 of the shortfall came back as
 * rework three days later. Until this existed the only way to learn any of that
 * was to leave the page for the Issues list and lose the order's context.
 *
 * TWO QUERIES FOR THE WHOLE ORDER, not two per step. A six-step order was
 * otherwise twelve round trips on a page that already makes one `getBalance` call
 * per batch — and the client groups by `stepId` for free.
 *
 * Cancelled documents are INCLUDED, labelled by their own status. A challan that
 * went out on the 3rd and was cancelled on the 5th is a thing that happened, and
 * the ledger carries its reversal either way (§10); hiding it leaves a gap
 * between two numbers that no longer explain each other.
 *
 * 🔴 DRAFTS ARE NOT — `HAPPENED_DOC_STATUS`. This is the timeline of what the
 * order did, and a parked draft has done nothing; rendering one here would put
 * "4,800 m issued to Sunrise Dyers" against goods still standing in the godown.
 * Drafts are found on the Issues and Receipts lists, under their own filter.
 */
async function buildActivity(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
  directory: MemberDirectory,
  filterStepId?: string,
  extraItemIds: readonly string[] = [],
) {
  const unitOf = (uom: { symbol: string | null; unitName: string } | null | undefined) =>
    uom ? (uom.symbol ?? uom.unitName) : null;

  // Scalars only — names, units, batch labels and locations are read once for
  // the whole timeline below, not once per relation level.
  const issues = await tx.jobIssue.findMany({
    where: {
      organizationId,
      jobOrderId,
      isDeleted: false,
      ...(filterStepId ? { jobOrderStepId: filterStepId } : {}),
    },
    select: {
      id: true,
      jobOrderStepId: true,
      challanNumber: true,
      issueDate: true,
      status: true,
      remarks: true,
      isRework: true,
      attemptNo: true,
      totalQty: true,
      processorType: true,
      processorNameSnapshot: true,
      createdBy: true,
      createdAt: true,
      destinationLocationId: true,
      lines: {
        where: { isDeleted: false },
        select: { id: true, itemId: true, qty: true, uomId: true, batchId: true },
      },
    },
  });
  const receipts = await tx.jobReceipt.findMany({
    where: {
      organizationId,
      jobOrderId,
      isDeleted: false,
      ...(filterStepId ? { jobOrderStepId: filterStepId } : {}),
    },
    select: {
      id: true,
      jobOrderStepId: true,
      receiptNumber: true,
      receiptDate: true,
      status: true,
      remarks: true,
      totalIssuedQty: true,
      totalReturnedQty: true,
      processorType: true,
      processorNameSnapshot: true,
      createdBy: true,
      createdAt: true,
      locationId: true,
      // Only the challan each line closes — the per-line quantities are the
      // consumption side and the disposition lives on `outputs`, so carrying
      // the whole line here would be a second copy of neither.
      lines: {
        where: { isDeleted: false },
        select: { jobIssueId: true },
      },
      outputs: {
        where: { isDeleted: false },
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          itemId: true,
          receivedQty: true,
          acceptedQty: true,
          reworkQty: true,
          scrapQty: true,
          isPrimary: true,
          remarks: true,
          uomId: true,
          reasonId: true,
          // 🔴 The child table, not `outputBatch`/`reworkBatch` — those name
          // only the FIRST of each kind, and a split delivery has more.
          batches: {
            where: { isDeleted: false },
            orderBy: [{ kind: 'asc' }, { seq: 'asc' }],
            select: { kind: true, qty: true, isNewBatch: true, batchId: true },
          },
        },
      },
    },
  });

  const issueLines = issues.flatMap((issue) => issue.lines);
  const receiptOutputs = receipts.flatMap((receipt) => receipt.outputs);
  const refs = await lookupRefs(
    tx,
    organizationId,
    [
      ...issueLines.map((line) => line.itemId),
      ...receiptOutputs.map((row) => row.itemId),
      ...extraItemIds,
    ],
    [...issueLines.map((line) => line.uomId), ...receiptOutputs.map((row) => row.uomId)],
  );
  // 🔴 The LABEL, never `batchNumber` (2026-08-14) — internal key.
  const batchRefs = await namesById(
    [
      ...issueLines.map((line) => line.batchId),
      ...receiptOutputs.flatMap((row) => row.batches.map((b) => b.batchId)),
    ],
    (ids) =>
      tx.batch.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, supplierBatchRef: true },
      }),
    (row) => row.supplierBatchRef,
  );
  const locationNames = await namesById(
    [...issues.map((issue) => issue.destinationLocationId), ...receipts.map((r) => r.locationId)],
    (ids) =>
      tx.location.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
    (row) => row.name,
  );
  const reasonNames = await namesById(
    receiptOutputs.map((row) => row.reasonId),
    (ids) =>
      tx.rejectionReason.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
    (row) => row.name,
  );
  // A receipt line closes one of this order's own challans, already read above;
  // the lookup covers only a challan that list does not hold (a deleted draft).
  const challanNumbers = new Map(issues.map((issue) => [issue.id, issue.challanNumber]));
  const missingChallans = [
    ...new Set(
      receipts
        .flatMap((receipt) => receipt.lines.map((line) => line.jobIssueId))
        .filter((id): id is string => Boolean(id) && !challanNumbers.has(id!)),
    ),
  ];
  if (missingChallans.length > 0) {
    const rows = await tx.jobIssue.findMany({
      where: { organizationId, id: { in: missingChallans } },
      select: { id: true, challanNumber: true },
    });
    for (const row of rows) challanNumbers.set(row.id, row.challanNumber);
  }
  const uomOf = (uomId: string | null) => (uomId ? (refs.uomById.get(uomId) ?? null) : null);

  const issueEvents = issues.map((issue) => ({
    kind: 'issue' as const,
    id: issue.id,
    stepId: issue.jobOrderStepId,
    number: issue.challanNumber,
    date: issue.issueDate.toISOString(),
    status: issue.status,
    remarks: issue.remarks,
    partyName:
      issue.processorNameSnapshot ?? locationNames.get(issue.destinationLocationId) ?? null,
    processorType: issue.processorType,
    actorName: directory.actorName(issue.createdBy),
    isRework: issue.isRework,
    attemptNo: issue.attemptNo,
    totalQty: issue.totalQty.toString(),
    lines: issue.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemName: refs.itemById.get(line.itemId)?.name ?? 'Item',
      uomSymbol: unitOf(uomOf(line.uomId)),
      qty: line.qty.toString(),
      batchRef: batchRefs.get(line.batchId) ?? null,
    })),
    at: issue.issueDate.getTime(),
    recordedAt: issue.createdAt.getTime(),
  }));

  const receiptEvents = receipts.map((receipt) => ({
    kind: 'receipt' as const,
    id: receipt.id,
    stepId: receipt.jobOrderStepId,
    number: receipt.receiptNumber,
    date: receipt.receiptDate.toISOString(),
    status: receipt.status,
    remarks: receipt.remarks,
    partyName: receipt.processorNameSnapshot ?? locationNames.get(receipt.locationId) ?? null,
    processorType: receipt.processorType,
    actorName: directory.actorName(receipt.createdBy),
    locationName: locationNames.get(receipt.locationId) ?? null,
    consumedQty: receipt.totalIssuedQty.toString(),
    // Never entered our stock, so it has no batch and no ledger row (§6.4) —
    // which is exactly why it has to be said in words here.
    returnedQty: receipt.totalReturnedQty.toString(),
    againstChallans: [
      ...new Set(
        receipt.lines
          .map((line) => (line.jobIssueId ? challanNumbers.get(line.jobIssueId) : undefined))
          .filter(Boolean) as string[],
      ),
    ].sort(),
    outputs: receipt.outputs.map((output) => ({
      id: output.id,
      itemId: output.itemId,
      itemName: refs.itemById.get(output.itemId)?.name ?? 'Item',
      uomSymbol: unitOf(uomOf(output.uomId)),
      isPrimary: output.isPrimary,
      receivedQty: output.receivedQty.toString(),
      acceptedQty: output.acceptedQty.toString(),
      reworkQty: output.reworkQty.toString(),
      scrapQty: output.scrapQty.toString(),
      // The gate types free text now; older rows carry a reason row. One field
      // out, because the screen shows them under one heading either way.
      reason:
        (output.reasonId ? reasonNames.get(output.reasonId) : undefined) ?? output.remarks ?? null,
      batches: output.batches.map((row) => ({
        kind: row.kind,
        qty: row.qty.toString(),
        isNewBatch: row.isNewBatch,
        batchRef: batchRefs.get(row.batchId) ?? null,
      })),
    })),
    at: receipt.receiptDate.getTime(),
    recordedAt: receipt.createdAt.getTime(),
  }));

  /**
   * Oldest first — this is a story, and a story is read forwards.
   *
   * `createdAt` breaks the tie because the document dates are DATES: everything
   * raised on one day would otherwise sort arbitrarily, and a receipt printed
   * above the challan it closes reads as a receipt of goods that never left.
   */
  const events = [...issueEvents, ...receiptEvents]
    .sort((a, b) => a.at - b.at || a.recordedAt - b.recordedAt)
    .map(({ at: _at, recordedAt: _recordedAt, ...event }) => event);
  // `refs` rides back so the overview can name unplanned items (`extraItemIds`)
  // from the same lookup instead of a query of its own.
  return { events, refs };
}

const ITEM_REF_SELECT = {
  ...ROW_OVERVIEW_INCLUDE.item.select,
  stockingUomId: true,
} satisfies Prisma.ItemSelect;
type Refs = {
  itemById: Map<string, Prisma.ItemGetPayload<{ select: typeof ITEM_REF_SELECT }>>;
  uomById: Map<
    string,
    Prisma.UnitOfMeasurementGetPayload<{ select: typeof ROW_OVERVIEW_INCLUDE.uom.select }>
  >;
};

/**
 * Items and units for a whole page in two reads, where a nested include pays one
 * round trip per relation level. The units of every item read here are included,
 * so an item's stocking unit needs no third query. No `isDeleted` filter, same as
 * a relation include: a row that names a deleted item still shows its name.
 */
async function lookupRefs(
  tx: TenantClient,
  organizationId: string,
  itemIds: readonly (string | null | undefined)[],
  uomIds: readonly (string | null | undefined)[],
): Promise<Refs> {
  const wantedItems = [...new Set(itemIds.filter((id): id is string => Boolean(id)))];
  const items =
    wantedItems.length > 0
      ? await tx.item.findMany({
          where: { organizationId, id: { in: wantedItems } },
          select: ITEM_REF_SELECT,
        })
      : [];
  const wantedUoms = [
    ...new Set(
      [...uomIds, ...items.map((item) => item.stockingUomId)].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ];
  const uoms =
    wantedUoms.length > 0
      ? await tx.unitOfMeasurement.findMany({
          where: { organizationId, id: { in: wantedUoms } },
          select: ROW_OVERVIEW_INCLUDE.uom.select,
        })
      : [];
  return {
    itemById: new Map(items.map((item) => [item.id, item])),
    uomById: new Map(uoms.map((uom) => [uom.id, uom])),
  };
}

/** One read for a set of ids, skipped when there are none. */
async function namesById<Row extends { id: string }>(
  ids: readonly (string | null | undefined)[],
  read: (ids: string[]) => Promise<Row[]>,
  pick: (row: Row) => string | null,
): Promise<Map<string, string | null>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  return new Map((await read(wanted)).map((row) => [row.id, pick(row)]));
}

/** Re-derive an order's status after something downstream changed it. */
export async function refreshJobOrderStatus(organizationId: string, jobOrderId: string) {
  return runAsTenant(organizationId, (tx) => recomputeJobOrder(tx, organizationId, jobOrderId));
}

/**
 * The numbering master behind the gear beside Job Order Number — the same
 * `number_sequences` row `allocateNumber` reads at save time, so what the dialog
 * says is what the next order gets.
 */
export async function getJobOrderNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, (tx) => getNumberPreference(tx, organizationId, 'job_order'));
}

export async function updateJobOrderNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, (tx) =>
    setNumberPreference(tx, organizationId, 'job_order', prefix, nextNumber),
  );
}
