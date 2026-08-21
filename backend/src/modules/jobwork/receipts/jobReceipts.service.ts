import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { allocateNumber } from '../../../lib/numberSequence.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import {
  createBatch,
  getBalance,
  getBalancesByBatchAndLocation,
  postMovement,
  type Ownership,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import {
  assertItemsBelongToOrg,
  assertLocationsBelongToOrg,
  assertUomsBelongToOrg,
} from '../jobwork.refs.ts';
import { SOURCE_DOC_TYPES, isExternalLocation, runAsDocument } from '../jobwork.types.ts';
import { recomputeStep } from '../job-orders/jobOrders.status.ts';
import type {
  CreateJobReceiptInput,
  JobReceiptLineInput,
  JobReceiptOutputInput,
} from './jobReceipts.schemas.ts';

/**
 * Receipts — goods back from a processor, and the only place an output batch is
 * born.
 *
 * WHAT ONE SAVE DOES, IN ORDER
 *
 *   1. consumes the input at the PROCESSOR's location  (movementType `consume`)
 *   2. creates the output batch, with `parentBatchIds` = the batches consumed
 *   3. produces the output at OUR location             (movementType `produce`)
 *   4. creates a SEPARATE rework batch when anything needs redoing
 *   5. recomputes the step and the job order
 *
 * 🔴 SCRAP GETS NO OUTPUT ROW AND THAT IS THE COSTING MODEL (§5.5). The input it
 * consumed is gone, and its share of the cost stays inside the batch that
 * survived — so the good pieces carry the true cost of the failures. Creating a
 * zero-value scrap batch instead would make the accepted pieces look cheaper than
 * they were, which is exactly the number nobody should be quoting from.
 *
 * 🔴 RETURNED GOODS GET NO ROW AT ALL (§6.4). Handed back at the gate, never
 * ours, never in stock. A row for them would create quantity that was never
 * physically here.
 *
 * 🔴 YIELD IS AN OBSERVATION, NEVER A FACTOR (§6.3). Nothing in this file
 * multiplies anything by `expectedYield`. What came back is what was measured.
 */

const DUPLICATE_NUMBER = 'A receipt with this number already exists in this organization.';
const ZERO = new Prisma.Decimal(0);

const SEARCH_COLUMNS = ['receiptNumber', 'processorNameSnapshot'] as const;

function receiptListWhere(organizationId: string, opts: ListQuery): Prisma.JobReceiptWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.JobReceiptWhereInput>('job_receipt', opts.filter),
    ...searchWhere<Prisma.JobReceiptWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

const RECEIPT_INCLUDE = {
  jobOrder: { select: { id: true, jobOrderNumber: true, ownership: true } },
  step: {
    select: {
      id: true,
      seq: true,
      processNameSnapshot: true,
      expectedYield: true,
      rate: true,
      rateBasis: true,
    },
  },
  location: { select: { id: true, name: true } },
  outputBatch: { select: { id: true, supplierBatchRef: true } },
  reworkBatch: { select: { id: true, supplierBatchRef: true } },
  /** The CONSUMPTION record — one row per challan line this receipt closes. */
  lines: {
    where: { isDeleted: false },
    include: {
      reason: { select: { id: true, name: true } },
      jobIssue: { select: { id: true, challanNumber: true } },
      jobIssueLine: { select: { id: true, item: { select: { id: true, name: true } } } },
    },
  },
  /** 🔴 What came back, one row per item (§5.7). The row flagged `isPrimary` is
   * the one the header's six totals describe. */
  outputs: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      item: { select: { id: true, name: true, sku: true } },
      uom: { select: { id: true, unitName: true, symbol: true } },
      reason: { select: { id: true, name: true } },
      outputBatch: { select: { id: true, supplierBatchRef: true } },
      reworkBatch: { select: { id: true, supplierBatchRef: true } },
      /** 🔴 The complete list — the two columns above name only the first of each
       * kind, and a split delivery has more. */
      batches: {
        where: { isDeleted: false },
        orderBy: [{ kind: 'asc' }, { seq: 'asc' }],
        select: {
          id: true,
          kind: true,
          qty: true,
          isNewBatch: true,
          batch: { select: { id: true, supplierBatchRef: true } },
        },
      },
    },
  },
} satisfies Prisma.JobReceiptInclude;

export async function getJobReceiptsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.jobReceipt.findMany({
      where: receiptListWhere(organizationId, opts),
      orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: RECEIPT_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countJobReceipts(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.jobReceipt.count({ where: receiptListWhere(organizationId, opts) }),
  );
}

export async function getJobReceiptById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: RECEIPT_INCLUDE,
    }),
  );
}

export async function getReceiptsForStep(organizationId: string, jobOrderStepId: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.jobReceipt.findMany({
      where: { organizationId, jobOrderStepId, isDeleted: false },
      orderBy: { receiptDate: 'asc' },
      include: RECEIPT_INCLUDE,
    }),
  );
}

/**
 * What the Receive dialog needs before anyone types anything: the open challans
 * and what is still outstanding on each.
 *
 * The rows are GENERATED, not entered (§6.2). Asking someone to re-key quantities
 * they already keyed on the challan is how the two lists stop matching.
 */
export async function getReceivePrefill(organizationId: string, jobOrderStepId: string) {
  return runAsTenant(organizationId, async (tx) => {
    const step = await tx.jobOrderStep.findFirst({
      where: { id: jobOrderStepId, organizationId, isDeleted: false },
      include: {
        process: { select: { id: true, name: true } },
        jobOrder: { select: { id: true, jobOrderNumber: true, ownership: true } },
        /** 🔴 What the step PLANNED to produce (§5.7) — the returned grid opens
         * with a row per output rather than a single item, so a step that makes
         * shirts and rejects does not need both typed from scratch. */
        outputs: {
          where: { isDeleted: false },
          orderBy: { seq: 'asc' },
          include: {
            item: { select: { id: true, name: true, sku: true } },
            uom: { select: { id: true, unitName: true, symbol: true } },
          },
        },
        inputs: {
          where: { isDeleted: false },
          orderBy: { seq: 'asc' },
          include: {
            item: { select: { id: true, name: true, sku: true } },
            uom: { select: { id: true, unitName: true, symbol: true } },
          },
        },
      },
    });
    if (!step) throw ApiError.notFound('Job order step not found');

    const issues = await tx.jobIssue.findMany({
      where: {
        organizationId,
        jobOrderStepId,
        isDeleted: false,
        status: { in: ['issued', 'partially_received'] },
      },
      orderBy: { issueDate: 'asc' },
      include: {
        lines: {
          where: { isDeleted: false },
          include: {
            item: { select: { id: true, name: true, sku: true } },
            uom: { select: { id: true, unitName: true, symbol: true } },
            batch: { select: { id: true, supplierBatchRef: true } },
          },
        },
      },
    });

    // Outstanding per issue LINE, so a partly-received challan does not offer the
    // same taka twice.
    const rows = [];
    for (const issue of issues) {
      for (const line of issue.lines) {
        const closed = await tx.jobReceiptLine.aggregate({
          where: { organizationId, jobIssueLineId: line.id, isDeleted: false },
          _sum: { issuedQty: true },
        });
        const outstanding = line.qty.minus(closed._sum.issuedQty ?? ZERO);
        if (outstanding.lessThanOrEqualTo(0)) continue;

        rows.push({
          jobIssueId: issue.id,
          challanNumber: issue.challanNumber,
          jobIssueLineId: line.id,
          // 🔴 The item is on the LINE now (§5.7) — the consumed grid groups by
          // it, because one challan carries fabric, thread and buttons and their
          // quantities can never be added together.
          itemId: line.itemId,
          itemName: line.item?.name ?? null,
          uomSymbol: line.uom?.symbol ?? line.uom?.unitName ?? null,
          batchId: line.batchId,
          // The label, not the internal number (2026-08-14).
          batchReference: line.batch.supplierBatchRef,
          issuedQty: outstanding.toString(),
        });
      }
    }

    return {
      step,
      issues: issues.map((issue) => ({
        id: issue.id,
        challanNumber: issue.challanNumber,
        issueDate: issue.issueDate,
        totalQty: issue.totalQty.toString(),
        isRework: issue.isRework,
        attemptNo: issue.attemptNo,
      })),
      lines: rows,
      /**
       * The returned grid's opening rows — one per item the step planned to
       * produce, with NO quantities filled in.
       *
       * 🔴 `expectedQty` is deliberately not offered as a default. What came back
       * is measured at the gate, and pre-filling the expectation is how an
       * expectation gets recorded as a measurement (§6.3).
       */
      outputs: step.outputs.map((row) => ({
        itemId: row.itemId,
        itemName: row.item.name,
        uomId: row.uomId,
        uomSymbol: row.uom?.symbol ?? row.uom?.unitName ?? null,
        isPrimary: row.isPrimary,
        expectedQty: row.expectedQty?.toString() ?? null,
      })),
    };
  });
}

/** How many "other batches" a search may return. A picker is for identifying a
 * batch you already have in mind, not for browsing an item's whole history. */
const OTHER_BATCH_LIMIT = 25;

/**
 * 🔴 WHICH EXISTING BATCHES THE RECEIVE DIALOG MAY OFFER, and why it is not a
 * stock query.
 *
 * The obvious implementation — "batches with stock at the godown being received
 * into" — is the ISSUE picker's question, and it is wrong here in both
 * directions:
 *
 *   · it HIDES the right answer. 500 m of dye lot 23 arrives Monday and is
 *     issued onward Wednesday; Friday's other 500 m of the same lot finds the
 *     batch at zero and absent from the list, so the operator retypes the label
 *     and one physical lot ends up under two batch ids. A recall on lot 23 then
 *     finds half the stock.
 *   · it OFFERS wrong ones. The finished-goods godown is exactly where every
 *     unrelated batch of that item lives — other job orders, last month's
 *     purchase — and a location filter does nothing to stop a merge into one.
 *
 * So the list is scoped by PROVENANCE, which does not move, and location is
 * returned as INFORMATION on every row instead. Two groups:
 *
 *   `jobOrderBatches` — produced by an earlier receipt against this job order,
 *     plus (for a step whose output item is also one of its inputs) the batches
 *     its own challans sent out. Listed by default, whatever their balance and
 *     wherever they sit.
 *   `otherBatches` — anything else of that item, only in answer to a search, so
 *     that merging into an unrelated batch is a deliberate act rather than a
 *     mis-click. The client warns on these; the SERVICE does not refuse them,
 *     because two job orders dyed in one bath is real (see
 *     `loadExistingOutputBatches`).
 */
export async function getOutputBatchOptions(
  organizationId: string,
  query: { jobOrderStepId: string; itemId: string; search?: string },
) {
  return runAsTenant(organizationId, async (tx) => {
    const step = await tx.jobOrderStep.findFirst({
      where: { id: query.jobOrderStepId, organizationId, isDeleted: false },
      select: {
        jobOrderId: true,
        jobOrder: { select: { ownership: true, ownerPartyId: true, isDeleted: true } },
      },
    });
    if (!step || step.jobOrder.isDeleted) throw ApiError.notFound('Job order step not found');

    const item = await tx.item.findFirst({
      where: { id: query.itemId, organizationId, isDeleted: false },
      select: { id: true, inventoryTracking: true },
    });
    if (!item) throw ApiError.notFound('Item not found');

    /**
     * 🔴 The ownership pair is a FILTER, not a display column — the same rule the
     * issue picker follows. Offering one customer's batch against another's job
     * order is how somebody else's goods become our asset (§5.2).
     */
    const ownershipWhere = {
      ownership: step.jobOrder.ownership,
      ownerPartyId: step.jobOrder.ownerPartyId,
    };

    // Receipts already posted against this job order — the batches they created
    // are the ones a follow-up delivery continues.
    const priorReceipts = await tx.jobReceipt.findMany({
      where: { organizationId, jobOrderId: step.jobOrderId, isDeleted: false, status: 'posted' },
      select: { id: true },
    });

    // …and, for a step that does not transform the item, the batches its own
    // challans sent out: what comes back IS what went, so continuing the batch is
    // the honest record rather than a clone under a new label.
    const issuedBatches = await tx.jobIssueLine.findMany({
      where: {
        organizationId,
        itemId: query.itemId,
        isDeleted: false,
        jobIssue: { jobOrderId: step.jobOrderId, isDeleted: false, status: { not: 'cancelled' } },
      },
      select: { batchId: true },
    });

    const provenanceWhere: Prisma.BatchWhereInput = {
      organizationId,
      itemId: query.itemId,
      isDeleted: false,
      ...ownershipWhere,
      OR: [
        {
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: { in: priorReceipts.map((row) => row.id) },
        },
        { id: { in: issuedBatches.map((row) => row.batchId) } },
      ],
    };

    const jobOrderBatches = await tx.batch.findMany({
      where: provenanceWhere,
      orderBy: { createdAt: 'desc' },
      select: BATCH_OPTION_SELECT,
    });

    /**
     * 🔴 `batchNumber` is NOT searchable and must not become so (2026-08-14). It
     * is an internal key nobody can be typing, so matching on it only pollutes
     * results — a search for `42` would hit numbers that have nothing to do with
     * the batch in mind. What people type is what is on the physical tag.
     */
    const search = query.search?.trim();
    const otherBatches = search
      ? await tx.batch.findMany({
          where: {
            organizationId,
            itemId: query.itemId,
            isDeleted: false,
            ...ownershipWhere,
            NOT: { id: { in: jobOrderBatches.map((row) => row.id) } },
            OR: [
              { supplierBatchRef: { contains: search, mode: 'insensitive' } },
              { manufacturerBatch: { contains: search, mode: 'insensitive' } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: OTHER_BATCH_LIMIT,
          select: BATCH_OPTION_SELECT,
        })
      : [];

    const all = [...jobOrderBatches, ...otherBatches];

    /**
     * WHERE each one is — one grouped query for every batch on the list, never
     * one per row.
     *
     * 🔴 No `ownership` filter on the BALANCE: the pair already narrowed which
     * batches are on the list, and a ledger row copies its batch's ownership at
     * post time, so filtering again could only ever subtract rows that belong.
     */
    const balances = await getBalancesByBatchAndLocation(tx, {
      organizationId,
      itemId: query.itemId,
      batchIds: all.map((row) => row.id),
      axis: 'physical',
    });

    const locationIds = new Set<string>();
    for (const byLocation of balances.values()) {
      for (const locationId of byLocation.keys()) locationIds.add(locationId);
    }
    const locations = await tx.location.findMany({
      where: { organizationId, id: { in: [...locationIds] }, isDeleted: false },
      select: { id: true, name: true, type: true },
    });
    const locationById = new Map(locations.map((row) => [row.id, row]));

    const shape = (batch: (typeof all)[number], source: 'this_job_order' | 'other') => {
      const byLocation = balances.get(batch.id) ?? new Map<string, Prisma.Decimal>();
      const rows = [...byLocation.entries()]
        // A location the batch has left entirely is noise on the row; the batch
        // itself still belongs on the LIST, which is the distinction that matters.
        .filter(([, qty]) => !qty.isZero())
        .map(([locationId, qty]) => {
          const location = locationById.get(locationId);
          return {
            locationId,
            locationName: location?.name ?? null,
            locationType: location?.type ?? null,
            /**
             * 🔴 Goods at a processor are OUR stock at THEIR location (§5.4), so
             * they show up here as a balance like any other. Said as one total it
             * reads as stock on hand and it is not — it is material still out.
             * The client groups on this flag; the answer is computed once, here,
             * so two screens cannot disagree about it.
             */
            isExternal: isExternalLocation(location?.type),
            qty: qty.toString(),
          };
        })
        .sort((a, b) => (a.locationName ?? '').localeCompare(b.locationName ?? ''));

      const total = rows.reduce((sum, row) => sum.plus(row.qty), ZERO);
      const external = rows
        .filter((row) => row.isExternal)
        .reduce((sum, row) => sum.plus(row.qty), ZERO);

      return {
        batchId: batch.id,
        // No `batchNumber`: internal, never rendered, and a field in the payload
        // is a field somebody eventually renders (2026-08-14).
        supplierBatchRef: batch.supplierBatchRef,
        manufacturerBatch: batch.manufacturerBatch,
        createdAt: batch.createdAt.toISOString(),
        manufacturedDate: batch.manufacturedDate?.toISOString().slice(0, 10) ?? null,
        expiryDate: batch.expiryDate?.toISOString().slice(0, 10) ?? null,
        uomId: batch.uomId,
        source,
        totalQty: total.toString(),
        internalQty: total.minus(external).toString(),
        externalQty: external.toString(),
        byLocation: rows,
      };
    };

    return {
      inventoryTracking: item.inventoryTracking,
      jobOrderBatches: jobOrderBatches.map((row) => shape(row, 'this_job_order')),
      otherBatches: otherBatches.map((row) => shape(row, 'other')),
      /** True once the search filled its page: more exist than are shown, and the
       * only way to reach them is a narrower search. */
      isOtherCapped: otherBatches.length === OTHER_BATCH_LIMIT,
    };
  });
}

const BATCH_OPTION_SELECT = {
  id: true,
  supplierBatchRef: true,
  manufacturerBatch: true,
  createdAt: true,
  manufacturedDate: true,
  expiryDate: true,
  uomId: true,
} satisfies Prisma.BatchSelect;

/** What the processor charges for this receipt, per `rateBasis` (§9.2). */
function processCharge(
  rate: Prisma.Decimal | null,
  rateBasis: string | null,
  issuedQty: Prisma.Decimal,
  receivedQty: Prisma.Decimal,
): Prisma.Decimal {
  if (!rate) return ZERO;
  switch (rateBasis) {
    case 'per_issued_unit':
      return rate.times(issuedQty);
    case 'per_received_unit':
      return rate.times(receivedQty);
    default:
      return ZERO;
  }
}

/**
 * One batch a returned row will land in, resolved from the request but not yet
 * written. Exactly one of the two identifiers is set: `batchId` names an
 * existing batch to add to, `batchReference` names a batch to create.
 */
interface OutputBatchPlan {
  batchId: string | null;
  batchReference: string | null;
  qty: Prisma.Decimal;
}

interface ResolvedOutput {
  itemId: string;
  uomId: string | null;
  receivedQty: Prisma.Decimal;
  acceptedQty: Prisma.Decimal;
  reworkQty: Prisma.Decimal;
  scrapQty: Prisma.Decimal;
  returnedQty: Prisma.Decimal;
  isPrimary: boolean;
  /** Null on the primary — it takes the remainder of the pot (§9.2.1). */
  valueShare: Prisma.Decimal | null;
  reasonId: string | null;
  responsibility: string | null;
  remarks: string | null;
  /** What the accepted goods will be called from here on. `createBatch` refuses a
   * null on a batch-tracked item — see the note there. */
  batchReference: string | null;
  /** The rework batch is a separate batch with a separate life, so it needs its
   * own label rather than sharing the accepted one's. */
  reworkBatchReference: string | null;

  /**
   * 🔴 WHERE THE ACCEPTED GOODS LAND — one entry per batch, and since 2026-08-21
   * there may be several. A dyer returning three dye lots in one consignment is
   * three batches; one label across all three loses the separation the lots were
   * physically kept in.
   *
   * Never empty for a row carrying accepted quantity: a client that sends no
   * allocation has one entry synthesised from `batchReference`, which is exactly
   * what every pre-2026-08-21 client meant by it.
   */
  batches: OutputBatchPlan[];
  /** The same for rework — always a DIFFERENT set of batches, so the re-issue can
   * send back only the pieces that failed. */
  reworkBatches: OutputBatchPlan[];
}

/**
 * 🔴 SPLIT A VALUE ACROSS PARTS BY QUANTITY, CONSERVING EVERY PAISA.
 *
 * The last part takes the REMAINDER rather than its own rounded share. Rounding
 * each share independently to four decimals loses fractions — three ways of
 * ₹100 is 33.3333 × 3 = ₹99.9999 — and the missing paisa is not a display
 * problem: the pot no longer equals what was posted, so "cost per metre" stops
 * reconciling with the ledger and no report can say why.
 *
 * Legitimate ONLY where every part is the same item in the same unit (§9.2.1).
 * Across items it would be the cross-unit ratio the domain refuses everywhere.
 */
function splitByQty(total: Prisma.Decimal, parts: readonly Prisma.Decimal[]): Prisma.Decimal[] {
  if (parts.length === 0) return [];
  const sum = parts.reduce((acc, part) => acc.plus(part), ZERO);
  // Nothing to weigh by — a value with no quantity behind it goes nowhere rather
  // than being spread evenly over rows that measured zero.
  if (sum.lessThanOrEqualTo(0)) return parts.map(() => ZERO);

  const shares: Prisma.Decimal[] = [];
  let assigned = ZERO;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      shares.push(total.minus(assigned));
      break;
    }
    const share = total.times(part).dividedBy(sum).toDecimalPlaces(4);
    shares.push(share);
    assigned = assigned.plus(share);
  }
  return shares;
}

/**
 * 🔴 WHAT CAME BACK, one row per item (§5.7).
 *
 * A step returns shirts AND rejects, or panels AND offcuts AND waste. The
 * quantities are what somebody measured at the gate — nothing here derives one
 * from another, and `expectedYield` is not consulted at all (§6.3).
 *
 * Left empty by the client, ONE row is derived from the consumption lines and the
 * step's output item, which is precisely what Sprints 1–4 recorded. That is the
 * rollout bridge, and it is why the old Receive dialog keeps working unchanged.
 *
 * When rows ARE sent and none is flagged primary, the first is — the same rule
 * the job order step uses, because exactly one output must absorb the cost.
 */
function resolveOutputs(
  sent: readonly JobReceiptOutputInput[] | undefined,
  lineTotals: {
    received: Prisma.Decimal;
    accepted: Prisma.Decimal;
    rework: Prisma.Decimal;
    scrap: Prisma.Decimal;
    returned: Prisma.Decimal;
  },
  fallback: {
    itemId: string;
    uomId: string | null;
    batchReference: string | null;
    reworkBatchReference: string | null;
  },
): ResolvedOutput[] {
  if (!sent || sent.length === 0) {
    return [
      {
        itemId: fallback.itemId,
        uomId: fallback.uomId,
        receivedQty: lineTotals.received,
        acceptedQty: lineTotals.accepted,
        reworkQty: lineTotals.rework,
        scrapQty: lineTotals.scrap,
        returnedQty: lineTotals.returned,
        isPrimary: true,
        valueShare: null,
        reasonId: null,
        responsibility: null,
        remarks: null,
        // The single-output form has no per-row grid to carry these, so they ride
        // on the header instead.
        batchReference: fallback.batchReference,
        reworkBatchReference: fallback.reworkBatchReference,
        batches: singleBatchPlan(fallback.batchReference, lineTotals.accepted),
        reworkBatches: singleBatchPlan(fallback.reworkBatchReference, lineTotals.rework),
      },
    ];
  }

  const flagged = sent.filter((row) => row.isPrimary);
  if (flagged.length > 1) {
    throw new ApiError(
      400,
      `${flagged.length} returned items are marked as the main one. Only one can carry the cost ` +
        'of the operation; the others take an explicit value.',
      { outputs: 'Mark exactly one returned item as the main one.' },
    );
  }

  const seen = new Set<string>();
  return sent.map((row, index) => {
    if (seen.has(row.itemId)) {
      throw new ApiError(400, 'The same item is listed twice in what came back.', {
        [`outputs.${index}.itemId`]: 'This item is already on the receipt.',
      });
    }
    seen.add(row.itemId);
    const isPrimary = flagged.length === 1 ? Boolean(row.isPrimary) : index === 0;
    return {
      itemId: row.itemId,
      uomId: row.uomId ?? null,
      receivedQty: new Prisma.Decimal(row.receivedQty),
      acceptedQty: new Prisma.Decimal(row.acceptedQty ?? 0),
      reworkQty: new Prisma.Decimal(row.reworkQty ?? 0),
      scrapQty: new Prisma.Decimal(row.scrapQty ?? 0),
      returnedQty: new Prisma.Decimal(row.returnedQty ?? 0),
      isPrimary,
      // The primary takes the remainder, so a value typed on it would be
      // ignored — better to drop it here than to store a number nothing reads.
      valueShare: isPrimary ? null : new Prisma.Decimal(row.valueShare ?? 0),
      reasonId: row.reasonId ?? null,
      responsibility: row.responsibility ?? null,
      remarks: row.remarks?.trim() || null,
      batchReference: row.batchReference?.trim() || null,
      reworkBatchReference: row.reworkBatchReference?.trim() || null,
      /**
       * 🔴 THE ROLLOUT BRIDGE, and the reason the old dialog keeps posting.
       *
       * An allocation list means the client knows about split batches. No list
       * means the older shape, where one batch took the whole quantity under the
       * label on the row — so that is synthesised rather than treated as "no
       * batches", which would post accepted stock into nothing.
       */
      batches: row.batches?.length
        ? row.batches.map((batch) => ({
            batchId: batch.batchId ?? null,
            batchReference: batch.batchReference?.trim() || null,
            qty: new Prisma.Decimal(batch.qty),
          }))
        : singleBatchPlan(
            row.batchReference?.trim() || null,
            new Prisma.Decimal(row.acceptedQty ?? 0),
          ),
      reworkBatches: row.reworkBatches?.length
        ? row.reworkBatches.map((batch) => ({
            batchId: batch.batchId ?? null,
            batchReference: batch.batchReference?.trim() || null,
            qty: new Prisma.Decimal(batch.qty),
          }))
        : singleBatchPlan(
            row.reworkBatchReference?.trim() || null,
            new Prisma.Decimal(row.reworkQty ?? 0),
          ),
    };
  });
}

/** The pre-2026-08-21 shape: one new batch under one label taking the whole
 * quantity. Empty when there is no quantity — an all-scrap row creates nothing. */
function singleBatchPlan(batchReference: string | null, qty: Prisma.Decimal): OutputBatchPlan[] {
  if (qty.lessThanOrEqualTo(0)) return [];
  return [{ batchId: null, batchReference, qty }];
}

/**
 * 🔴 THE VALUE SPLIT (§9.2.1). One pot, several places to put it.
 *
 *     pot = value of everything consumed + the process charge
 *     each by-product → the value the user typed, default ₹0
 *     the primary     → pot − the sum of the by-product values
 *
 * Apportioning by quantity is not available and reaching for it is the trap:
 * 2,910 PCS and 80 KG have no ratio between them, and inventing one would move
 * cost silently between two items every time the yield moved.
 *
 * Value is conserved by construction — the primary takes exactly what is left —
 * so the only way to break it is by-products claiming more than the whole
 * operation was worth, which is refused rather than left to make the primary
 * negative.
 */
function splitValue(outputs: readonly ResolvedOutput[], pot: Prisma.Decimal) {
  const byProducts = outputs.filter((row) => !row.isPrimary);
  const claimed = byProducts.reduce((acc, row) => acc.plus(row.valueShare ?? ZERO), ZERO);

  if (claimed.greaterThan(pot)) {
    throw new ApiError(
      400,
      `The by-products are valued at ${claimed.toString()}, but this operation is only worth ` +
        `${pot.toDecimalPlaces(4).toString()} in total (material consumed plus the process charge). ` +
        'The main output would be left carrying a negative cost.',
      { outputs: 'By-product values cannot exceed the value of the whole operation.' },
    );
  }

  const primaryValue = pot.minus(claimed);
  return new Map(
    outputs.map((row) => [row.itemId, row.isPrimary ? primaryValue : (row.valueShare ?? ZERO)]),
  );
}

/** One batch this receipt actually wrote into, ready to be recorded as a row. */
interface PostedOutputBatch {
  kind: 'accepted' | 'rework';
  batchId: string;
  qty: Prisma.Decimal;
  isNewBatch: boolean;
}

/**
 * 🔴 THE ALLOCATION MUST ACCOUNT FOR THE WHOLE QUANTITY — ENFORCED HERE AND NOT
 * ONLY IN THE SCHEMA.
 *
 * `jobReceiptOutputSchema` carries the same rule, but that only runs through
 * `validateBody` on the HTTP route, so any other caller — a script, a future
 * import, a test — could post a receipt whose batches do not add up to what it
 * says came back. The difference would vanish silently: the ledger would hold
 * what the batches said and the document would claim something else, and nothing
 * downstream could reconcile the two.
 *
 * Exactly the reasoning that put the disposition sum check beside the write, and
 * the same four-decimal tolerance — the columns' own precision, so 3 × 33.3333 is
 * not rejected for being a billionth off.
 */
function assertAllocationsBalance(outputs: readonly ResolvedOutput[]): void {
  const tolerance = new Prisma.Decimal('0.00005');

  for (const [index, output] of outputs.entries()) {
    const sides = [
      { kind: 'accepted', qty: output.acceptedQty, plans: output.batches, field: 'batches' },
      {
        kind: 'rework',
        qty: output.reworkQty,
        plans: output.reworkBatches,
        field: 'reworkBatches',
      },
    ] as const;

    for (const side of sides) {
      const allocated = side.plans.reduce((sum, plan) => sum.plus(plan.qty), ZERO);
      if (allocated.minus(side.qty).abs().greaterThan(tolerance)) {
        throw new ApiError(
          400,
          `Returned item ${index + 1}: the ${side.kind} batches add up to ${allocated.toString()}, ` +
            `but ${side.qty.toString()} was ${side.kind}.`,
          {
            [`outputs.${index}.${side.field}`]: `The batches must add up to the ${side.kind} quantity.`,
          },
        );
      }
    }

    /** 🔴 Accepted and rework may never share a batch. Merged, the piece count
     * rework has to be measured by is gone, and the re-issue has no way to send
     * back only the pieces that failed (plan §7). */
    const seen = new Set<string>();
    for (const plan of [...output.batches, ...output.reworkBatches]) {
      if (!plan.batchId) continue;
      if (seen.has(plan.batchId)) {
        throw new ApiError(
          400,
          'The same batch is named more than once on one returned item. Accepted and rework goods must go to different batches.',
          { [`outputs.${index}.batches`]: 'A batch can only appear once.' },
        );
      }
      seen.add(plan.batchId);
    }
  }
}

/** What an existing batch has to agree about before this receipt may add to it. */
interface ExistingBatch {
  id: string;
  itemId: string;
  uomId: string | null;
  ownership: string;
  ownerPartyId: string | null;
  parentBatchIds: string[];
  supplierBatchRef: string | null;
}

/**
 * 🔴 EVERY EXISTING BATCH THIS RECEIPT WOULD ADD TO, CHECKED BEFORE ANYTHING IS
 * POSTED.
 *
 * Adding to a batch is the second half of a split delivery — 500 m of dye lot 23
 * today, 500 m tomorrow — and it is only honest while the batch is the same
 * material in the same unit belonging to the same party. Each of the three has a
 * different failure:
 *
 *   · wrong ITEM — the batch now holds two different things under one id, and
 *     every quantity read from it afterwards is a sum of unlike goods;
 *   · wrong UNIT — a balance is one number in one unit (§5.1). Metres added to a
 *     kilogram batch is not a conversion, it is a corrupted number;
 *   · wrong OWNERSHIP PAIR — 🔴 the dangerous one. Merging customer-owned inward
 *     jobwork into own stock silently converts somebody else's goods into our
 *     asset, and every valuation query believes it. Same class of failure as a
 *     missing tenant filter.
 *
 * ⚠️ Deliberately NOT checked here: whether the batch belongs to THIS job order.
 * The picker lists this job order's batches by default and makes anything else a
 * deliberate, warned choice, but a hard block would refuse the real case of two
 * orders dyed in one bath. A warning the operator can read beats a rule that is
 * wrong once a month (and that they would work around by inventing a new label).
 */
async function loadExistingOutputBatches(
  tx: TenantClient,
  organizationId: string,
  outputs: readonly ResolvedOutput[],
  ownership: Ownership,
  ownerPartyId: string | null,
): Promise<Map<string, ExistingBatch>> {
  const wanted = new Map<string, ResolvedOutput>();
  for (const output of outputs) {
    for (const plan of [...output.batches, ...output.reworkBatches]) {
      if (plan.batchId) wanted.set(plan.batchId, output);
    }
  }
  if (wanted.size === 0) return new Map();

  // One read for every batch on the receipt, not one per row.
  const rows = await tx.batch.findMany({
    where: { id: { in: [...wanted.keys()] }, organizationId, isDeleted: false },
    select: {
      id: true,
      itemId: true,
      uomId: true,
      ownership: true,
      ownerPartyId: true,
      parentBatchIds: true,
      supplierBatchRef: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const [batchId, output] of wanted) {
    const batch = byId.get(batchId);
    if (!batch) {
      throw ApiError.badRequest(
        'One of the batches this receipt adds to no longer exists, or belongs to another organization.',
      );
    }
    if (batch.itemId !== output.itemId) {
      throw ApiError.badRequest(
        `Batch ${batch.supplierBatchRef ?? batchId} holds a different item, so this receipt cannot add to it.`,
      );
    }
    // A null unit on an older batch contradicts nothing; a different one does.
    if (batch.uomId && output.uomId && batch.uomId !== output.uomId) {
      throw ApiError.badRequest(
        `Batch ${batch.supplierBatchRef ?? batchId} is measured in a different unit, so this receipt cannot add to it.`,
      );
    }
    if (batch.ownership !== ownership || (batch.ownerPartyId ?? null) !== (ownerPartyId ?? null)) {
      throw ApiError.badRequest(
        `Batch ${batch.supplierBatchRef ?? batchId} belongs to a different party, so this receipt cannot add to it.`,
      );
    }
  }

  return byId;
}

interface ConsumeAllocation {
  jobIssueId: string;
  jobIssueLineId: string;
  batchId: string;
  /** Which item was consumed — the challan line's own (§5.7). It is what the
   * process charge is measured against when the rate is per issued unit. */
  itemId: string;
  qty: Prisma.Decimal;
}

/**
 * Decide which issue lines this receipt consumes, and how much of each.
 *
 * Unit-wise lines name their own issue line, so the answer is given. Bulk lines
 * do not — one typed total closes whatever is still outstanding, oldest first.
 * FIFO rather than proportional because the batches went out in an order and came
 * back in that order; splitting a bulk return across every open line by ratio
 * invents a mixing that did not happen.
 */
async function allocateConsumption(
  tx: TenantClient,
  organizationId: string,
  issueIds: readonly string[],
  lines: readonly JobReceiptLineInput[],
): Promise<ConsumeAllocation[]> {
  const issueLines = await tx.jobIssueLine.findMany({
    where: { organizationId, jobIssueId: { in: [...issueIds] }, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      jobIssueId: true,
      batchId: true,
      qty: true,
      itemId: true,
    },
  });

  const outstanding = new Map<string, Prisma.Decimal>();
  for (const line of issueLines) {
    const closed = await tx.jobReceiptLine.aggregate({
      where: { organizationId, jobIssueLineId: line.id, isDeleted: false },
      _sum: { issuedQty: true },
    });
    outstanding.set(line.id, line.qty.minus(closed._sum.issuedQty ?? ZERO));
  }

  const allocations: ConsumeAllocation[] = [];

  for (const line of lines) {
    let toConsume = new Prisma.Decimal(line.issuedQty ?? 0);
    if (toConsume.lessThanOrEqualTo(0)) continue;

    // Named line: consume from it and nowhere else.
    if (line.jobIssueLineId) {
      const issueLine = issueLines.find((l) => l.id === line.jobIssueLineId);
      if (!issueLine) {
        throw ApiError.badRequest(
          'One of the receipt lines refers to a challan line that is not on this receipt.',
        );
      }
      const left = outstanding.get(issueLine.id) ?? ZERO;
      if (toConsume.greaterThan(left)) {
        throw ApiError.badRequest(
          `Challan line for batch ${issueLine.batchId} has ${left.toString()} still out, ` +
            `but ${toConsume.toString()} is being received against it.`,
        );
      }
      outstanding.set(issueLine.id, left.minus(toConsume));
      allocations.push({
        jobIssueId: issueLine.jobIssueId,
        jobIssueLineId: issueLine.id,
        batchId: issueLine.batchId,
        itemId: issueLine.itemId,
        qty: toConsume,
      });
      continue;
    }

    /**
     * 🔴 Bulk: walk the open lines oldest first — WITHIN ONE ITEM.
     *
     * Unscoped, this settles a panel receipt by consuming thread, because the
     * thread's lines are simply older. The item is asked for whenever the
     * challans carry more than one; with a single item there is nothing to
     * disambiguate and the old shape keeps working.
     */
    const itemsOnChallans = new Set(issueLines.map((issueLine) => issueLine.itemId));
    if (!line.itemId && itemsOnChallans.size > 1) {
      throw new ApiError(
        400,
        'These challans carry several items, so each line has to say which one it accounts for. ' +
          'Otherwise the oldest open line is consumed first, whatever item it is.',
        { lines: 'Name the item on every line when the challans carry more than one.' },
      );
    }
    const eligible = line.itemId
      ? issueLines.filter((issueLine) => issueLine.itemId === line.itemId)
      : issueLines;
    if (line.itemId && eligible.length === 0) {
      throw ApiError.badRequest(
        'One of the receipt lines names an item these challans did not carry.',
      );
    }

    for (const issueLine of eligible) {
      if (toConsume.lessThanOrEqualTo(0)) break;
      const left = outstanding.get(issueLine.id) ?? ZERO;
      if (left.lessThanOrEqualTo(0)) continue;

      const take = Prisma.Decimal.min(left, toConsume);
      outstanding.set(issueLine.id, left.minus(take));
      toConsume = toConsume.minus(take);
      allocations.push({
        jobIssueId: issueLine.jobIssueId,
        jobIssueLineId: issueLine.id,
        batchId: issueLine.batchId,
        itemId: issueLine.itemId,
        qty: take,
      });
    }

    if (toConsume.greaterThan(0)) {
      throw ApiError.badRequest(
        `${toConsume.toString()} more is being received than these challans still have outstanding.`,
      );
    }
  }

  return allocations;
}

export async function createNewJobReceipt(
  organizationId: string,
  data: CreateJobReceiptInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, lines, outputs: sentOutputs, issueIds, ...header } = data;

  // Consumes fifty, produces fifty, and creates a package per accepted taka —
  // past Prisma's 5-second default (jobwork.types.ts).
  return runAsDocument(organizationId, async (tx) => {
    const step = await tx.jobOrderStep.findFirst({
      where: { id: header.jobOrderStepId, organizationId, isDeleted: false },
      include: {
        process: { select: { name: true } },
        jobOrder: {
          select: { id: true, ownership: true, ownerPartyId: true, status: true, isDeleted: true },
        },
      },
    });
    if (!step) throw ApiError.notFound('Job order step not found');
    if (step.jobOrder.isDeleted) throw ApiError.notFound('Job order not found');

    await assertLocationsBelongToOrg(tx, organizationId, [header.locationId]);
    await assertItemsBelongToOrg(tx, organizationId, [header.outputItemId]);
    await assertUomsBelongToOrg(tx, organizationId, [header.outputUomId]);

    const issues = await tx.jobIssue.findMany({
      where: {
        id: { in: issueIds },
        organizationId,
        jobOrderStepId: step.id,
        isDeleted: false,
        status: { not: 'cancelled' },
      },
      select: {
        id: true,
        destinationLocationId: true,
        processorType: true,
        processorId: true,
        processorNameSnapshot: true,
      },
    });
    if (issues.length !== issueIds.length) {
      throw ApiError.badRequest(
        'One of the selected challans does not belong to this step, or has been cancelled.',
      );
    }

    /**
     * 🔴 The processor is INHERITED from the challans, never chosen (§6.1).
     * Receiving from a party you did not issue to is a transfer, not a receipt,
     * and recording it as one loses the fact that the goods changed hands twice.
     */
    const processorIds = new Set(issues.map((i) => i.processorId ?? ''));
    if (processorIds.size > 1) {
      throw ApiError.badRequest(
        'These challans went to different processors, so they cannot be received on one receipt.',
      );
    }
    const processorLocationIds = new Set(issues.map((i) => i.destinationLocationId));
    if (processorLocationIds.size > 1) {
      throw ApiError.badRequest(
        'These challans are at different locations, so they cannot be received together.',
      );
    }
    const processorLocationId = issues[0]!.destinationLocationId;

    // Copied from the process, never taken from the request.

    /**
     * The header's item, for a request that named none. It is the step's PRIMARY
     * output — the row that carries the step's cost — read from the list rather
     * than from the `receiveItemId` scalar that used to mirror it (dropped
     * 2026-08-12, plan §12.1 Migration B).
     */
    const plannedPrimaryOutput = await tx.jobOrderStepOutput.findFirst({
      where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
      orderBy: [{ isPrimary: 'desc' }, { seq: 'asc' }],
      select: { itemId: true, uomId: true },
    });

    const outputItemId = header.outputItemId ?? plannedPrimaryOutput?.itemId;
    if (!outputItemId) {
      throw ApiError.badRequest('This step has no output item, so there is nothing to receive.');
    }
    const outputUomId = header.outputUomId ?? plannedPrimaryOutput?.uomId ?? null;

    const totals = lines.reduce(
      (acc, line) => ({
        issued: acc.issued.plus(new Prisma.Decimal(line.issuedQty ?? 0)),
        received: acc.received.plus(new Prisma.Decimal(line.receivedQty)),
        accepted: acc.accepted.plus(new Prisma.Decimal(line.acceptedQty ?? 0)),
        rework: acc.rework.plus(new Prisma.Decimal(line.reworkQty ?? 0)),
        scrap: acc.scrap.plus(new Prisma.Decimal(line.scrapQty ?? 0)),
        returned: acc.returned.plus(new Prisma.Decimal(line.returnedQty ?? 0)),
      }),
      { issued: ZERO, received: ZERO, accepted: ZERO, rework: ZERO, scrap: ZERO, returned: ZERO },
    );

    if (totals.issued.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('Say how much of the issued material this receipt accounts for.');
    }

    /**
     * 🔴 THE SUM CHECK, ENFORCED HERE AND NOT ONLY IN THE SCHEMA.
     *
     * `jobReceiptLineSchema` carries the same rule, but that only runs through
     * `validateBody` on the HTTP route — so any other caller (a script, a future
     * import, a test) could post a receipt whose dispositions do not add up, and
     * the difference would vanish silently: the ledger would be posted from
     * `accepted` while the document claimed a larger `received`, and nothing
     * downstream could ever reconcile the two.
     *
     * This one rule is what makes a separate "Rejection Note" document
     * unnecessary (§6.4), so it belongs with the write, not with the request.
     * Compared at four decimals — the columns' own precision — because an exact
     * comparison would reject 3 × 33.3333 for being a billionth off.
     */
    for (const [index, line] of lines.entries()) {
      const split = new Prisma.Decimal(line.acceptedQty ?? 0)
        .plus(line.reworkQty ?? 0)
        .plus(line.scrapQty ?? 0)
        .plus(line.returnedQty ?? 0);
      const received = new Prisma.Decimal(line.receivedQty);
      if (split.minus(received).abs().greaterThan(new Prisma.Decimal('0.00005'))) {
        throw new ApiError(
          400,
          `Line ${index + 1}: accepted + rework + scrap + returned is ${split.toString()}, ` +
            `but ${received.toString()} was received.`,
          { [`lines.${index}.receivedQty`]: 'The disposition split must equal what was received.' },
        );
      }
    }

    const allocations = await allocateConsumption(tx, organizationId, issueIds, lines);

    /**
     * 🔴 WHAT CAME BACK (§5.7) — resolved before anything is written, because
     * the value split and the batches both hang off it.
     */
    const outputRows = resolveOutputs(sentOutputs, totals, {
      itemId: outputItemId,
      uomId: outputUomId,
      batchReference: data.batchReference?.trim() || null,
      reworkBatchReference: data.reworkBatchReference?.trim() || null,
    });
    await assertItemsBelongToOrg(
      tx,
      organizationId,
      outputRows.map((row) => row.itemId),
    );

    // One item, one stocking unit (§5.1) — read from the item, never taken from
    // the request, exactly as the job order does with its own units.
    const outputItems = await tx.item.findMany({
      where: {
        id: { in: [...new Set(outputRows.map((row) => row.itemId))] },
        organizationId,
        isDeleted: false,
      },
      select: { id: true, stockingUomId: true },
    });
    const stockingUomByItem = new Map(outputItems.map((item) => [item.id, item.stockingUomId]));
    for (const row of outputRows) {
      row.uomId = stockingUomByItem.get(row.itemId) ?? row.uomId;
    }

    /**
     * 🔴 CHECKED BEFORE A SINGLE ROW IS POSTED, and after the units above are
     * settled — the unit check compares against the item's stocking unit, so it
     * has to run once that is known. A batch this receipt may not add to has to
     * fail while nothing has moved; discovering it halfway through leaves the
     * ledger holding half a receipt.
     */
    assertAllocationsBalance(outputRows);

    const ownership = step.jobOrder.ownership as Ownership;
    const existingBatches = await loadExistingOutputBatches(
      tx,
      organizationId,
      outputRows,
      ownership,
      step.jobOrder.ownerPartyId,
    );

    const primaryOutput = outputRows.find((row) => row.isPrimary)!;

    /**
     * 🔴 THE QUANTITY THE CHARGE IS MEASURED AGAINST, keyed to ONE item.
     *
     * `per_issued_unit` means the principal input, `per_received_unit` the
     * primary output. Summing across a multi-item challan instead would multiply
     * the rate by 100 PCS + 5 CONE + 300 PCS = 405, which is 405 of nothing —
     * the same mistake §6.5 refuses everywhere else.
     */
    const consumedByItem = new Map<string, Prisma.Decimal>();
    for (const allocation of allocations) {
      consumedByItem.set(
        allocation.itemId,
        (consumedByItem.get(allocation.itemId) ?? ZERO).plus(allocation.qty),
      );
    }
    const principalInput = await tx.jobOrderStepInput.findFirst({
      where: { organizationId, jobOrderStepId: step.id, isDeleted: false },
      orderBy: { seq: 'asc' },
      select: { itemId: true },
    });
    // A step that lists nothing to consume has no principal item, so the
    // cross-item sum IS the figure — there is only one number in play.
    const principalItemId = principalInput?.itemId ?? null;
    const principalConsumedQty = principalItemId
      ? (consumedByItem.get(principalItemId) ?? ZERO)
      : totals.issued;

    const defs = await loadActiveDefinitions(tx, organizationId, 'job_receipt');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    const receiptNumber = await allocateNumber(tx, organizationId, 'job_receipt');
    const receiptDate = header.receiptDate ?? new Date();

    const receipt = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.jobReceipt.create({
        data: {
          organizationId,
          jobOrderId: step.jobOrderId,
          jobOrderStepId: step.id,
          receiptNumber,
          receiptDate,
          processorType: issues[0]!.processorType,
          processorId: issues[0]!.processorId,
          processorNameSnapshot: issues[0]!.processorNameSnapshot,
          locationId: header.locationId,
          /**
           * 🔴 THE SIX TOTALS ARE THE PRIMARY OUTPUT'S, IN ITS OWN UNIT — not a
           * sum across items. Three items in three units cannot be added, so
           * rather than store a meaningless figure the header describes one row
           * and `job_receipt_outputs` holds the rest.
           *
           * The `outputItemId` / `outputUomId` columns that used to say WHICH row
           * these belong to went on 2026-08-12; it is the primary output, and
           * that is derivable from the child list. `chainNotReady` still sums
           * `totalReceivedQty`, which is why these six stay.
           */
          totalIssuedQty: principalConsumedQty,
          totalReceivedQty: primaryOutput.receivedQty,
          totalAcceptedQty: primaryOutput.acceptedQty,
          totalReworkQty: primaryOutput.reworkQty,
          totalScrapQty: primaryOutput.scrapQty,
          totalReturnedQty: primaryOutput.returnedQty,
          remarks: header.remarks?.trim() || null,
          customFields,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
    );

    /**
     * STEP 1 — consume the input where it physically is: the processor's
     * location. The value that leaves here is what the output batch inherits, which
     * is how cost follows material through the chain without anyone storing it.
     */
    let consumedValue = ZERO;
    const parentBatchIds = new Set<string>();
    for (const allocation of allocations) {
      const balance = await getBalance(tx, {
        organizationId,
        batchId: allocation.batchId,
        locationId: processorLocationId,
      });
      const unitValue = balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : ZERO;
      const lineValue = unitValue.times(allocation.qty).toDecimalPlaces(4);
      consumedValue = consumedValue.plus(lineValue);
      parentBatchIds.add(allocation.batchId);

      await postMovement(tx, {
        organizationId,
        batchId: allocation.batchId,
        locationId: processorLocationId,
        movementType: 'consume',
        qtyOut: allocation.qty,
        valueOut: lineValue,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: receipt.id,
        postedAt: receiptDate,
        userId,
      });
    }

    /**
     * The bill for the work, added to the material's cost. That is what makes
     * "cost per metre after dyeing" answerable at all — and why `rateBasis` had
     * to be decided back on the Process master rather than inferred here (§9.2).
     */
    const charge = processCharge(
      step.rate,
      step.rateBasis,
      principalConsumedQty,
      primaryOutput.receivedQty,
    );
    // The pot (§9.2.1). Everything that came back shares exactly this and no more.
    const totalValue = consumedValue.plus(charge);
    const valueByItem = splitValue(outputRows, totalValue);

    /**
     * STEPS 2–4 — a batch per returned ITEM, and the value split across them.
     *
     * 🔴 Scrap and returned quantities take NO share. The whole cost lands on the
     * pieces that survived, which is the point of §5.5: 4,850 good metres that
     * cost what 5,000 cost. Within one item, accepted and rework then split that
     * item's share by quantity — legitimate here, and ONLY here, because both
     * sides are the same item in the same unit.
     *
     * 🔴 Rework goes into a batch of its OWN, always (plan §7). Merging it into the
     * accepted batch would lose the piece count rework has to be measured by, and
     * the re-issue would have no way to send back only the pieces that failed.
     */
    let outputBatchId: string | null = null;
    let reworkBatchId: string | null = null;
    /** Every batch this receipt wrote into, per output item, in the order the
     * request listed them. The child rows are written after the output rows,
     * which is the only ordering the foreign key allows. */
    const postedByItem = new Map<string, PostedOutputBatch[]>();

    /**
     * 🔴 Posting one side of one returned item: create-or-top-up each batch, post
     * a `produce` per batch, and hand back what was written.
     *
     * The value handed in is the WHOLE side's share; it is divided across the
     * batches by quantity here, where every batch is the same item in the same
     * unit — the one place that ratio means anything (§9.2.1).
     */
    const postSide = async (
      output: ResolvedOutput,
      kind: 'accepted' | 'rework',
      plans: readonly OutputBatchPlan[],
      sideValue: Prisma.Decimal,
    ): Promise<PostedOutputBatch[]> => {
      if (plans.length === 0) return [];
      const shares = splitByQty(
        sideValue,
        plans.map((plan) => plan.qty),
      );
      const posted: PostedOutputBatch[] = [];

      for (const [index, plan] of plans.entries()) {
        const share = shares[index] ?? ZERO;
        let batchId: string;
        let isNewBatch: boolean;

        if (plan.batchId) {
          /**
           * 🔴 TOPPING UP A BATCH THAT ALREADY EXISTS — the second half of a
           * split delivery. Its value is DERIVED from the ledger, so a second
           * `produce` simply moves the weighted average; there is nothing to
           * recompute and nothing that can drift.
           *
           * `sourceDocType` / `sourceDocId` are deliberately NOT rewritten. They
           * say what BORE the batch, and that stays true — every later deposit
           * is on the ledger, keyed to the receipt that made it.
           */
          const existing = existingBatches.get(plan.batchId)!;
          batchId = existing.id;
          isNewBatch = false;

          // 🔴 Genealogy is APPENDED, never replaced (inventory.prisma). This
          // delivery may have consumed batches the first one did not, and a
          // parent list missing them is a trace that cannot be rebuilt. Self is
          // excluded: a step whose output item is also its input can otherwise
          // make a batch its own ancestor.
          const merged = [...new Set([...existing.parentBatchIds, ...parentBatchIds])].filter(
            (id) => id !== existing.id,
          );
          if (merged.length !== existing.parentBatchIds.length) {
            await tx.batch.update({
              where: { id: existing.id },
              data: { parentBatchIds: merged, updatedBy: userId ?? null },
            });
          }
        } else {
          const batch = await createBatch(tx, {
            organizationId,
            itemId: output.itemId,
            uomId: output.uomId,
            ownership,
            ownerPartyId: step.jobOrder.ownerPartyId,
            // 🔴 Genealogy, written here or never. It cannot be reconstructed
            // from history that was not recorded (§11.3). EVERY output traces
            // back to EVERY batch consumed — offcuts came from the same fabric
            // the panels did.
            parentBatchIds: [...parentBatchIds],
            supplierBatchRef: plan.batchReference,
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            sourceDocId: receipt.id,
            userId,
          });
          batchId = batch.id;
          isNewBatch = true;
        }

        await postMovement(tx, {
          organizationId,
          batchId,
          locationId: header.locationId,
          movementType: 'produce',
          qtyIn: plan.qty,
          valueIn: share,
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: receipt.id,
          remarks:
            kind === 'rework' ? 'Rework — to be re-issued against the same step.' : undefined,
          postedAt: receiptDate,
          userId,
        });

        posted.push({ kind, batchId, qty: plan.qty, isNewBatch });
      }

      return posted;
    };

    for (const output of outputRows) {
      const rowValue = valueByItem.get(output.itemId) ?? ZERO;
      /**
       * 🔴 Accepted and rework split the ITEM's share by quantity — legitimate
       * here, and only here, because both sides are the same item in the same
       * unit. Through `splitByQty` rather than two independent divisions: two
       * rounded halves do not add back up to the whole, and the missing paisa
       * would leave the pot disagreeing with what was posted.
       */
      const [acceptedValue, reworkValue] = splitByQty(rowValue, [
        output.acceptedQty,
        output.reworkQty,
      ]) as [Prisma.Decimal, Prisma.Decimal];

      const posted = [
        ...(await postSide(output, 'accepted', output.batches, acceptedValue)),
        ...(await postSide(output, 'rework', output.reworkBatches, reworkValue)),
      ];
      postedByItem.set(output.itemId, posted);

      // The header's two columns are the PRIMARY's, and since 2026-08-21 they
      // name its FIRST batch of each kind rather than its only one. They stay a
      // shortcut for the receipt screen and the rework re-issue; the complete
      // list is `job_receipt_output_batches`.
      if (output.isPrimary) {
        outputBatchId = posted.find((row) => row.kind === 'accepted')?.batchId ?? null;
        reworkBatchId = posted.find((row) => row.kind === 'rework')?.batchId ?? null;
      }
    }

    /**
     * 🔴 The RETURN side, recorded as rows (§5.7). `customFields` is left at its
     * default — the list is not a registered entity type, so there is nothing an
     * org could have defined to put in it.
     */
    for (const [index, output] of outputRows.entries()) {
      const posted = postedByItem.get(output.itemId) ?? [];
      const outputRow = await tx.jobReceiptOutput.create({
        data: {
          organizationId,
          jobReceiptId: receipt.id,
          seq: index + 1,
          itemId: output.itemId,
          uomId: output.uomId,
          receivedQty: output.receivedQty,
          acceptedQty: output.acceptedQty,
          reworkQty: output.reworkQty,
          scrapQty: output.scrapQty,
          returnedQty: output.returnedQty,
          isPrimary: output.isPrimary,
          valueShare: output.valueShare,
          // The FIRST batch of each kind, not the only one — see the column's
          // note. `batches` below is the complete record.
          outputBatchId: posted.find((row) => row.kind === 'accepted')?.batchId ?? null,
          reworkBatchId: posted.find((row) => row.kind === 'rework')?.batchId ?? null,
          reasonId: output.reasonId,
          responsibility: output.responsibility,
          remarks: output.remarks,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      /**
       * 🔴 THE COMPLETE LIST OF BATCHES THIS ROW WROTE INTO. Written after the
       * output row because the foreign key points at it, and written for EVERY
       * row including by-products — the guard that reads this at cancellation
       * time is the one that used to miss them.
       */
      for (const [seq, batch] of posted.entries()) {
        await tx.jobReceiptOutputBatch.create({
          data: {
            organizationId,
            jobReceiptId: receipt.id,
            jobReceiptOutputId: outputRow.id,
            seq: seq + 1,
            kind: batch.kind,
            batchId: batch.batchId,
            qty: batch.qty,
            isNewBatch: batch.isNewBatch,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
      }
    }

    /**
     * 🔴 ONE ROW PER RESOLVED ALLOCATION, not per request line.
     *
     * `job_receipt_lines` is the CONSUMPTION record: "which challan line does
     * this close, and by how much". Writing the request's rows verbatim left
     * `jobIssueLineId` null on every bulk line — the client names an item, not a
     * challan line — and every outstanding calculation in this module keys off
     * exactly that column. The consequences were not cosmetic:
     *
     *   · the Receive prefill kept offering the full quantity forever, so the
     *     same challan could be received again and again;
     *   · challans never reached `closed`, because the loop below measures the
     *     same way;
     *   · and the receipt could not say which challans it settled.
     *
     * `allocateConsumption` already worked all of this out to post the ledger.
     * Persisting what it decided is what makes the record match the postings.
     *
     * The disposition columns stay zero here: what came back is on
     * `job_receipt_outputs`, per item, and a number in two places is a number
     * that can disagree with itself.
     */
    const lineDefs = await loadActiveDefinitions(tx, organizationId, 'job_receipt');
    const lineCustomFields = validateCustomFields({
      defs: lineDefs,
      input: lines[0]?.customFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    for (const allocation of allocations) {
      await tx.jobReceiptLine.create({
        data: {
          organizationId,
          jobReceiptId: receipt.id,
          jobIssueId: allocation.jobIssueId,
          jobIssueLineId: allocation.jobIssueLineId,
          issuedQty: allocation.qty,
          customFields: lineCustomFields,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    }

    await tx.jobReceipt.update({
      where: { id: receipt.id },
      data: { outputBatchId, reworkBatchId },
    });

    // Close the challans this receipt fully accounted for.
    for (const issue of issues) {
      const issueLines = await tx.jobIssueLine.findMany({
        where: { organizationId, jobIssueId: issue.id, isDeleted: false },
        select: { id: true, qty: true },
      });
      let outstanding = ZERO;
      for (const line of issueLines) {
        const closed = await tx.jobReceiptLine.aggregate({
          where: { organizationId, jobIssueLineId: line.id, isDeleted: false },
          _sum: { issuedQty: true },
        });
        outstanding = outstanding.plus(line.qty.minus(closed._sum.issuedQty ?? ZERO));
      }
      await tx.jobIssue.update({
        where: { id: issue.id },
        data: { status: outstanding.lessThanOrEqualTo(0) ? 'closed' : 'partially_received' },
      });
    }

    await recomputeStep(tx, organizationId, step.id);

    return tx.jobReceipt.findFirstOrThrow({
      where: { id: receipt.id, organizationId },
      include: RECEIPT_INCLUDE,
    });
  });
}

/**
 * Cancel a receipt: reverse every row it posted.
 *
 * Refused once the batches it touched have moved on. Un-posting a batch that has
 * already been issued to the next step would leave that step holding stock no
 * document explains — and the ledger has no way to express "this never happened"
 * retroactively, only "the opposite happened later".
 *
 * 🔴 THE GUARD BELOW WAS WRONG IN TWO WAYS UNTIL 2026-08-21, and both are the
 * same mistake: it asked a narrower question than the one that matters.
 *
 *   1. It looked at the header's `outputBatchId` / `reworkBatchId` only — the
 *      PRIMARY output's two batches. A receipt returning shirts and offcuts
 *      could be cancelled with the offcut batch already issued onward, because
 *      nothing ever looked at it. Every batch now comes from
 *      `job_receipt_output_batches`, which lists all of them.
 *   2. It tested `sourceDocType != 'job_receipt'`, i.e. "has anything other than
 *      A receipt touched this batch". Now that a LATER receipt can add to a
 *      batch an earlier one created, that reads a top-up as no movement at all
 *      and cancels the first receipt out from under the second. The test is
 *      whether anything other than THIS receipt has moved it.
 */
export async function cancelJobReceipt(
  organizationId: string,
  id: string,
  reason: string,
  userId?: string,
) {
  return runAsDocument(organizationId, async (tx) => {
    const receipt = await tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!receipt) throw ApiError.notFound('Receipt not found');
    if (receipt.status === 'cancelled')
      throw ApiError.conflict('This receipt is already cancelled.');

    const touched = await tx.jobReceiptOutputBatch.findMany({
      where: { organizationId, jobReceiptId: id, isDeleted: false },
      select: { batchId: true, isNewBatch: true, batch: { select: { supplierBatchRef: true } } },
    });

    /**
     * Pre-2026-08-21 receipts have no child rows only if they created no batches
     * at all — the migration backfilled the rest. The header pair is still folded
     * in as a belt-and-braces fallback, deduped, so a receipt whose backfill was
     * somehow missed is guarded rather than waved through.
     */
    const batchIds = new Set(touched.map((row) => row.batchId));
    for (const batchId of [receipt.outputBatchId, receipt.reworkBatchId]) {
      if (batchId) batchIds.add(batchId);
    }
    const refByBatchId = new Map(
      touched.map((row) => [row.batchId, row.batch.supplierBatchRef] as const),
    );

    for (const batchId of batchIds) {
      /**
       * 🔴 THE TEST IS "HAS ANYTHING TAKEN STOCK OUT", not "has anything touched
       * it". Cancelling reverses this receipt's `produce` rows, so the only way
       * that can go wrong is if the quantity it added is no longer there —
       * issued to the next step, sold, transferred away.
       *
       * Quantity somebody else put IN is harmless and must stay allowed, or the
       * ordinary case breaks: a batch created by an earlier receipt and topped up
       * by this one carries the earlier receipt's `produce` forever, and a guard
       * that counted it would make every top-up permanently uncancellable.
       *
       * Rows this receipt posted are excluded by `sourceDocId` — including its
       * own reversals, so a second cancellation attempt reads the same as the
       * first rather than blocking itself.
       */
      const movedOn = await tx.stockLedgerEntry.count({
        where: {
          organizationId,
          batchId,
          qtyOut: { gt: 0 },
          NOT: { sourceDocType: SOURCE_DOC_TYPES.jobReceipt, sourceDocId: id },
        },
      });
      if (movedOn > 0) {
        const label = refByBatchId.get(batchId);
        throw ApiError.conflict(
          `Batch ${label ?? batchId} has already been used since this receipt, so it cannot be cancelled.`,
        );
      }
    }

    const posted = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: id,
        movementType: { not: 'reversal' },
      },
      select: {
        batchId: true,
        locationId: true,
        qtyIn: true,
        qtyOut: true,
        valueIn: true,
        valueOut: true,
      },
    });

    const now = new Date();
    for (const row of posted) {
      await postMovement(tx, {
        organizationId,
        batchId: row.batchId,
        locationId: row.locationId,
        movementType: 'reversal',
        qtyIn: row.qtyOut,
        qtyOut: row.qtyIn,
        valueIn: row.valueOut,
        valueOut: row.valueIn,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: id,
        remarks: `Cancelled: ${reason.trim()}`,
        postedAt: now,
        userId,
      });
    }

    const updated = await tx.jobReceipt.update({
      where: { id },
      data: {
        status: 'cancelled',
        remarks: receipt.remarks
          ? `${receipt.remarks}\nCancelled: ${reason.trim()}`
          : `Cancelled: ${reason.trim()}`,
        updatedBy: userId ?? null,
      },
    });

    // The challans this receipt closed are open again.
    await tx.jobIssue.updateMany({
      where: { organizationId, jobOrderStepId: receipt.jobOrderStepId, status: 'closed' },
      data: { status: 'partially_received' },
    });

    await recomputeStep(tx, organizationId, receipt.jobOrderStepId);
    return updated;
  });
}
