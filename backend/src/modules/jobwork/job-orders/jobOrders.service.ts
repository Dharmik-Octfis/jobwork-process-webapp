import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import {
  allocateNumber,
  getNumberPreference,
  reserveSuppliedNumber,
  setNumberPreference,
} from '../../../lib/numberSequence.ts';
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
import { chainNotReady, getStepTotals, recomputeJobOrder } from './jobOrders.status.ts';
import type { ItemFlow, OutputFlow, StepTotals } from './jobOrders.status.ts';
import type {
  AppendJobOrderStepsInput,
  CreateJobOrderInput,
  JobOrderStepInput,
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
  item: { select: { id: true, name: true, sku: true, lotTracking: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
};

const STEP_INCLUDE = {
  // 🔴 The bill of materials (§5.7). Ordered by seq, because the first input is
  // the principal one — what the step is fundamentally about — and every screen
  // renders it first.
  inputs: { where: { isDeleted: false }, orderBy: { seq: 'asc' }, include: ROW_INCLUDE },
  outputs: { where: { isDeleted: false }, orderBy: { seq: 'asc' }, include: ROW_INCLUDE },
  process: {
    select: { id: true, name: true, code: true, preservesPackaging: true, requiresSingleLot: true },
  },
  issueItem: { select: { id: true, name: true, sku: true, lotTracking: true } },
  receiveItem: { select: { id: true, name: true, sku: true, lotTracking: true } },
  issueUom: { select: { id: true, unitName: true, symbol: true } },
  receiveUom: { select: { id: true, unitName: true, symbol: true } },
  workCentre: { select: { id: true, name: true } },
} satisfies Prisma.JobOrderStepInclude;

const JOB_ORDER_INCLUDE = {
  inputItem: { select: { id: true, name: true, sku: true, lotTracking: true } },
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
 * A client that sends neither list gets exactly what Sprints 1–4 gave it: one
 * input, one output, both from the scalars. That is what lets this ship before
 * the step grid grows its nested lists, and it is why the scalars survive until
 * Migration B.
 *
 * 🔴 WHAT IS SENT IS WHAT IS SAVED. Nothing is inferred from the step above, and
 * nothing from the process's `itemChanges` flag. Both inferences read well on
 * paper and were unusable on screen: the grid had to render a row nobody had
 * typed, labelled "automatic", and the honest question that produced was "so
 * what actually goes into the database?" — which is not a question a form should
 * leave anyone asking. The client seeds those rows visibly instead, where they
 * can be seen, changed, or deleted before saving.
 *
 * The one derivation left is the scalar `issueItemId` / `receiveItemId`, for a
 * client that has not grown the nested grids. That is the rollout bridge; it
 * goes with Migration B.
 *
 * 🔴 The header no longer contributes an item either (2026-08-07). It used to
 * prepend `inputItemId` to step 1, back when a job order named one item and one
 * quantity — which a step consuming a SET cannot be described by. What the order
 * runs on is simply what step 1 lists.
 */
function resolveStepRows(
  step: JobOrderStepInput,
  index: number,
): { inputs: StepInputRow[]; outputs: StepOutputRow[] } {
  const sent = step.inputs ?? [];
  const inputs: StepInputRow[] = sent.length
    ? [...sent]
    : step.issueItemId
      ? [{ itemId: step.issueItemId, uomId: step.issueUomId ?? null }]
      : [];

  const sentOutputs = step.outputs ?? [];
  const outputs: StepOutputRow[] = sentOutputs.length
    ? [...sentOutputs]
    : step.receiveItemId
      ? [{ itemId: step.receiveItemId, uomId: step.receiveUomId ?? null, isPrimary: true }]
      : [];

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
 * 🔴 THE CHAIN IS A CLASSIFICATION NOW, NOT A RULE (§6.4).
 *
 * It used to reject a step whose input was not the previous step's output. Since
 * §5.7 that is false by design: thread and buttons come from the godown, not
 * from the operation above, and a rule that refuses them refuses most real
 * steps. So each input is instead LABELLED — fed by an earlier step, or drawn
 * from stock — and saved either way.
 *
 * One thing still fails: an input produced ONLY by a LATER step. That is an
 * ordering mistake with no valid reading, and it is cheap to catch here rather
 * than as an empty lot picker at issue time.
 *
 * The honest cost of the change: a mistyped chain now surfaces at issue time as
 * "no stock of Dyed Fabric at Main Godown" — later than before, but on the
 * screen where somebody can act on it.
 */
function classifyStepInputs(
  steps: readonly { resolvedInputs: ResolvedInput[]; resolvedOutputs: ResolvedOutput[] }[],
  itemNames: ReadonlyMap<string, string>,
  /**
   * Items produced by steps that already exist on the order and are NOT in
   * `steps` — the append path (§append). Everything here ran before everything
   * being built, so an input matching one is chain-fed and cannot possibly be
   * "produced only by a later step".
   */
  producedEarlier: ReadonlySet<string> = new Set(),
) {
  const producedAt = new Map<string, number[]>();
  for (const [index, step] of steps.entries()) {
    for (const output of step.resolvedOutputs) {
      const seen = producedAt.get(output.itemId) ?? [];
      seen.push(index);
      producedAt.set(output.itemId, seen);
    }
  }

  for (const [index, step] of steps.entries()) {
    for (const [rowIndex, input] of step.resolvedInputs.entries()) {
      if (producedEarlier.has(input.itemId)) {
        input.fromStock = false;
        continue;
      }
      const producers = producedAt.get(input.itemId) ?? [];
      if (producers.some((at) => at < index)) {
        input.fromStock = false;
        continue;
      }
      const later = producers.find((at) => at > index);
      if (later !== undefined) {
        const name = itemNames.get(input.itemId) ?? 'That item';
        throw new ApiError(
          400,
          `Step ${index + 1} consumes ${name}, which is only produced by step ${later + 1}. ` +
            'Material cannot come from a step that has not run yet — reorder the steps.',
          {
            [`steps.${index}.inputs.${rowIndex}.itemId`]: `Produced by step ${later + 1}, which runs after this one.`,
          },
        );
      }
      input.fromStock = true;
    }
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
 * LOT's unit into the ledger whatever the document says. So a step carrying a
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
 * Plan the quantities — 🔴 PER ITEM, because there is no single number that
 * covers metres, cones and pieces at once (§5.7).
 *
 * Every quantity is typed on its own row. An input fed by an earlier step falls
 * back to what that step is expected to produce; an input drawn FROM STOCK gets
 * nothing, because how much thread a run needs is a bill of materials this system
 * does not hold and a guessed number would read as an estimate somebody made.
 *
 * The primary output is expected to yield planned × expected yield, or the same
 * quantity when no yield is declared — "no expectation recorded" is not "expect
 * nothing". A by-product gets nothing for the same reason thread does.
 *
 * 🔴 This is a PLAN, computed once and stored, and it is never used as a
 * conversion factor at receipt time (§6.3). What actually comes back is measured,
 * not derived.
 */
function planQuantities(steps: ResolvedStep[], seeded: ReadonlyMap<string, number> = new Map()) {
  // What the nearest earlier step expects to produce of each item. Seeded on the
  // append path with what the steps ALREADY on the order expect to produce.
  const producedQty = new Map<string, number>(seeded);

  return steps.map((step) => {
    const resolvedInputs = step.resolvedInputs.map((row, rowIndex) => {
      // `plannedInputQty` seeds the principal row only, and only for a client
      // that has not grown the per-item boxes. It goes with Migration B.
      const seeded = rowIndex === 0 ? (step.plannedInputQty ?? null) : null;
      const plannedQty =
        row.plannedQty ?? seeded ?? (row.fromStock ? null : (producedQty.get(row.itemId) ?? null));
      return { ...row, plannedQty };
    });

    const principal = resolvedInputs[0] ?? null;
    const resolvedOutputs = step.resolvedOutputs.map((row) => ({
      ...row,
      expectedQty:
        row.expectedQty ??
        (row.isPrimary && principal?.plannedQty != null
          ? principal.plannedQty * (step.expectedYield ?? 1)
          : null),
    }));

    for (const row of resolvedOutputs) {
      if (row.expectedQty !== null) producedQty.set(row.itemId, row.expectedQty);
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
  await assertItemsBelongToOrg(tx, organizationId, [
    ...steps.map((s) => s.issueItemId),
    ...steps.map((s) => s.receiveItemId),
    ...rows.map((row) => row.itemId),
  ]);
  await assertUomsBelongToOrg(tx, organizationId, [
    ...steps.map((s) => s.issueUomId),
    ...steps.map((s) => s.receiveUomId),
    ...rows.map((row) => row.uomId),
  ]);
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
  /** …and how much of each is expected, so a new step can plan from it. */
  producedQty: ReadonlyMap<string, number>;
  /** `seq` of the first new step. `1` everywhere except append. */
  startSeq: number;
}

const NO_PRIOR_STEPS: PriorSteps = {
  producedItemIds: new Set(),
  producedQty: new Map(),
  startSeq: 1,
};

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
      })),
      resolvedOutputs: flagPrimaryOutput(outputs, index),
    });
  }

  // One query for every item any step touches. The units below are then the
  // items' own rather than an org-wide guess off the process master, and the
  // names make the ordering error below name the item somebody typed.
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
        select: { id: true, name: true, stockingUomId: true },
      })
    : [];
  const stockingUomByItem = new Map(chainItems.map((item) => [item.id, item.stockingUomId]));
  const itemNames = new Map(chainItems.map((item) => [item.id, item.name]));

  const withUnits = resolved.map((step) => ({
    ...step,
    resolvedInputs: applyRowUnits(step.resolvedInputs, stockingUomByItem),
    resolvedOutputs: applyRowUnits(step.resolvedOutputs, stockingUomByItem),
  }));

  classifyStepInputs(withUnits, itemNames, prior.producedItemIds);

  const planned = planQuantities(withUnits, prior.producedQty);

  const rows = [];
  for (const [index, step] of planned.entries()) {
    const processorType = (step.processorType ?? 'vendor') as ProcessorType;
    const principalInput = step.resolvedInputs[0] ?? null;
    const primaryOutput = step.resolvedOutputs.find((row) => row.isPrimary) ?? null;
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
      // 🔴 The four scalars are now a PROJECTION of the lists — the principal
      // input and the primary output. They are still written because the Issue
      // dialog, the receipt prefill and the Overview page read them, and they
      // stop being written when Migration B drops them (plan §12.1).
      issueItemId: principalInput?.itemId ?? null,
      issueUomId: principalInput?.uomId ?? null,
      receiveItemId: primaryOutput?.itemId ?? null,
      receiveUomId: primaryOutput?.uomId ?? null,
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

async function writeSteps(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
  rows: readonly StepRow[],
  userId?: string,
) {
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
        // Written with the step, in its transaction. `custom_fields` is left at
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
 * 🔴 Only while it is still `draft`. Once a step has issued anything, the rate,
 * the processor and the planned quantity are on a challan somebody is holding,
 * and the issue documents already reference the step by id. Rewriting the grid
 * underneath them would leave a challan describing work its own step no longer
 * describes. Sending the order back to draft is not offered either: the way to
 * change a released order is to short-close it and raise another.
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
    if (existing.status !== 'draft') {
      throw ApiError.conflict(
        'This job order has already started, so its steps cannot be changed. ' +
          'Close it short and raise a new one instead.',
      );
    }

    await assertStepRefs(tx, organizationId, steps);

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

    const stepRows = await buildSteps(tx, organizationId, steps);
    const headerItem = headerItemFrom(stepRows);

    await tx.jobOrder.update({
      where: { id },
      data: {
        orderDate: header.orderDate ?? existing.orderDate,
        targetDate: header.targetDate ?? null,
        inputItemId: headerItem.itemId,
        inputUomId: headerItem.uomId,
        inputQty: headerItem.qty,
        remarks: header.remarks?.trim() || null,
        ...(customFields !== undefined ? { customFields } : {}),
        updatedBy: userId ?? null,
      },
    });

    // Hard-replaced, like route steps and for the same reason: `@@unique([jobOrderId,
    // seq])` is a full index, so a soft-deleted step would hold its seq forever.
    // Safe ONLY because the guard above proved nothing references these yet — no
    // issue and no receipt can exist against a draft order.
    await tx.jobOrderStep.deleteMany({ where: { jobOrderId: id } });
    await writeSteps(tx, organizationId, id, stepRows, userId);

    return readBack(tx, organizationId, id);
  });
}

/**
 * Add work to the END of a running order — the one change a released order does
 * accept.
 *
 * 🔴 APPEND ONLY, and that is what makes it safe. `seq = max + 1` touches no
 * existing row, so nothing is renumbered and nothing is rewritten: the issues and
 * receipts already hanging off the existing steps keep pointing at steps that
 * still say what their challans say. Contrast `updateJobOrderById`, which
 * hard-deletes the whole grid and can only ever run on a draft — `JobIssue.step`
 * and `JobReceipt.step` are `onDelete: Cascade`, so doing that to a running order
 * would silently delete every challan and receipt and orphan their ledger rows.
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
    const existing = await tx.jobOrderStep.findMany({
      where: { organizationId, jobOrderId: id },
      select: {
        seq: true,
        isDeleted: true,
        outputs: { where: { isDeleted: false }, select: { itemId: true, expectedQty: true } },
      },
    });
    const startSeq = existing.reduce((max, step) => Math.max(max, step.seq), 0) + 1;

    /**
     * What the order ALREADY produces, so the new steps classify and plan against
     * it. Without this the new step's input reads as drawn from stock when it is
     * fed by the step above, and — worse — `classifyStepInputs` would be free to
     * throw "produced only by a later step" at an item an existing step really
     * does produce.
     *
     * Expected, not received. What actually came back is measured at receipt time
     * and never derived (§6.3); this is a plan, and it stays typed-over-able.
     */
    const producedItemIds = new Set<string>();
    const producedQty = new Map<string, number>();
    for (const step of existing) {
      if (step.isDeleted) continue;
      for (const output of step.outputs) {
        producedItemIds.add(output.itemId);
        if (output.expectedQty !== null) {
          producedQty.set(output.itemId, Number(output.expectedQty));
        }
      }
    }

    const stepRows = await buildSteps(tx, organizationId, steps, {
      producedItemIds,
      producedQty,
      startSeq,
    });

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
 * to issue" — with the ledger, not the `lots` table. A lot goes on existing long
 * after the last metre of it has left (§10).
 */
export async function getJobOrderOverview(organizationId: string, id: string) {
  return runAsTenant(organizationId, async (tx) => {
    const order = await tx.jobOrder.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: JOB_ORDER_INCLUDE,
    });
    if (!order) throw ApiError.notFound('Job order not found');

    const lots = await tx.lot.findMany({
      where: { organizationId, isDeleted: false, sourceDocId: id },
      select: { id: true, lotNumber: true, supplierLotRef: true, itemId: true },
    });

    // In hand = this order's own lots, wherever they physically are — including
    // at a processor, because goods at a processor are still our stock (§5.4).
    let inHandQty = new Prisma.Decimal(0);
    let inHandValue = new Prisma.Decimal(0);
    for (const lot of lots) {
      const balance = await getBalance(tx, { organizationId, lotId: lot.id });
      inHandQty = inHandQty.plus(balance.qty);
      inHandValue = inHandValue.plus(balance.value);
    }

    const steps = [];
    for (const step of order.steps) {
      const totals = await getStepTotals(tx, organizationId, step.id);

      // The issue button is enabled by AVAILABILITY, not by status: a step can be
      // ready on paper and have nothing to send.
      let availableQty = new Prisma.Decimal(0);
      if (step.issueItemId) {
        const balance = await getBalance(tx, {
          organizationId,
          itemId: step.issueItemId,
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
         * loop untestable. The Issue dialog creates a zero-valued lot for an
         * item with no stock and says so on screen (`jobIssues.service.ts`).
         *
         * 🔴 Restore `availableQty.greaterThan(0)` the day Purchase Received
         * lands. Issuing what you do not have is a real defect, not a feature.
         *
         * The ONE thing the scaffold does not relax is the chain — see
         * `blockedReason` below.
         */
        canIssue: (step.inputs.length > 0 || Boolean(step.issueItemId)) && !blockedReason,
        /**
         * 🔴 A STEP FED BY AN EARLIER ONE CANNOT ISSUE UNTIL THAT STEP DELIVERS.
         *
         * Step 2 consumes what step 1 produced. If step 1 has returned nothing,
         * there is physically nothing to send — and the no-stock scaffold would
         * otherwise happily invent a lot of dyed fabric nobody ever dyed, which
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
      if (step.receiveUomId && step.receiveUomId !== step.issueUomId) continue;
      const issued = new Prisma.Decimal(step.totals.issuedQty);
      const received = new Prisma.Decimal(step.totals.receivedQty);
      const returned = new Prisma.Decimal(step.totals.returnedQty);
      wastageIssued = wastageIssued.plus(issued);
      wastageLost = wastageLost.plus(issued.minus(received).minus(returned));
    }

    return {
      jobOrder: order,
      lots,
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
    ...step.inputs.map((row) => ({
      itemId: row.itemId,
      itemName: row.item.name,
      uomSymbol: unitOf(row.uom),
      fromStock: row.fromStock,
      planned: true,
      issuedQty: (issuedByItem.get(row.itemId)?.issuedQty ?? new Prisma.Decimal(0)).toString(),
    })),
    ...[...issuedByItem.values()]
      .filter((flow) => !step.inputs.some((row) => row.itemId === flow.itemId))
      .map((flow) => ({
        itemId: flow.itemId,
        itemName: unplannedById.get(flow.itemId)?.name ?? 'Item',
        uomSymbol: unitOf(unplannedById.get(flow.itemId)?.stockingUom),
        fromStock: true,
        // 🔴 Rework sends the OUTPUT item back out against the same step, so it
        // lands here without ever having been a planned input. That is not an
        // anomaly and the page should not present it as one — it is just work
        // going round again.
        planned: false,
        issuedQty: flow.issuedQty.toString(),
      })),
  ];

  const outputs = [
    ...step.outputs.map((row) => ({
      itemId: row.itemId,
      itemName: row.item.name,
      uomSymbol: unitOf(row.uom),
      isPrimary: row.isPrimary,
      planned: true,
      receivedQty: (
        receivedByItem.get(row.itemId)?.receivedQty ?? new Prisma.Decimal(0)
      ).toString(),
    })),
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
        receivedQty: flow.receivedQty.toString(),
      })),
  ];

  return { inputs, outputs };
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
