import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import {
  allocateNumber,
  getNumberPreference,
  reserveSuppliedNumber,
  setNumberPreference,
} from '../../../lib/numberSequence.ts';
import { getMemberDirectory, type MemberDirectory } from '../../../lib/memberDirectory.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import { getBalance, type Ownership } from '../../inventory/stock-ledger/stockLedger.service.ts';
import {
  assertItemsBelongToOrg,
  assertLocationsBelongToOrg,
  assertProcessesBelongToOrg,
  assertUomsBelongToOrg,
  resolveProcessorName,
} from '../jobwork.refs.ts';
import { runAsDocument, type ProcessorType } from '../jobwork.types.ts';
import { chainNotReady, getStepTotals, recomputeJobOrder, recomputeStep } from './jobOrders.status.ts';
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

const SEARCH_COLUMNS = ['jobOrderNumber', 'routeNameSnapshot', 'remarks'] as const;

function jobOrderListWhere(organizationId: string, opts: ListQuery): Prisma.JobOrderWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.JobOrderWhereInput>('job_order', opts.filter),
    ...searchWhere<Prisma.JobOrderWhereInput>(opts.search, [...SEARCH_COLUMNS]),
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

export async function getJobOrdersList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.jobOrder.findMany({
      where: jobOrderListWhere(organizationId, opts),
      // Newest first: a job order list is a work queue, not a directory.
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: JOB_ORDER_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countJobOrders(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.jobOrder.count({ where: jobOrderListWhere(organizationId, opts) }),
  );
}

export async function getJobOrderById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: JOB_ORDER_INCLUDE,
    }),
  );
}

interface ResolvedInput {
  itemId: string;
  uomId: string | null;
  plannedQty: number | null;
  /** Null falls through to the step's at issue time — never defaulted here, or
   * "not set" and "no tolerance at all" become the same value. */
  tolerancePct: number | null;
  fromStock: boolean;
  /** The planner's batch note. Empty for every untracked item and for anyone who
   * simply did not fill it in — see `JobOrderStepInputBatch`. */
  plannedBatches: PlannedBatchRow[];
}

interface ResolvedOutput {
  itemId: string;
  uomId: string | null;
  expectedQty: number | null;
  isPrimary: boolean;
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
 * The rest is unchanged from when the chain stopped being a rule: the real gate
 * is positional and lives at issue time (`chainNotReady`), where a step cannot
 * send anything until the step above it has returned something, and a mistyped
 * chain surfaces there as "no stock of Dyed Fabric at Main Godown" — later than
 * a save-time error, but on the screen where somebody can act on it.
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
 * Fill each step's blanks from the Process master — the last link of the default
 * chain (§2.5), running Process → route step → job order step → document.
 *
 * `??`, never `||`. A tolerance of 0 means "no tolerance at all" and must not
 * fall through to the process's 2%; a rate of 0 means free-of-charge and must
 * not be replaced either. The distinction between "unset" and "zero" is the
 * whole reason these columns are nullable.
 *
 * The items are NOT set here — they are two lists now (`resolveStepRows`), and
 * the units that follow them cannot be known until every step's items are. See
 * `applyRowUnits`.
 */
function applyStepDefaults(
  step: JobOrderStepInput,
  process: {
    name: string;
    rateBasis: string;
    defaultTolerancePct: Prisma.Decimal | null;
  },
): JobOrderStepInput & { processNameSnapshot: string } {
  return {
    ...step,
    processNameSnapshot: process.name,
    rateBasis: step.rateBasis ?? (process.rateBasis as JobOrderStepInput['rateBasis']),
    tolerancePct:
      step.tolerancePct ??
      (process.defaultTolerancePct === null ? null : Number(process.defaultTolerancePct)),
  };
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
 * rows — and the hard gates stay where the domain already put them: position, at
 * issue time (`chainNotReady`), and real stock availability in the ledger.
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
    const resolvedOutputs = step.resolvedOutputs.map((row) => ({
      ...row,
      expectedQty:
        row.expectedQty ?? derivedExpectedQty(row, principal, step.expectedYield ?? null),
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
      inputs: {
        where: { isDeleted: false },
        select: { itemId: true, plannedQty: true, fromStock: true },
      },
      outputs: { where: { isDeleted: false }, select: { itemId: true, expectedQty: true } },
      _count: {
        select: {
          issues: { where: { isDeleted: false, status: { not: 'cancelled' } } },
          receipts: { where: { isDeleted: false, status: { not: 'cancelled' } } },
        },
      },
    },
  });
}

export async function manuallyCompleteStep(
  organizationId: string,
  jobOrderId: string,
  stepId: string,
  userId: string | undefined,
) {
  return withUniqueViolation('Order already closed or not found', async () =>
    runAsTenant(organizationId, async (tx) => {
      const step = await tx.jobOrderStep.findFirst({
        where: { id: stepId, jobOrderId, organizationId, isDeleted: false },
        select: { id: true, status: true },
      });
      if (!step) throw ApiError.notFound('Step not found.');
      if (step.status === 'completed' || step.status === 'short_closed') {
        throw ApiError.conflict('Step is already completed or closed short.');
      }

      await tx.jobOrderStep.update({
        where: { id: step.id },
        data: {
          isCompleted: true,
          updatedBy: userId,
        },
      });

      await recomputeStep(tx, organizationId, step.id);
      return getJobOrderOverview(organizationId, jobOrderId);
    }),
  );
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

async function buildSteps(
  tx: TenantClient,
  organizationId: string,
  steps: readonly JobOrderStepInput[],
  prior: PriorSteps = NO_PRIOR_STEPS,
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
      rateBasis: true,
      itemChanges: true,
      defaultTolerancePct: true,
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
    const { inputs, outputs } = resolveStepRows(step, index);

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
      resolvedOutputs: flagPrimaryOutput(outputs, index),
    });
  }

  // One query for every item any step touches, so the units below are the items'
  // own rather than an org-wide guess off the process master. Names are not
  // selected: nothing on this path renders one any more.
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
        select: { id: true, stockingUomId: true },
      })
    : [];
  const stockingUomByItem = new Map(chainItems.map((item) => [item.id, item.stockingUomId]));

  const withUnits = resolved.map((step) => ({
    ...step,
    resolvedInputs: applyRowUnits(step.resolvedInputs, stockingUomByItem),
    resolvedOutputs: applyRowUnits(step.resolvedOutputs, stockingUomByItem),
  }));

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
      rate: step.rate ?? null,
      rateBasis: step.rateBasis ?? null,
      expectedYield: step.expectedYield ?? null,
      tolerancePct: step.tolerancePct ?? null,
      plannedInputQty: step.plannedInputQty,
      remarks: step.remarks?.trim() || null,
      customFields: step.customFields,
      inputs: step.resolvedInputs,
      outputs: step.resolvedOutputs,
    });
  }
  return rows;
}

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

    const created = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.jobOrder.create({
        data: {
          organizationId,
          jobOrderNumber,
          orderDate: header.orderDate ?? new Date(),
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
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
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
      ? await buildSteps(tx, organizationId, tail, priorFrom(locked, frontSeq + 1))
      : [];

    /**
     * 🔴 The header follows step 1 and step 1 alone (`headerItemFrom`). Once it is
     * locked the header is locked with it — recomputing from the tail would put
     * step 4's item on a document whose list page has always shown step 1's.
     */
    const headerItem = locked.length === 0 ? headerItemFrom(stepRows) : null;

    await tx.jobOrder.update({
      where: { id },
      data: {
        orderDate: header.orderDate ?? existing.orderDate,
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
 * Their content is never read — the stored rows are authoritative — so this is
 * purely a proof that the client is editing the grid it was shown. A stale form
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
 * step arrives `pending` and `chainNotReady` already refuses to let it issue until
 * the step above it has returned something. A guard here would defend against a
 * hazard that only exists for INSERT, which renumbers.
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
     * finished and still takes challans. Two mechanisms combine: `short_closed`
     * and `cancelled` are sticky, so `recomputeJobOrder` returns early and the
     * order keeps its label forever; and `chainNotReady` waives the chain when
     * the step above is short-closed, so the new step would happily issue.
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
 */
export async function shortCloseJobOrder(
  organizationId: string,
  id: string,
  reason: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, status: true, remarks: true },
    });
    if (!existing) throw ApiError.notFound('Job order not found');
    if (existing.status === 'short_closed') {
      throw ApiError.conflict('This job order is already closed short.');
    }

    const note = `Closed short: ${reason.trim()}`;
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
export async function getJobOrderOverview(organizationId: string, id: string) {
  // Outside the transaction, and before it — `memberships` has no RLS policy, so
  // this is a plain probe, and taking it here keeps it off a second pooled
  // connection held open by the tenant tx (`lib/memberDirectory.ts`).
  const directory = await getMemberDirectory(organizationId);

  return runAsTenant(organizationId, async (tx) => {
    const order = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: JOB_ORDER_INCLUDE,
    });
    if (!order) throw ApiError.notFound('Job order not found');

    const batches = await tx.batch.findMany({
      where: { organizationId, isDeleted: false, sourceDocId: id },
      // 🔴 No `batchNumber` (2026-08-14) — internal key, never leaves the server.
      select: { id: true, supplierBatchRef: true, itemId: true },
    });

    // In hand = this order's own batches, wherever they physically are — including
    // at a processor, because goods at a processor are still our stock (§5.4).
    let inHandQty = new Prisma.Decimal(0);
    let inHandValue = new Prisma.Decimal(0);
    for (const batch of batches) {
      const balance = await getBalance(tx, { organizationId, batchId: batch.id });
      inHandQty = inHandQty.plus(balance.qty);
      inHandValue = inHandValue.plus(balance.value);
    }

    const steps = [];
    for (const step of order.steps) {
      const totals = await getStepTotals(tx, organizationId, step.id);

      // The issue button is enabled by AVAILABILITY, not by status: a step can be
      // ready on paper and have nothing to send. Measured on the PRINCIPAL input
      // — the first consumed row, which is what the step is fundamentally about.
      const principalInput = step.inputs[0] ?? null;
      let availableQty = new Prisma.Decimal(0);
      if (principalInput) {
        const balance = await getBalance(tx, {
          organizationId,
          itemId: principalInput.itemId,
          ownership: order.ownership as Ownership,
        });
        availableQty = balance.qty;
      }

      const blockedReason = await chainNotReady(tx, organizationId, order.id, step);

      // 🔴 Issued MINUS CONSUMED, both in the input's unit. Subtracting
      // `receivedQty` would mix metres and pieces on any step where the item
      // changes (jobOrders.status.ts).
      const outstanding = totals.issuedQty.minus(totals.consumedQty);
      steps.push({
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
        itemTotals: await buildItemTotals(tx, organizationId, step, totals),
        availableQty: availableQty.toString(),
        /**
         * ⚠️ TEMPORARY — enabled whenever the step has something to issue, NOT
         * by the ledger.
         *
         * It used to require a positive balance, which is the right rule and
         * will be again. Material In was retired before Purchase Received and
         * Opening Stock exist, so today there is no way to put stock on the
         * books at all — and a button that can never light up makes the whole
         * loop untestable. The Issue dialog creates a zero-valued batch for an
         * item with no stock and says so on screen (`jobIssues.service.ts`).
         *
         * 🔴 Restore `availableQty.greaterThan(0)` the day Purchase Received
         * lands. Issuing what you do not have is a real defect, not a feature.
         *
         * The ONE thing the scaffold does not relax is the chain — see
         * `blockedReason` below.
         */
        canIssue: step.inputs.length > 0 && !blockedReason,
        /**
         * 🔴 A STEP FED BY AN EARLIER ONE CANNOT ISSUE UNTIL THAT STEP DELIVERS.
         *
         * Step 2 consumes what step 1 produced. If step 1 has returned nothing,
         * there is physically nothing to send — and the no-stock scaffold would
         * otherwise happily invent a batch of dyed fabric nobody ever dyed, which
         * is the one thing it must never do. Raw material can be conjured while
         * Purchase Received is missing; work in progress cannot.
         *
         * Items drawn from stock are unaffected: thread comes from the godown,
         * not from the operation above.
         */
        blockedReason,
        // Visible once something is out there to come back.
        canReceive: outstanding.greaterThan(0),
      });
    }

    const firstStep = order.steps[0];
    const firstTotals = firstStep ? await getStepTotals(tx, organizationId, firstStep.id) : null;

    /**
     * Wastage across CLOSED steps only, and only where the units allow it.
     *
     * Two exclusions, each for its own reason:
     *
     *   - A step still out at the dyer has issued everything and received
     *     nothing, so including it would report 100% wastage on every order the
     *     moment it starts.
     *
     *   - 🔴 A step where the OUTPUT UNIT DIFFERS FROM THE INPUT UNIT is skipped
     *     entirely. "How much was lost" is `issued − received`, and 4,800 metres
     *     minus 2,850 pieces is not a quantity — it is the conversion the whole
     *     domain refuses to make (§5.1). A number here would be worse than no
     *     number, because somebody would act on it.
     */
    let wastageIssued = new Prisma.Decimal(0);
    let wastageLost = new Prisma.Decimal(0);
    for (const step of steps) {
      if (step.status !== 'completed' && step.status !== 'short_closed') continue;
      // 🔴 Read off the LISTS since the scalars went (2026-08-12): the principal
      // input's unit against the primary output's. Comparing nulls would make
      // every unit-changing step pass this test and report nonsense wastage.
      const inputUomId = step.inputs[0]?.uomId ?? null;
      const outputUomId = (step.outputs.find((row) => row.isPrimary) ?? step.outputs[0])?.uomId;
      if (outputUomId && outputUomId !== inputUomId) continue;
      const issued = new Prisma.Decimal(step.totals.issuedQty);
      const received = new Prisma.Decimal(step.totals.receivedQty);
      const returned = new Prisma.Decimal(step.totals.returnedQty);
      wastageIssued = wastageIssued.plus(issued);
      wastageLost = wastageLost.plus(issued.minus(received).minus(returned));
    }

    return {
      jobOrder: order,
      batches,
      activity: await buildActivity(tx, organizationId, id, directory),
      summary: {
        issuedQty: firstTotals ? firstTotals.issuedQty.toString() : '0',
        inHandQty: inHandQty.toString(),
        inHandValue: inHandValue.toString(),
        wastagePct: wastageIssued.greaterThan(0)
          ? wastageLost.dividedBy(wastageIssued).times(100).toDecimalPlaces(2).toString()
          : null,
        // Cost per unit of what is actually still here. Derived every time; there
        // is no stored cost column and there will not be one (§9.1).
        costPerUnit: inHandQty.greaterThan(0)
          ? inHandValue.dividedBy(inHandQty).toDecimalPlaces(4).toString()
          : null,
      },
      steps,
    };
  });
}

type StepWithRows = Prisma.JobOrderStepGetPayload<{ include: typeof STEP_INCLUDE }>;

/**
 * Merge what the step PLANNED with what has actually moved, per item.
 *
 * The plan supplies the item's name, unit and expected quantity; the totals
 * supply what really happened. An item that appears in one and not the other is
 * kept either way — a plan nothing has moved against yet is a row of zeroes, and
 * a movement nobody planned is the row most worth seeing.
 */
async function buildItemTotals(
  tx: TenantClient,
  organizationId: string,
  step: StepWithRows,
  totals: StepTotals,
) {
  const issuedByItem = new Map<string, ItemFlow>(
    totals.perItem.map((row) => [row.itemId, row] as const),
  );
  const receivedByItem = new Map<string, OutputFlow>(
    totals.perOutput.map((row) => [row.itemId, row] as const),
  );

  // One query for anything moved but never planned, so those rows can still be
  // named on screen instead of rendering as a bare id.
  const planned = new Set([
    ...step.inputs.map((row) => row.itemId),
    ...step.outputs.map((row) => row.itemId),
  ]);
  const unplannedIds = [...new Set([...issuedByItem.keys(), ...receivedByItem.keys()])].filter(
    (itemId) => !planned.has(itemId),
  );
  const unplanned =
    unplannedIds.length > 0
      ? await tx.item.findMany({
          where: { id: { in: unplannedIds }, organizationId },
          select: {
            id: true,
            name: true,
            stockingUom: { select: { symbol: true, unitName: true } },
          },
        })
      : [];
  const unplannedById = new Map<string, (typeof unplanned)[number]>(
    unplanned.map((item) => [item.id, item] as const),
  );

  const unitOf = (uom: { symbol: string | null; unitName: string } | null | undefined) =>
    uom ? (uom.symbol ?? uom.unitName) : null;

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
 */
async function buildActivity(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
  directory: MemberDirectory,
) {
  const unitOf = (uom: { symbol: string | null; unitName: string } | null | undefined) =>
    uom ? (uom.symbol ?? uom.unitName) : null;

  const [issues, receipts] = await Promise.all([
    tx.jobIssue.findMany({
      where: { organizationId, jobOrderId, isDeleted: false },
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
        processorNameSnapshot: true,
        createdBy: true,
        createdAt: true,
        destination: { select: { name: true } },
        lines: {
          where: { isDeleted: false },
          select: {
            id: true,
            itemId: true,
            qty: true,
            item: { select: { name: true } },
            uom: { select: { symbol: true, unitName: true } },
            // 🔴 The LABEL, never `batchNumber` (2026-08-14) — internal key.
            batch: { select: { supplierBatchRef: true } },
          },
        },
      },
    }),
    tx.jobReceipt.findMany({
      where: { organizationId, jobOrderId, isDeleted: false },
      select: {
        id: true,
        jobOrderStepId: true,
        receiptNumber: true,
        receiptDate: true,
        status: true,
        remarks: true,
        totalIssuedQty: true,
        totalReturnedQty: true,
        processorNameSnapshot: true,
        createdBy: true,
        createdAt: true,
        location: { select: { name: true } },
        // Only the challan each line closes — the per-line quantities are the
        // consumption side and the disposition lives on `outputs`, so carrying
        // the whole line here would be a second copy of neither.
        lines: {
          where: { isDeleted: false },
          select: { jobIssue: { select: { challanNumber: true } } },
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
            item: { select: { name: true } },
            uom: { select: { symbol: true, unitName: true } },
            reason: { select: { name: true } },
            // 🔴 The child table, not `outputBatch`/`reworkBatch` — those name
            // only the FIRST of each kind, and a split delivery has more.
            batches: {
              where: { isDeleted: false },
              orderBy: [{ kind: 'asc' }, { seq: 'asc' }],
              select: {
                kind: true,
                qty: true,
                isNewBatch: true,
                batch: { select: { supplierBatchRef: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const issueEvents = issues.map((issue) => ({
    kind: 'issue' as const,
    id: issue.id,
    stepId: issue.jobOrderStepId,
    number: issue.challanNumber,
    date: issue.issueDate.toISOString(),
    status: issue.status,
    remarks: issue.remarks,
    partyName: issue.processorNameSnapshot ?? issue.destination?.name ?? null,
    actorName: directory.actorName(issue.createdBy),
    isRework: issue.isRework,
    attemptNo: issue.attemptNo,
    totalQty: issue.totalQty.toString(),
    lines: issue.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemName: line.item?.name ?? 'Item',
      uomSymbol: unitOf(line.uom),
      qty: line.qty.toString(),
      batchRef: line.batch?.supplierBatchRef ?? null,
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
    partyName: receipt.processorNameSnapshot ?? null,
    actorName: directory.actorName(receipt.createdBy),
    locationName: receipt.location?.name ?? null,
    consumedQty: receipt.totalIssuedQty.toString(),
    // Never entered our stock, so it has no batch and no ledger row (§6.4) —
    // which is exactly why it has to be said in words here.
    returnedQty: receipt.totalReturnedQty.toString(),
    againstChallans: [
      ...new Set(
        receipt.lines.map((line) => line.jobIssue?.challanNumber).filter(Boolean) as string[],
      ),
    ].sort(),
    outputs: receipt.outputs.map((output) => ({
      id: output.id,
      itemId: output.itemId,
      itemName: output.item?.name ?? 'Item',
      uomSymbol: unitOf(output.uom),
      isPrimary: output.isPrimary,
      receivedQty: output.receivedQty.toString(),
      acceptedQty: output.acceptedQty.toString(),
      reworkQty: output.reworkQty.toString(),
      scrapQty: output.scrapQty.toString(),
      // The gate types free text now; older rows carry a reason row. One field
      // out, because the screen shows them under one heading either way.
      reason: output.reason?.name ?? output.remarks ?? null,
      batches: output.batches.map((row) => ({
        kind: row.kind,
        qty: row.qty.toString(),
        isNewBatch: row.isNewBatch,
        batchRef: row.batch?.supplierBatchRef ?? null,
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
  return [...issueEvents, ...receiptEvents]
    .sort((a, b) => a.at - b.at || a.recordedAt - b.recordedAt)
    .map(({ at: _at, recordedAt: _recordedAt, ...event }) => event);
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
