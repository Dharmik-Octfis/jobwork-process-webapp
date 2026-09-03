import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { allocateNumber } from '../../../lib/numberSequence.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
// No `createBatch` here since 2026-08-14 — an issue consumes stock, it never
// creates any. The scaffold that did was deleted with FIFO allocation.
import {
  getAvailableBatches,
  getAvailableBatchUnits,
  getBalancesByBatch,
  postMovement,
  resolveBatchesForPosting,
  type Ownership,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { assertLocationsBelongToOrg, resolveProcessorName } from '../jobwork.refs.ts';
import { SOURCE_DOC_TYPES, runAsDocument, type ProcessorType } from '../jobwork.types.ts';
import { chainNotReady, recomputeStep } from '../job-orders/jobOrders.status.ts';
import type { CreateJobIssueInput } from './jobIssues.schemas.ts';

/**
 * Issues — material leaving for a processor, and the challan it travels with.
 *
 * THREE GUARDS, AND WHAT EACH ONE PREVENTS
 *
 * 1. 🔴 OWNERSHIP. A batch may only be issued into a job order of the same
 *    ownership. Without it one customer's goods can be issued into another
 *    customer's order — processing A's material on B's job, with both stock
 *    reports wrong afterwards. Same class of failure as a missing tenant filter
 *    (§5.2).
 * 2. 🔴 AVAILABILITY, from the LEDGER. Not from `batches`, and not from a stored
 *    balance. A batch row outlives its last metre.
 * 3. 🔴 TOLERANCE. Over the ceiling, an override reason is required — never
 *    silently allowed. A breach that leaves no trace is a tolerance that does
 *    not exist.
 *
 * ⚠️ A fourth — SINGLE BATCH, from `Process.requiresSingleBatch` — was removed on
 * 2026-08-17 with the column. It ran over `resolvedLines`, i.e. AFTER FIFO
 * allocation had already split one request line across batches, so on an
 * untracked item it refused a quantity the user had no way to enter differently.
 *
 * And one rule about writes: every ledger row here goes through
 * `stockLedger.service.ts`. Nothing in this file touches `stock_ledger`.
 */

const DUPLICATE_NUMBER = 'A challan with this number already exists in this organization.';

const SEARCH_COLUMNS = ['challanNumber', 'processorNameSnapshot'] as const;

function issueListWhere(organizationId: string, opts: ListQuery): Prisma.JobIssueWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.JobIssueWhereInput>('job_issue', opts.filter),
    ...searchWhere<Prisma.JobIssueWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

const ISSUE_INCLUDE = {
  jobOrder: { select: { id: true, jobOrderNumber: true, ownership: true } },
  step: { select: { id: true, seq: true, processNameSnapshot: true, plannedInputQty: true } },
  sourceLocation: { select: { id: true, name: true } },
  destination: { select: { id: true, name: true } },
  lines: {
    where: { isDeleted: false },
    include: {
      // The item is a per-line fact now (§5.7) — the dialog groups the lines by
      // it, one section per input.
      item: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
      uom: { select: { id: true, unitName: true, symbol: true } },
      // 🔴 No `batchNumber` (2026-08-14). It is an internal key and must not leave
      // the server — a field in the payload is a field somebody renders.
      batch: { select: { id: true, supplierBatchRef: true } },
      /** Which package this line sent, when the org runs a unit level. Null on
       * the batch's untagged remainder and on every line written before it. */
      batchUnit: { select: { id: true, seq: true, label: true } },
    },
  },
} satisfies Prisma.JobIssueInclude;

export async function getJobIssuesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.jobIssue.findMany({
      where: issueListWhere(organizationId, opts),
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: ISSUE_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countJobIssues(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.jobIssue.count({ where: issueListWhere(organizationId, opts) }),
  );
}

export async function getJobIssueById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobIssue.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: ISSUE_INCLUDE,
    }),
  );
}

/** Every issue against one step — what the Overview page's "2 issues" links to. */
export async function getIssuesForStep(organizationId: string, jobOrderStepId: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobIssue.findMany({
      where: { organizationId, jobOrderStepId, isDeleted: false },
      orderBy: { issueDate: 'asc' },
      include: ISSUE_INCLUDE,
    }),
  );
}

/**
 * Where the goods are going, created if it does not exist yet.
 *
 * 🔴 AUTO-PROVISIONED ON FIRST USE, deliberately (§5.1). Goods at a processor
 * are our stock at their location — that is the whole model — so every processor
 * needs a location before anything can be sent to them. Making someone go and
 * create "Sunrise Dyers" in Settings before they can raise a challan to Sunrise
 * Dyers is a gate that teaches people to avoid the software.
 *
 * `vendorId` is set only for a vendor processor: the column is a real FK to
 * `vendors`, so a customer-processor location carries the link in its name
 * alone. That is a known asymmetry, not an oversight — the alternative is a
 * second nullable column pointing at `customers` that one query in the codebase
 * would ever read.
 */
async function resolveDestination(
  tx: TenantClient,
  organizationId: string,
  step: { processorType: string; workCentreLocationId: string | null },
  processorType: ProcessorType,
  processorId: string | null,
  processorName: string | null,
  userId?: string,
): Promise<string> {
  if (processorType === 'internal') {
    const locationId = step.workCentreLocationId;
    if (!locationId) {
      throw ApiError.badRequest(
        'This step runs in-house but has no work centre, so there is nowhere to move the material to.',
      );
    }
    return locationId;
  }

  if (!processorId || !processorName) {
    throw ApiError.badRequest('This step has no processor, so there is nobody to issue to.');
  }

  if (processorType === 'vendor') {
    const existing = await tx.location.findFirst({
      where: { organizationId, vendorId: processorId, type: 'processor', isDeleted: false },
      select: { id: true },
    });
    if (existing) return existing.id;
  } else {
    const existing = await tx.location.findFirst({
      where: { organizationId, name: processorName, type: 'processor', isDeleted: false },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  // `@@unique([organizationId, name])` — a soft-deleted location still holds its
  // name, so a processor whose location was once deleted collides here. Reviving
  // it is right: it is the same physical place, and its ledger history is
  // attached to that id.
  const revivable = await tx.location.findFirst({
    where: { organizationId, name: processorName, isDeleted: true },
    select: { id: true },
  });
  if (revivable) {
    await tx.location.update({
      where: { id: revivable.id },
      data: {
        isDeleted: false,
        type: 'processor',
        vendorId: processorType === 'vendor' ? processorId : null,
        updatedBy: userId ?? null,
      },
    });
    return revivable.id;
  }

  const created = await withUniqueViolation(
    `A location called "${processorName}" already exists but is not a processor location.`,
    () =>
      tx.location.create({
        data: {
          organizationId,
          name: processorName,
          type: 'processor',
          vendorId: processorType === 'vendor' ? processorId : null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
  );
  return created.id;
}

const ZERO = new Prisma.Decimal(0);
/** The tolerance every quantity comparison in this codebase uses — the columns'
 * own precision, so 3 x 33.3333 is not rejected for being a billionth off. */
const QTY_EPSILON = new Prisma.Decimal('0.00005');

/**
 * 🔴 Guard 3 — the tolerance ceiling, one item at a time.
 *
 * The planned quantity lives on `job_order_step_inputs` per item now (§5.7);
 * `step.plannedInputQty` is the principal input's copy of the same number and is
 * the fallback until Migration A's backfill has reached every step.
 *
 * 🔴 THE PERCENTAGE IS PER ITEM TOO, falling through to the step's. Fabric may
 * allow 3% while thread allows 25% — small quantities vary more — and one
 * percentage across three items is either too tight for one or meaningless for
 * another. `??`, never `||`: a row that says 0 means no tolerance at all and
 * must not fall through to the step's 5%.
 *
 * An item with no plan is not checked, and neither is one where nothing set a
 * percentage. "Nobody said how much thread" is not "zero thread is allowed", and
 * refusing the issue would turn a tolerance nobody set into a hard block.
 */
async function assertWithinTolerance(
  tx: TenantClient,
  organizationId: string,
  step: { id: string; tolerancePct: Prisma.Decimal | null; plannedInputQty: Prisma.Decimal | null },
  qtyByItem: ReadonlyMap<string, Prisma.Decimal>,
  overrideReason: string | null | undefined,
) {
  if (overrideReason) return;

  const inputs = await tx.jobOrderStepInput.findMany({
    where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
    orderBy: { seq: 'asc' },
    select: {
      itemId: true,
      plannedQty: true,
      tolerancePct: true,
      item: { select: { name: true } },
    },
  });
  const rowByItem = new Map(inputs.map((row) => [row.itemId, row]));
  const principalItemId = inputs[0]?.itemId;

  for (const [itemId, qty] of qtyByItem) {
    const row = rowByItem.get(itemId);
    const planned =
      row?.plannedQty ??
      (itemId === principalItemId || inputs.length === 0 ? step.plannedInputQty : null);
    if (!planned || planned.lessThanOrEqualTo(0)) continue;

    const tolerancePct = row?.tolerancePct ?? step.tolerancePct;
    if (tolerancePct === null) continue;

    const already = await tx.jobIssueLine.aggregate({
      where: {
        organizationId,
        itemId,
        isDeleted: false,
        jobIssue: {
          jobOrderStepId: step.id,
          isDeleted: false,
          isRework: false,
          status: { not: 'cancelled' },
        },
      },
      _sum: { qty: true },
    });
    const issued = already._sum.qty ?? ZERO;
    const ceiling = planned.times(new Prisma.Decimal(1).plus(tolerancePct.dividedBy(100)));
    if (issued.plus(qty).greaterThan(ceiling)) {
      const name = row?.item.name;
      throw new ApiError(
        400,
        `This would issue ${issued.plus(qty).toString()}${name ? ` of ${name}` : ''} against a ` +
          `ceiling of ${ceiling.toDecimalPlaces(4).toString()} (${planned.toString()} planned ` +
          `+ ${tolerancePct.toString()}% tolerance). Give a reason to go ahead.`,
        { toleranceOverrideReason: 'Required to issue past the tolerance ceiling.' },
      );
    }
  }
}

/** One row of the availability query — what the FIFO queue is made of. */
type AvailableRow = Awaited<ReturnType<typeof getAvailableBatches>>[number];

/** One package of one batch at one location, and what is left of it. */
type AvailableUnitRow = Awaited<ReturnType<typeof getAvailableBatchUnits>>[number];

/** A request line once its item is known. `batchId` is null when the item has no
 * stock on record — see the scaffold note in `resolveLines`. */
interface ResolvedLineItem {
  itemId: string;
  uomId: string | null;
  batchId: string | null;
  /** Which package of that batch, when the org runs a unit level. Null means the
   * batch's untagged remainder. */
  batchUnitId: string | null;
  /** The godown the client picked this row from. Null means the header's, which
   * since 2026-08-19 is the only location a line may name anyway. */
  sourceLocationId: string | null;
  qty: number;
}

/** …and once the ledger has had its say. By this point every line names a real
 * batch AND the godown it is coming out of. */
interface ResolvedIssueLine extends Omit<ResolvedLineItem, 'qty' | 'batchId'> {
  batchId: string;
  /** Where this line physically leaves from. Equal to the header's location under
   * the one-location rule; kept per line because the ledger posts from here and a
   * copy that cannot disagree is cheaper than a join that can. */
  sourceLocationId: string;
  qty: Prisma.Decimal;
}

/**
 * 🔴 WHICH ITEMS THIS CHALLAN MAY CARRY.
 *
 * A normal issue may send anything the step consumes; a rework issue may send
 * anything it produces — dyeing takes grey and returns dyed, so what goes back to
 * be redone is the DYED fabric, which does not turn into grey again (§5.7 applied
 * to the rework rule that predates it).
 *
 * The fallback to the scalar columns is the rollout bridge: a step saved before
 * Sprint 5 has no rows in either list until Migration A's backfill reaches it.
 *
 * Getting the rework side wrong is not a visible error, it is a dead end: the
 * picker queries availability for the wrong item, finds nothing, and the rework
 * cannot be sent — with the screen insisting there is no stock while the rework
 * batch sits there holding it.
 */
async function allowedItems(
  tx: TenantClient,
  organizationId: string,
  step: { id: string },
  isRework: boolean,
): Promise<{ itemId: string; uomId: string | null }[]> {
  if (isRework) {
    // Primary first: rework re-issues what this step returned, and the caller
    // treats row 0 as the principal one.
    return tx.jobOrderStepOutput.findMany({
      where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
      orderBy: [{ isPrimary: 'desc' }, { seq: 'asc' }],
      select: { itemId: true, uomId: true },
    });
  }

  return tx.jobOrderStepInput.findMany({
    where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
    orderBy: { seq: 'asc' },
    select: { itemId: true, uomId: true },
  });
}

/**
 * Check every line against what the ledger says is actually there.
 *
 * 🔴 THE AVAILABILITY QUERY RUNS ONCE PER ITEM (§5.7). A challan carries fabric,
 * thread and buttons, and each has its own batches; one query for "the step's item"
 * would find no thread and reject the line as unavailable.
 *
 */
async function resolveLines(
  tx: TenantClient,
  organizationId: string,
  lines: readonly ResolvedLineItem[],
  context: { locationId: string; ownership: Ownership; ownerPartyId: string | null },
) {
  const itemIds = new Set(lines.map((line) => line.itemId));

  /**
   * 🔴 ONE CHALLAN, ONE LOCATION — exactly the one on the header (2026-08-19).
   *
   * This REPLACED the dispatch-site rule of 2026-08-14, which resolved the
   * header's location to the root of its `parentId` chain and let the challan
   * draw from every location sharing that root. That handed the user stock from
   * a SIBLING they never named: pick Godown A and Godown B's rolls were on offer.
   *
   * The rule is now the simplest one that can be stated in a sentence — the
   * batches are the ones at the location you picked — and it is what every
   * comparable product does (Zoho's delivery challan, Tally's godown, Odoo's
   * source location). It also follows from how `Location` is modelled here:
   * every row carries its own address block, so a Location is an addressable
   * premises, and a Rule 55 challan carries one dispatched-from address.
   *
   * TWO CONSEQUENCES, BOTH DELIBERATE:
   *   - Material in a neighbouring godown needs its OWN challan, even inside one
   *     compound. More documents, but each one describes a real dispatch.
   *   - FIFO queues within this location only. Older stock next door is out of
   *     reach — correct, since it is not here — which is why the shortfall
   *     message below has to NAME the location rather than say "this site".
   *
   * Narrowing is the reversible direction: widening back to a subtree is one
   * line, and every challan raised under the old rule stays valid history.
   */
  const location = await tx.location.findFirst({
    where: { id: context.locationId, organizationId, isDeleted: false },
    select: { name: true },
  });
  const locationName = location?.name ?? 'this location';

  // Still keyed by batch AND location. One location now, but `getAvailableBatches`
  // returns rows per (batch, location) and the ledger posts from exactly that
  // pair — collapsing the key would only hide a mismatch between the two.
  const availableByKey = new Map<string, AvailableRow>();
  const keyOf = (batchId: string, locationId: string) => `${batchId}@${locationId}`;

  // Every item of the challan in one query, not one per item (2026-09-01). The
  // map is keyed by batch and location, so a flat answer indexes exactly as the
  // per-item calls did between them.
  for (const row of await getAvailableBatches(tx, {
    organizationId,
    itemIds: [...itemIds],
    locationId: context.locationId,
    ownership: context.ownership,
  })) {
    availableByKey.set(keyOf(row.batchId, row.locationId), row);
  }

  /**
   * 🔴 THE PACKAGES BEHIND THOSE BATCHES, in one grouped query for the whole
   * challan — never one per batch, and never one per line.
   *
   * Two things are read off this and they are different questions:
   *
   *   · what a NAMED package still holds, which is the quantity a line taking it
   *     must be for, because a package is atomic at issue (plan §2.3);
   *   · what is UNTAGGED in a batch here, which is the ceiling on any line that
   *     names no package. Without that second figure an untagged line passes the
   *     batch-level guard below and is then refused deep inside `postMovement` by
   *     the §2.5 invariant — a rule the user never saw, quoted at them after the
   *     screen has already accepted their entry.
   */
  const unitsByKey = new Map<string, Map<string, AvailableUnitRow>>();
  const taggedByKey = new Map<string, Prisma.Decimal>();
  if (availableByKey.size > 0) {
    for (const unit of await getAvailableBatchUnits(tx, {
      organizationId,
      batchIds: [...new Set([...availableByKey.values()].map((row) => row.batchId))],
      locationId: context.locationId,
      ownership: context.ownership,
    })) {
      const key = keyOf(unit.batchId, unit.locationId);
      const forKey = unitsByKey.get(key) ?? new Map<string, AvailableUnitRow>();
      forKey.set(unit.batchUnitId, unit);
      unitsByKey.set(key, forKey);
      taggedByKey.set(key, (taggedByKey.get(key) ?? ZERO).plus(unit.availableQty));
    }
  }

  /** What may leave a batch at a location WITHOUT naming a package. Equal to the
   * whole balance for every batch that has none, which is every batch in an org
   * that never switched the level on. */
  const untaggedAt = (key: string) =>
    (availableByKey.get(key)?.availableQty ?? ZERO).minus(taggedByKey.get(key) ?? ZERO);

  /**
   * 🔴 WHETHER A BATCH IS OPTIONAL IS THE ITEM'S DECISION, NOT THE DIALOG'S.
   *
   * `Item.inventoryTracking = 'batch'` is a promise that every metre of this item
   * can be traced to the roll it came off — that is the entire reason a dyer's
   * customer accepts a shade complaint, and the reason the same column already
   * refuses batch-less opening stock (`items.service.saveOpeningStock`). An issue
   * that skipped it would break the promise at the one moment traceability is
   * created, and the gap is unrecoverable: the goods are at the processor, and
   * nothing recorded which batch left.
   */
  const items = await tx.item.findMany({
    where: { organizationId, id: { in: [...itemIds] }, isDeleted: false },
    select: { id: true, name: true, inventoryTracking: true },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  /**
   * 🔴 THE FIFO QUEUE, PER ITEM — ordered by when the stock actually came IN.
   *
   * The key is the earliest inward ledger entry, NOT `batch.createdAt` and
   * emphatically not `batchNumber`. The row's creation time is only a proxy: a
   * receipt entered on Friday for goods that arrived on Monday creates its batch
   * on Friday, and ordering by that queues genuinely older stock behind it —
   * which is the one thing FIFO exists to prevent. `batchNumber` is worse again;
   * it carries no meaning and manual entry has been possible.
   *
   * `createdAt` remains the tie-break, for a batch with no inward row yet.
   *
   * 🔴 THE QUEUE IS THIS LOCATION'S ONLY (2026-08-19). Older material in the next
   * godown is NOT reached, because it is not what this challan is dispatching —
   * it needs its own. FIFO is a rule about the order stock leaves a place, not a
   * licence to leave from a different one.
   */
  const fifoByItem = new Map<string, AvailableRow[]>();
  if (availableByKey.size > 0) {
    const batchIds = [...new Set([...availableByKey.values()].map((row) => row.batchId))];
    const inward = await tx.stockLedgerEntry.groupBy({
      by: ['batchId'],
      where: { organizationId, batchId: { in: batchIds }, qtyIn: { gt: 0 } },
      _min: { postedAt: true },
    });
    const firstInward = new Map(inward.map((row) => [row.batchId, row._min.postedAt]));

    for (const batch of availableByKey.values()) {
      const list = fifoByItem.get(batch.itemId) ?? [];
      list.push(batch);
      fifoByItem.set(batch.itemId, list);
    }
    for (const list of fifoByItem.values()) {
      list.sort(
        (a, b) =>
          (firstInward.get(a.batchId) ?? a.createdAt).getTime() -
          (firstInward.get(b.batchId) ?? b.createdAt).getTime(),
      );
    }
  }

  /** How much each batch-at-a-location has been committed across ALL lines so far.
   * Two lines for the same untracked item draw from one queue; without this they
   * would each see the full balance and together overdraw it. Keyed by location
   * too, because the same batch in two racks has two independent balances. */
  const takenByKey = new Map<string, Prisma.Decimal>();

  const resolved: ResolvedIssueLine[] = [];

  for (const [index, line] of lines.entries()) {
    const item = itemById.get(line.itemId);

    if (!line.batchId && item?.inventoryTracking === 'batch') {
      throw new ApiError(
        400,
        `${item.name} is batch-tracked, so the batch it goes out of has to be picked. ` +
          'Pick one on the Issue screen, or add the stock first if none is on record.',
        { [`lines.${index}.batchId`]: 'Select a batch.' },
      );
    }

    /**
     * 🔴 FIFO ALLOCATION — the untracked item's whole path (2026-08-14).
     *
     * An untracked item is never offered a picker, because its batches are ledger
     * plumbing nobody is meant to identify: they carry no reference, they are not
     * searchable, and they are not rendered. So the user types a quantity and the
     * server decides which rows it comes out of, oldest first.
     *
     * ⚠️ THIS REPLACED A SCAFFOLD THAT INVENTED STOCK. Until today a batch-less
     * line CREATED a batch and posted an `opening` movement for exactly the
     * quantity being issued — a bridge from before Purchase Received existed. Left
     * in place once the picker was gated, every issue of an untracked item would
     * have minted a phantom batch and left the real stock untouched, so the
     * balance never fell. It is gone, and a shortfall is now refused outright:
     * stock that appears because somebody issued it is stock nobody received.
     *
     * One request line becomes SEVERAL resolved lines when the quantity spans
     * batches. That is why `resolved` is flat and built here rather than mapped
     * 1:1 from the request.
     */
    if (!line.batchId) {
      let remaining = new Prisma.Decimal(line.qty);
      const queue = fifoByItem.get(line.itemId) ?? [];

      for (const row of queue) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const key = keyOf(row.batchId, row.locationId);
        const already = takenByKey.get(key) ?? ZERO;
        /* 🔴 The UNTAGGED balance, not the whole one. This path serves an item
           with no picker at all, which by inheritance has no packages either — so
           the two figures are equal here today. Using the untagged one anyway
           costs nothing and means FIFO can never queue a roll it has no way to
           name, if the level ever reaches an item that also runs this path. */
        const spare = untaggedAt(key).minus(already);
        if (spare.lessThanOrEqualTo(0)) continue;

        const take = remaining.lessThan(spare) ? remaining : spare;
        takenByKey.set(key, already.plus(take));
        // Each slice still records its godown — one location now, but the ledger
        // posts from exactly here and it must not have to infer it.
        resolved.push({
          ...line,
          batchId: row.batchId,
          sourceLocationId: row.locationId,
          qty: take,
        });
        remaining = remaining.minus(take);
      }

      if (remaining.greaterThan(0)) {
        // Named in the item's own terms and AT THE LOCATION, because that is the
        // only place searched — saying "this site" would describe stock the rule
        // no longer lets this challan touch. The user never saw a batch here, so
        // an error about batches would describe machinery they have no view of.
        const onHand = queue.reduce(
          (sum, b) => sum.plus(untaggedAt(keyOf(b.batchId, b.locationId))),
          ZERO,
        );
        throw new ApiError(
          400,
          `${item?.name ?? 'This item'} has ${onHand.toString()} available at ${locationName}, ` +
            `but ${line.qty} is being issued. Issue it from the location holding it, or add the stock first.`,
          { [`lines.${index}.qty`]: `Only ${onHand.toString()} is available at ${locationName}.` },
        );
      }
      continue;
    }

    /**
     * A picked batch names its godown too. It can now only ever be the header's,
     * so this reads as a formality — but it is what makes the check below able to
     * SAY the batch is somewhere else, rather than reporting it as missing stock.
     */
    const pickedLocationId = line.sourceLocationId ?? context.locationId;

    /**
     * 🔴 ONE CHALLAN, ONE LOCATION. A Rule 55 challan carries a single
     * dispatched-from address, so goods standing anywhere else need their own
     * document.
     *
     * The commonest way to reach this is not a hand-made payload: it is the user
     * changing the source location with batches already allocated, so the dialog
     * confirms and clears that selection first. This is the guarantee under it —
     * the UI is the convenience, the 400 is the rule.
     *
     * Checked explicitly rather than left to fall through the availability lookup
     * below: that would refuse it too, but with "no stock available here", which
     * sends the user hunting for a stock problem that does not exist.
     */
    if (pickedLocationId !== context.locationId) {
      throw new ApiError(
        400,
        `One of the selected batches is not at ${locationName}. A challan goes out of one ` +
          'location, so stock standing elsewhere needs its own challan.',
        { [`lines.${index}.sourceLocationId`]: `Not at ${locationName}.` },
      );
    }

    const batch = availableByKey.get(keyOf(line.batchId, pickedLocationId));
    if (!batch) {
      // Covers all three failure modes at once — wrong tenant, wrong item, wrong
      // ownership, or simply nothing left. The picker only ever offers rows this
      // query returned, so a miss here means the payload was hand-made or the
      // stock moved while the dialog was open.
      throw ApiError.badRequest(
        'One of the selected batches has no stock available here for this item and ownership.',
      );
    }

    /**
     * 🔴 A NAMED PACKAGE IS TAKEN BY QUANTITY, NOT WHOLE — §11's open decision,
     * taken 2026-09-02.
     *
     * It was atomic first: a package went out entire, on the reasoning that a
     * roll physically travels to the processor. That is true of a full roll and
     * wrong of every part-used one — a roll already broken into is exactly the
     * one an operator sends the remainder of — so the quantity is typed on every
     * screen and checked against what the package still holds.
     *
     * The allocator needs nothing extra for it: the per-package running total
     * below already sums by (batch, location, unit), which is the same map an
     * atomic pick used. Only this comparison changed, from `=` to `≤`.
     */
    if (line.batchUnitId) {
      const unit = unitsByKey.get(keyOf(line.batchId, pickedLocationId))?.get(line.batchUnitId);
      if (!unit) {
        throw ApiError.badRequest(
          'One of the selected units is not in that batch here, or none of it is left. ' +
            'Re-open the picker so it can show what is actually available.',
          { [`lines.${index}.batchUnitId`]: 'Not available here.' },
        );
      }
      if (new Prisma.Decimal(line.qty).minus(unit.availableQty).greaterThan(QTY_EPSILON)) {
        throw new ApiError(
          400,
          `${unit.label} has ${unit.availableQty.toString()} available here, but ${line.qty} ` +
            'is being issued out of it.',
          { [`lines.${index}.qty`]: `${unit.label} holds ${unit.availableQty.toString()}.` },
        );
      }
    }

    resolved.push({
      ...line,
      batchId: line.batchId,
      sourceLocationId: batch.locationId,
      qty: new Prisma.Decimal(line.qty),
    });
  }

  /**
   * Totals checked after the lines are gathered: two lines against the same stock
   * must not each pass on their own and overdraw it together. Keyed by location
   * because the same batch in two racks holds two independent balances.
   *
   * 🔴 TWO SEPARATE SUMS NOW, not one. An untagged line and a line naming a
   * package draw on DIFFERENT pools of the same batch — the whole point of the
   * §2.5 invariant is that they cannot be added together and compared to the
   * batch total, because that comparison passes while the packages are being
   * overdrawn.
   */
  const perBatchUntagged = new Map<string, Prisma.Decimal>();
  const perUnit = new Map<string, Prisma.Decimal>();
  for (const line of resolved) {
    const key = keyOf(line.batchId, line.sourceLocationId);
    if (line.batchUnitId) {
      const unitKey = `${key}#${line.batchUnitId}`;
      perUnit.set(unitKey, (perUnit.get(unitKey) ?? ZERO).plus(line.qty));
    } else {
      perBatchUntagged.set(key, (perBatchUntagged.get(key) ?? ZERO).plus(line.qty));
    }
  }

  for (const [key, wanted] of perBatchUntagged) {
    const batch = availableByKey.get(key);
    // A batch created for this very issue is not in the availability map and needs
    // no check — it holds exactly what is about to leave it.
    if (!batch) continue;
    const spare = untaggedAt(key);
    if (wanted.greaterThan(spare)) {
      // Named by its reference, never by the internal number — an error message
      // is a user surface, and quoting a number nowhere on their screen tells
      // them nothing about which row to fix.
      const label = batch.supplierBatchRef ?? 'selected';
      // Two different failures, and telling them apart is the difference between
      // "add more stock" and "tick the rolls" — which are not the same fix.
      throw ApiError.badRequest(
        spare.equals(batch.availableQty)
          ? `Batch ${label} has ${spare.toString()} available, but ${wanted.toString()} is being issued.`
          : `Batch ${label} holds ${batch.availableQty.toString()} here, of which ` +
              `${(taggedByKey.get(key) ?? ZERO).toString()} is assigned to individual units. ` +
              `Only ${spare.toString()} can go without naming one, but ${wanted.toString()} is ` +
              'being issued. Pick the units to send instead.',
      );
    }
  }

  /** 🔴 Summed ACROSS lines, because two lines may legitimately draw on one
   * package now that a package is taken by quantity. Each on its own can fit
   * while the two together overdraw the roll, which is the whole reason this
   * check is here rather than on the line. */
  for (const [unitKey, wanted] of perUnit) {
    const [key, batchUnitId] = unitKey.split('#') as [string, string];
    const unit = unitsByKey.get(key)?.get(batchUnitId);
    if (!unit) continue;
    if (wanted.greaterThan(unit.availableQty)) {
      throw ApiError.badRequest(
        `${unit.label} has ${unit.availableQty.toString()} available, but ${wanted.toString()} ` +
          'is being issued out of it.',
      );
    }
  }

  return resolved;
}

export async function createNewJobIssue(
  organizationId: string,
  data: CreateJobIssueInput,
  userId?: string,
) {
  const { lines, ...header } = data;

  // Two ledger rows per line, and a fifty-taka challan is normal — past
  // Prisma's 5-second default (jobwork.types.ts).
  return runAsDocument(organizationId, async (tx) => {
    const step = await tx.jobOrderStep.findFirst({
      where: { id: header.jobOrderStepId, organizationId, isDeleted: false },
      include: {
        jobOrder: {
          select: {
            id: true,
            jobOrderNumber: true,
            ownership: true,
            ownerPartyId: true,
            status: true,
            isDeleted: true,
          },
        },
      },
    });
    if (!step) throw ApiError.notFound('Job order step not found');
    if (step.jobOrder.isDeleted) throw ApiError.notFound('Job order not found');
    if (step.jobOrder.status === 'cancelled' || step.jobOrder.status === 'short_closed') {
      throw ApiError.conflict(
        'This job order is closed, so nothing more can be issued against it.',
      );
    }
    const isRework = header.isRework ?? false;

    /**
     * 🔴 THE CHAIN, ENFORCED HERE AND NOT ONLY ON THE BUTTON.
     *
     * Step 2 consumes what step 1 produced, so until step 1 has returned some of
     * it there is physically nothing to send. The Overview disables the button
     * for the same reason, but a disabled button is a hint — this is the rule.
     *
     * Rework is exempt: it re-issues what this step itself returned, which by
     * definition already came back.
     */
    if (!isRework) {
      const notReady = await chainNotReady(tx, organizationId, step.jobOrderId, step);
      if (notReady) throw ApiError.conflict(notReady);
    }

    const allowed = await allowedItems(tx, organizationId, step, isRework);
    if (allowed.length === 0) {
      throw ApiError.badRequest(
        isRework
          ? 'This step has no output item, so there is nothing to send back for rework.'
          : 'This step has no issue item, so there is nothing to send.',
      );
    }

    // The first row is the principal one — the step's main input, or its primary
    // output on a rework. It is what the header records and what a line that
    // names no item of its own means.
    const principal = allowed[0]!;
    const allowedByItem = new Map(allowed.map((row) => [row.itemId, row]));
    const lineItems: ResolvedLineItem[] = lines.map((line, index) => {
      const lineItemId = line.itemId ?? principal.itemId;
      const row = allowedByItem.get(lineItemId);
      if (!row) {
        // The picker only ever offers items the step declared, so this payload
        // was hand-made — or the step was edited under an open dialog.
        throw new ApiError(
          400,
          isRework
            ? 'One of the lines is an item this step does not produce, so it cannot be sent for rework.'
            : 'One of the lines is an item this step does not consume.',
          { [`lines.${index}.itemId`]: 'Not one of this step’s items.' },
        );
      }
      return {
        itemId: lineItemId,
        uomId: row.uomId,
        batchId: line.batchId ?? null,
        batchUnitId: line.batchUnitId ?? null,
        sourceLocationId: line.sourceLocationId ?? null,
        /* Checked against the package, not trusted: a named package goes out
           WHOLE, so `resolveLines` refuses a quantity that is not the whole of
           it rather than rounding to fit. */
        qty: line.qty,
      };
    });

    await assertLocationsBelongToOrg(tx, organizationId, [
      header.sourceLocationId,
      header.destinationLocationId,
    ]);

    const processorType = (header.processorType ??
      (step.processorType as ProcessorType)) as ProcessorType;
    const processorId = header.processorId ?? step.processorId;
    const processorName = await resolveProcessorName(
      tx,
      organizationId,
      processorType,
      processorId,
    );

    const destinationLocationId =
      header.destinationLocationId ??
      (await resolveDestination(
        tx,
        organizationId,
        step,
        processorType,
        processorId,
        processorName,
        userId,
      ));

    if (destinationLocationId === header.sourceLocationId) {
      /**
       * The commonest way to reach this: the source picked was the PROCESSOR's
       * own location. It appears in the source list as soon as anything has been
       * sent there — goods at a processor are our stock at their location (§5.4)
       * — so "issue from Global Inc to Global Inc" is one careless click away.
       * The dialog now drops that option; the message says which one it was.
       */
      const at = await tx.location.findFirst({
        where: { id: destinationLocationId, organizationId },
        select: { name: true },
      });
      throw ApiError.badRequest(
        `${processorName ?? 'This processor'} is already holding the material at ${at?.name ?? 'that location'}. ` +
          'Issue it from the godown it is going out of, not from where it already is.',
      );
    }

    const ownership = step.jobOrder.ownership as Ownership;
    const resolvedLines = await resolveLines(tx, organizationId, lineItems, {
      locationId: header.sourceLocationId,
      ownership,
      ownerPartyId: step.jobOrder.ownerPartyId,
    });

    const qtyByItem = new Map<string, Prisma.Decimal>();
    for (const line of resolvedLines) {
      qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? ZERO).plus(line.qty));
    }
    const totalQty = [...qtyByItem.values()].reduce((acc, qty) => acc.plus(qty), ZERO);

    // 🔴 Guard 3 — tolerance, PER ITEM against that item's own planned quantity
    // (§5.7). One ceiling for the whole challan would compare 12 cones of thread
    // against a plan written in metres of fabric.
    //
    // Rework is excluded on purpose: a second attempt at the same 200 m is not
    // 200 m of over-issue, and counting it as such would block every rework the
    // first time a step ran to plan.
    // Always asked, even when the step names no tolerance: an input row may
    // carry its own, and the step-level null is only the fallback.
    if (!isRework) {
      await assertWithinTolerance(
        tx,
        organizationId,
        step,
        qtyByItem,
        header.toleranceOverrideReason,
      );
    }

    // The attempt number counts REWORK passes at this step. A first rework is
    // attempt 2, which is what the challan has to say for the processor to know
    // which consignment this is.
    let attemptNo = 1;
    if (isRework) {
      const previous = await tx.jobIssue.count({
        where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
      });
      attemptNo = previous + 1;
    }

    const processorSnapshot = await snapshotProcessor(
      tx,
      organizationId,
      processorType,
      processorId,
    );

    const challanNumber = await allocateNumber(tx, organizationId, 'job_issue');
    const issueDate = header.issueDate ?? new Date();

    const issue = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.jobIssue.create({
        data: {
          organizationId,
          jobOrderId: step.jobOrderId,
          jobOrderStepId: step.id,
          challanNumber,
          issueDate,
          processorType,
          processorId: processorId ?? null,
          processorNameSnapshot: processorName,
          processorAddressSnapshot: processorSnapshot.address,
          processorGstinSnapshot: processorSnapshot.gstin,
          sourceLocationId: header.sourceLocationId,
          destinationLocationId,
          isRework,
          attemptNo,
          totalQty,
          toleranceOverrideReason: header.toleranceOverrideReason?.trim() || null,
          remarks: header.remarks?.trim() || null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
    );

    // Two posts per line, both against the line's own batch — so the batch rows
    // are read once for the whole challan rather than twice per taka.
    const issuedBatches = await resolveBatchesForPosting(
      tx,
      organizationId,
      resolvedLines.map((line) => line.batchId),
    );

    /**
     * 🔴 Every line's opening balance in ONE read per source location — one, under
     * the one-location rule — where this was a `getBalance` per line (2026-09-01).
     *
     * Grouped by location rather than assuming the header's, because a line
     * carries its own `sourceLocationId` on purpose: the ledger posts from that
     * pair, and a copy that cannot disagree is the point of keeping it.
     */
    const balanceKey = (batchId: string, locationId: string) => `${batchId}@${locationId}`;
    const batchIdsByLocation = new Map<string, string[]>();
    for (const line of resolvedLines) {
      batchIdsByLocation.set(line.sourceLocationId, [
        ...(batchIdsByLocation.get(line.sourceLocationId) ?? []),
        line.batchId,
      ]);
    }
    const balances = new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const [locationId, batchIds] of batchIdsByLocation) {
      const atLocation = await getBalancesByBatch(tx, { organizationId, locationId, batchIds });
      for (const [batchId, balance] of atLocation) {
        balances.set(balanceKey(batchId, locationId), balance);
      }
    }

    for (const line of resolvedLines) {
      const created = await tx.jobIssueLine.create({
        data: {
          organizationId,
          jobIssueId: issue.id,
          // 🔴 The item lives HERE (§5.7). Every per-item total downstream —
          // tolerance, step completion, the Overview — reads this column.
          itemId: line.itemId,
          uomId: line.uomId,
          batchId: line.batchId,
          // Three packages of one batch are three lines, as three batches are.
          batchUnitId: line.batchUnitId,
          // The godown this line actually left — the header's, under the
          // one-location rule. Written per line because the ledger and every
          // stock-by-location read join through here, not through the header.
          sourceLocationId: line.sourceLocationId,
          qty: line.qty,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      /**
       * 🔴 TWO ROWS PER LINE, never one signed row: out of the godown, in at the
       * processor. The value travels with the quantity so the goods carry their
       * cost to where they physically are — a per-location valuation that only
       * moved quantity would report our material at the dyer's as worthless.
       */
      // 🔴 Valued at the godown it is leaving, not the header's. Cost per unit is
      // a per-location figure — the same batch can sit in two racks at different
      // values once transfers have moved parts of it around.
      const key = balanceKey(line.batchId, line.sourceLocationId);
      const batchValue = balances.get(key) ?? { qty: ZERO, value: ZERO };
      const unitValue = batchValue.qty.greaterThan(0)
        ? batchValue.value.dividedBy(batchValue.qty)
        : new Prisma.Decimal(0);
      const lineValue = unitValue.times(line.qty).toDecimalPlaces(4);

      const out = await postMovement(
        tx,
        {
          organizationId,
          batchId: line.batchId,
          batchUnitId: line.batchUnitId,
          locationId: line.sourceLocationId,
          movementType: 'transfer_out',
          qtyOut: line.qty,
          valueOut: lineValue,
          sourceDocType: SOURCE_DOC_TYPES.jobIssue,
          sourceDocId: issue.id,
          sourceDocLineId: created.id,
          postedAt: issueDate,
          userId,
        },
        issuedBatches,
      );

      /* 🔴 What a SECOND line on this batch at this godown would have re-read —
         two lines may legitimately draw on one batch, which is why the overdraw
         guard above sums per (batch, location). Only the `transfer_out` moves
         this balance; the `transfer_in` below lands somewhere else. Taken from
         the row written, because `postMovement` zeroes value on customer-owned
         stock (§5.3). */
      balances.set(key, {
        qty: batchValue.qty.minus(out.qtyOut),
        value: batchValue.value.minus(out.valueOut),
      });
      await postMovement(
        tx,
        {
          organizationId,
          batchId: line.batchId,
          batchUnitId: line.batchUnitId,
          locationId: destinationLocationId,
          movementType: 'transfer_in',
          qtyIn: line.qty,
          valueIn: lineValue,
          sourceDocType: SOURCE_DOC_TYPES.jobIssue,
          sourceDocId: issue.id,
          sourceDocLineId: created.id,
          postedAt: issueDate,
          userId,
        },
        issuedBatches,
      );
    }

    await recomputeStep(tx, organizationId, step.id);

    return tx.jobIssue.findFirstOrThrow({
      where: { id: issue.id, organizationId },
      include: ISSUE_INCLUDE,
    });
  });
}

/**
 * The party details the challan prints. Frozen at save (§2.4) — Sunrise Dyers
 * moves premises in October and August's challan must still show the address the
 * goods actually went to.
 *
 * 🔴 GSTIN comes back null today, and the column exists anyway. Neither `vendors`
 * nor `customers` carries one yet, but a jobwork challan is a GST document and
 * the number belongs on the printed copy — adding the column later is a
 * migration, while back-filling what a challan SHOULD have said in August is
 * impossible. The moment a `gstin` column lands on either party, this function is
 * the only thing that changes.
 */
async function snapshotProcessor(
  tx: TenantClient,
  organizationId: string,
  processorType: ProcessorType,
  processorId: string | null | undefined,
): Promise<{ address: string | null; gstin: string | null }> {
  if (!processorId || processorType === 'internal') return { address: null, gstin: null };

  if (processorType === 'vendor') {
    const vendor = await tx.vendor.findFirst({
      where: { id: processorId, organizationId, isDeleted: false },
      select: { addresses: { where: { isDeleted: false }, take: 1 } },
    });
    return {
      address: vendor?.addresses[0] ? formatAddress(vendor.addresses[0]) : null,
      gstin: null,
    };
  }

  const customer = await tx.customer.findFirst({
    where: { id: processorId, organizationId, isDeleted: false },
    select: { addresses: { where: { isDeleted: false }, take: 1 } },
  });
  return {
    address: customer?.addresses[0] ? formatAddress(customer.addresses[0]) : null,
    gstin: null,
  };
}

/** One printable blob. Never parsed back out — see the schema comment on
 * `processorAddressSnapshot`. */
function formatAddress(address: {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  country?: string | null;
}): string {
  return [
    address.street1,
    address.street2,
    address.city,
    address.state,
    address.pinCode,
    address.country,
  ]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(', ');
}

/**
 * Cancel a challan: post the opposite of everything it posted, then flip it.
 *
 * 🔴 The original rows are NOT deleted and NOT edited. That is the only legal
 * shape of a correction in this system (inventory.prisma), and it is what keeps
 * "this went out on the 3rd and was cancelled on the 5th" answerable at all.
 */
export async function cancelJobIssue(
  organizationId: string,
  id: string,
  reason: string,
  userId?: string,
) {
  // A cancellation posts one reversing row for every row the challan posted, so
  // it is exactly as big as the challan was.
  return runAsDocument(organizationId, async (tx) => {
    const issue = await tx.jobIssue.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: { lines: { where: { isDeleted: false } } },
    });
    if (!issue) throw ApiError.notFound('Challan not found');
    if (issue.status === 'cancelled') throw ApiError.conflict('This challan is already cancelled.');

    const received = await tx.jobReceiptLine.aggregate({
      where: { organizationId, jobIssueId: id, isDeleted: false },
      _sum: { receivedQty: true },
    });
    if ((received._sum.receivedQty ?? new Prisma.Decimal(0)).greaterThan(0)) {
      throw ApiError.conflict(
        'Goods have already been received against this challan, so it cannot be cancelled. ' +
          'Correct it with a receipt instead.',
      );
    }

    // Every line reverses two rows against its own batch, and a challan carries the
    // same few batches — so they are read once for the cancellation, not twice a line.
    const reversedBatches = await resolveBatchesForPosting(
      tx,
      organizationId,
      issue.lines.map((line) => line.batchId),
    );

    /**
     * Everything this challan posted, in ONE read — this was a `findMany` per
     * line (2026-09-01).
     *
     * Reversal pairs: back out of the processor, back in at the source. Value is
     * not recomputed — the reversal must undo exactly what was posted, and a
     * fresh valuation would leave a residue behind.
     */
    const postedRows = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId,
        sourceDocLineId: { in: issue.lines.map((line) => line.id) },
        movementType: { not: 'reversal' },
      },
      // Ordered so the reversals are written in the order the originals were.
      // The per-line reads left this to the planner.
      orderBy: { createdAt: 'asc' },
      select: {
        sourceDocLineId: true,
        /**
         * 🔴 THE COLUMN THIS PATH MOST EASILY FORGETS, AND THE WORST TO MISS.
         *
         * Every reversal below copies its identity off the row it undoes. Leave
         * this out and the reversals post as UNTAGGED: the batch's balance comes
         * back perfectly correct, so nothing on any screen looks wrong, while
         * every roll this challan sent stays at the processor forever with an
         * untagged surplus beside it at the godown. No error, no warning, and no
         * way to notice until somebody asks where a roll went.
         *
         * `jobIssues.batchUnits.test.ts` fails the moment this is dropped.
         */
        batchUnitId: true,
        locationId: true,
        qtyIn: true,
        qtyOut: true,
        valueIn: true,
        valueOut: true,
      },
    });
    const postedByLine = new Map<string, typeof postedRows>();
    for (const row of postedRows) {
      // `sourceDocLineId` is nullable on the ledger, but the `in` filter above
      // already means every row here carries one.
      if (!row.sourceDocLineId) continue;
      postedByLine.set(row.sourceDocLineId, [
        ...(postedByLine.get(row.sourceDocLineId) ?? []),
        row,
      ]);
    }

    const now = new Date();
    for (const line of issue.lines) {
      for (const row of postedByLine.get(line.id) ?? []) {
        await postMovement(
          tx,
          {
            organizationId,
            batchId: line.batchId,
            // Off the ROW being replayed, not off the line. They agree today, and
            // taking it from the row is what keeps a reversal an exact undo of
            // what was posted rather than a fresh derivation that can drift.
            batchUnitId: row.batchUnitId,
            locationId: row.locationId,
            movementType: 'reversal',
            qtyIn: row.qtyOut,
            qtyOut: row.qtyIn,
            valueIn: row.valueOut,
            valueOut: row.valueIn,
            sourceDocType: SOURCE_DOC_TYPES.jobIssue,
            sourceDocId: issue.id,
            sourceDocLineId: line.id,
            remarks: `Cancelled: ${reason.trim()}`,
            postedAt: now,
            userId,
          },
          reversedBatches,
        );
      }
    }

    const updated = await tx.jobIssue.update({
      where: { id },
      data: {
        status: 'cancelled',
        remarks: issue.remarks
          ? `${issue.remarks}\nCancelled: ${reason.trim()}`
          : `Cancelled: ${reason.trim()}`,
        updatedBy: userId ?? null,
      },
    });

    await recomputeStep(tx, organizationId, issue.jobOrderStepId);
    return updated;
  });
}
