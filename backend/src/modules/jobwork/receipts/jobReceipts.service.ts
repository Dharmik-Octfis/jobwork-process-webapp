import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import { allocateNumber } from '../../../lib/numberSequence.ts';
import { splitByQty } from '../../../lib/splitByQty.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import {
  asResolvedBatch,
  createBatch,
  createBatchUnits,
  getBalancesByBatch,
  getBalancesByBatchAndLocation,
  postMovement,
  resolveBatchesForPosting,
  resolveExistingBatchUnits,
  UNALLOCATED_BATCH_STATE,
  type Ownership,
  type ResolvedBatches,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import {
  assertItemsBelongToOrg,
  assertReceivableLocation,
  assertUomsBelongToOrg,
} from '../jobwork.refs.ts';
import { closedQtyByIssueLine, lockStep } from '../jobwork.posting.ts';
import {
  materialByOutput,
  needTable,
  outputValues,
  usedByItem,
  type CostPlan,
} from './landedCost.ts';
import {
  POSTED_DOC_STATUS,
  SOURCE_DOC_TYPES,
  isExternalLocation,
  runAsDocument,
} from '../jobwork.types.ts';
import { recomputeStep } from '../job-orders/jobOrders.status.ts';
import type {
  CreateJobReceiptInput,
  JobReceiptLineInput,
  JobReceiptOutputBatchInput,
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
    },
  },
  // `type` rides along so the document can say the goods never came back — a
  // receipt into an external location is the dispatch-onward case, and it must
  // not read like an ordinary one.
  location: { select: { id: true, name: true, type: true } },
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
      item: {
        select: { id: true, name: true, sku: true, itemType: true, inventoryTracking: true },
      },
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
  return runAsTenant(organizationId, async (tx) => {
    const receipt = await tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: RECEIPT_INCLUDE,
    });
    if (!receipt) return receipt;

    /**
     * The packages this receipt created, attached to the batch rows they belong
     * to. Read HERE and not in `RECEIPT_INCLUDE`, on purpose: that include is
     * shared with the list endpoint, and a fourth relation level would cost the
     * list a round trip per page for something only the detail screen renders.
     *
     * Keyed on `sourceDocId`, so a top-up shows the rolls THIS delivery brought
     * rather than everything the batch has ever held. One query for the whole
     * receipt, indexed into a Map — never one per batch row.
     */
    const units = await tx.batchUnit.findMany({
      where: {
        organizationId,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: id,
        isDeleted: false,
      },
      orderBy: { seq: 'asc' },
      select: { id: true, batchId: true, seq: true, label: true },
    });
    if (units.length === 0) return receipt;

    const byBatch = new Map<string, typeof units>();
    for (const unit of units) {
      byBatch.set(unit.batchId, [...(byBatch.get(unit.batchId) ?? []), unit]);
    }

    return {
      ...receipt,
      outputs: receipt.outputs.map((output) => ({
        ...output,
        batches: output.batches.map((row) => ({
          ...row,
          units: byBatch.get(row.batch.id) ?? [],
        })),
      })),
    };
  });
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
            // The recipe frozen onto the step — what the cost preview draws by (R1).
            components: {
              where: { isDeleted: false },
              orderBy: { seq: 'asc' },
              select: { componentItemId: true, qtyPerUnit: true },
            },
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

    /**
     * 🔴 Every challan that actually went out — `POSTED_DOC_STATUS`, so drafts
     * and cancellations are excluded and nothing else is.
     *
     * It used to ask for `['issued','partially_received']`, i.e. "not closed",
     * and that was the status doing the work of hiding challans with nothing left
     * on them. With no closing, the same list is derived from the material below:
     * a challan whose every line is exhausted contributes no rows and is dropped
     * from `issues` at the end. Same screen, one fewer thing to keep in step.
     */
    const issues = await tx.jobIssue.findMany({
      where: {
        organizationId,
        jobOrderStepId,
        isDeleted: false,
        status: POSTED_DOC_STATUS,
      },
      orderBy: { issueDate: 'asc' },
      include: {
        // Where these goods are standing. The dialog needs it to offer "they
        // stayed there" as a receive-into option — the one external location a
        // receipt may name, and only because the challan itself put them there.
        destination: { select: { id: true, name: true } },
        lines: {
          where: { isDeleted: false },
          // Oldest first, the order `allocateConsumption` walks them in.
          orderBy: { createdAt: 'asc' },
          include: {
            item: { select: { id: true, name: true, sku: true } },
            uom: { select: { id: true, unitName: true, symbol: true } },
            batch: { select: { id: true, supplierBatchRef: true } },
          },
        },
      },
    });

    // Outstanding per issue LINE, so a partly-received challan does not offer the
    // same taka twice. One read for every line between them, not one per line.
    const closedByLine = await closedQtyByIssueLine(
      tx,
      organizationId,
      issues.flatMap((issue) => issue.lines.map((line) => line.id)),
    );

    /**
     * What a unit of each line's batch is worth where it stands — the price the
     * Receive screen's cost preview values material at (landed-cost §6.7). One
     * grouped read per place the challans went, which is a single place on every
     * ordinary step; never a read per line.
     */
    const unitCostByLine = new Map<string, Prisma.Decimal>();
    const linesByDestination = new Map<string, { id: string; batchId: string }[]>();
    for (const issue of issues) {
      const atDestination = linesByDestination.get(issue.destinationLocationId) ?? [];
      atDestination.push(...issue.lines.map((line) => ({ id: line.id, batchId: line.batchId })));
      linesByDestination.set(issue.destinationLocationId, atDestination);
    }
    for (const [locationId, atDestination] of linesByDestination) {
      const balances = await getBalancesByBatch(tx, {
        organizationId,
        locationId,
        batchIds: [...new Set(atDestination.map((line) => line.batchId))],
      });
      for (const line of atDestination) {
        const balance = balances.get(line.batchId);
        unitCostByLine.set(
          line.id,
          balance && balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : ZERO,
        );
      }
    }

    const rows = [];
    for (const issue of issues) {
      for (const line of issue.lines) {
        const outstanding = line.qty.minus(closedByLine.get(line.id) ?? ZERO);
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
          unitCost: (unitCostByLine.get(line.id) ?? ZERO).toDecimalPlaces(6).toString(),
        });
      }
    }

    /* Challans with nothing left to account for, dropped here rather than by a
       `closed` status. `rows` already skips an exhausted LINE; this is the same
       rule one level up, so the picker offers exactly the challans that have
       something on them. */
    const live = new Set(rows.map((row) => row.jobIssueId));

    // Challans a posted receipt closed (R14), so the screen can say "Closed by
    // JR-…" instead of letting them vanish like a challan that merely came out even.
    const closing = await tx.jobReceiptLine.findMany({
      where: {
        organizationId,
        jobIssueId: { in: issues.map((issue) => issue.id) },
        closesChallan: true,
        isDeleted: false,
        jobReceipt: { isDeleted: false, status: POSTED_DOC_STATUS },
      },
      distinct: ['jobIssueId'],
      select: { jobIssueId: true, jobReceipt: { select: { id: true, receiptNumber: true } } },
    });
    const closedBy = new Map(closing.map((row) => [row.jobIssueId, row.jobReceipt]));

    return {
      step,
      issues: issues
        .filter((issue) => live.has(issue.id))
        .map((issue) => ({
          id: issue.id,
          challanNumber: issue.challanNumber,
          issueDate: issue.issueDate,
          totalQty: issue.totalQty.toString(),
          isRework: issue.isRework,
          attemptNo: issue.attemptNo,
          // Who is holding it and where. Both are per challan because the dialog
          // only offers "they stayed there" once the picked challans agree — which
          // is the same condition the save enforces.
          processorName: issue.processorNameSnapshot,
          destinationLocationId: issue.destinationLocationId,
          destinationName: issue.destination?.name ?? null,
        })),
      closedIssues: issues
        .filter((issue) => !live.has(issue.id) && closedBy.has(issue.id))
        .map((issue) => ({
          id: issue.id,
          challanNumber: issue.challanNumber,
          closedByReceiptId: closedBy.get(issue.id)!.id,
          closedByReceiptNumber: closedBy.get(issue.id)!.receiptNumber,
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
        // The agreed charge per accepted unit, which the Rate box opens with (R6).
        rate: row.rate?.toString() ?? null,
      })),
    };
  });
}

/**
 * How many "other batches" one page carries. Sized to the picker's own geometry:
 * each option renders two or three lines, so a smaller page would fire a fetch on
 * almost every scroll gesture — and a page is not one query, it also costs the
 * balance and location lookups below.
 */
const OTHER_BATCH_PAGE = 25;

/**
 * The keyset one page resumes from — `<createdAt>|<id>`, matching
 * `ORDER BY created_at DESC, id DESC`.
 *
 * 🔴 Keyset, not `OFFSET`. Offset makes Postgres walk and discard every row of
 * every earlier page, and — worse for a picker — a batch created while somebody
 * is scrolling shifts the whole tail by one, so rows silently duplicate or go
 * missing. `created_at` alone is not unique enough to page on; the id breaks ties.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function decodeCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const at = raw.indexOf('|');
  if (at === -1) return null;
  const createdAt = new Date(raw.slice(0, at));
  const id = raw.slice(at + 1);
  // A hand-edited cursor reads as "start from the beginning" rather than a 500.
  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
}

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
 *     its own challans sent out. Returned whole, whatever their balance and
 *     wherever they sit.
 *   `otherBatches` — anything else of that item, one keyset page at a time. The
 *     client warns on these; the SERVICE does not refuse them, because two job
 *     orders dyed in one bath is real (see `loadExistingOutputBatches`).
 *
 * 🔴 THE SECOND GROUP USED TO ANSWER A SEARCH ONLY, and stopped on 2026-08-22.
 * The intent was that merging into an unrelated batch should be a deliberate act
 * — which still holds, and is why the two groups remain separate and separately
 * labelled. But it made a FIRST receipt open the picker on two empty sections:
 * this job order has produced nothing yet, and everything else sat behind a
 * search box with nothing to say it held anything at all. An empty dropdown is
 * indistinguishable from a broken screen. Deliberateness is carried by the
 * labelling and the per-row warning now, not by hiding the rows.
 */
export async function getOutputBatchOptions(
  organizationId: string,
  query: {
    jobOrderStepId: string;
    itemId: string;
    search?: string;
    cursor?: string;
    withUnits?: boolean;
  },
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
      // `'posted'` exactly — not "not cancelled". A draft receipt created no
      // batch, so it has none to continue.
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
        // Posted challans only — a draft's batches never left the godown, so
        // offering them here would suggest continuing a lot that was never sent.
        jobIssue: { jobOrderId: step.jobOrderId, isDeleted: false, status: POSTED_DOC_STATUS },
      },
      select: { batchId: true },
    });

    const base: Prisma.BatchWhereInput = {
      organizationId,
      itemId: query.itemId,
      isDeleted: false,
      // Never offered as something to add to — see `UNALLOCATED_BATCH_STATE`.
      state: { not: UNALLOCATED_BATCH_STATE },
      ...ownershipWhere,
    };

    const provenanceOr: Prisma.BatchWhereInput = {
      OR: [
        {
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: { in: priorReceipts.map((row) => row.id) },
        },
        { id: { in: issuedBatches.map((row) => row.batchId) } },
      ],
    };

    /**
     * 🔴 `batchNumber` is NOT searchable and must not become so (2026-08-14). It
     * is an internal key nobody can be typing, so matching on it only pollutes
     * results — a search for `42` would hit numbers that have nothing to do with
     * the batch in mind. What people type is what is on the physical tag.
     *
     * 🔴 It narrows BOTH groups. It used to filter the second only, which was
     * invisible while that group was search-gated and the first was always shown
     * whole. Now that both are listed, an unfiltered group sitting above a
     * filtered one reads as the search having failed.
     */
    const search = query.search?.trim();
    const searchWhere: Prisma.BatchWhereInput[] = search
      ? [
          {
            OR: [
              { supplierBatchRef: { contains: search, mode: 'insensitive' } },
              { manufacturerBatch: { contains: search, mode: 'insensitive' } },
            ],
          },
        ]
      : [];

    /**
     * 🔴 NOT paged, and the second group's exclusion is why: `otherBatches` is
     * "everything of this item that is NOT one of these", expressed as an id
     * list, so a partial list here would let the same batch appear in both
     * groups. Fetching it whole is safe because the set is bounded by
     * construction — roughly one batch per prior delivery. The 3-row cap in the
     * picker is a rendering decision taken on top of this, not a data one.
     */
    const jobOrderBatches = await tx.batch.findMany({
      where: { ...base, AND: [provenanceOr, ...searchWhere] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: BATCH_OPTION_SELECT,
    });

    const cursor = decodeCursor(query.cursor);
    const otherRows = await tx.batch.findMany({
      where: {
        ...base,
        NOT: { id: { in: jobOrderBatches.map((row) => row.id) } },
        AND: [
          ...searchWhere,
          // The keyset. Prisma has no row-value comparison, so `(created_at, id)
          // < (?, ?)` is spelled out as the two cases it expands to.
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than the page, so "is there another page" costs a row rather
      // than a COUNT over an unbounded set.
      take: OTHER_BATCH_PAGE + 1,
      select: BATCH_OPTION_SELECT,
    });
    const hasMore = otherRows.length > OTHER_BATCH_PAGE;
    const otherBatches = hasMore ? otherRows.slice(0, OTHER_BATCH_PAGE) : otherRows;

    /**
     * Only page one carries the first group. Every later page is a scroll
     * through the second, and re-shaping the first would spend a balance query
     * and a location query per page on rows the client is already holding.
     */
    const isFirstPage = cursor === null;
    const all = isFirstPage ? [...jobOrderBatches, ...otherBatches] : otherBatches;

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

    /**
     * The packages each listed batch already holds, so the dialog can offer "add
     * to an existing one" without a round trip per row. One grouped query for the
     * whole page, indexed into a Map — never one per batch.
     *
     * Opt-in via `withUnits`, spelled exactly as on the batches picker: it costs
     * an extra query, and only an org running the unit level can render them.
     * Off, `units` is an empty array and the dialog renders as it always did.
     */
    const unitsByBatch = new Map<string, { batchUnitId: string; seq: number; label: string }[]>();
    if (query.withUnits) {
      const unitRows = await tx.batchUnit.findMany({
        where: { organizationId, batchId: { in: all.map((row) => row.id) }, isDeleted: false },
        orderBy: { seq: 'asc' },
        select: { id: true, batchId: true, seq: true, label: true },
      });
      for (const row of unitRows) {
        unitsByBatch.set(row.batchId, [
          ...(unitsByBatch.get(row.batchId) ?? []),
          { batchUnitId: row.id, seq: row.seq, label: row.label },
        ]);
      }
    }

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
        // What the batch already carries, so a top-up row can show it rather than
        // invite somebody to restate it.
        sellingPrice: batch.sellingPrice?.toString() ?? null,
        mrp: batch.mrp?.toString() ?? null,
        uomId: batch.uomId,
        source,
        totalQty: total.toString(),
        internalQty: total.minus(external).toString(),
        externalQty: external.toString(),
        byLocation: rows,
        units: unitsByBatch.get(batch.id) ?? [],
      };
    };

    const last = otherBatches[otherBatches.length - 1];

    return {
      inventoryTracking: item.inventoryTracking,
      jobOrderBatches: isFirstPage
        ? jobOrderBatches.map((row) => shape(row, 'this_job_order'))
        : [],
      otherBatches: otherBatches.map((row) => shape(row, 'other')),
      /** Where the next page resumes, or null at the end of the list. */
      otherNextCursor: hasMore && last ? encodeCursor(last) : null,
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
  sellingPrice: true,
  mrp: true,
  uomId: true,
} satisfies Prisma.BatchSelect;

/**
 * One batch a returned row will land in, resolved from the request but not yet
 * written. Exactly one of the two identifiers is set: `batchId` names an
 * existing batch to add to, `batchReference` names a batch to create.
 */
interface OutputBatchPlan {
  batchId: string | null;
  batchReference: string | null;
  qty: Prisma.Decimal;
  /** 🔴 Only ever set on a `batchReference` row — the schema refuses these beside
   * a `batchId`, because a batch that already exists is added to and never
   * restamped from inside a receipt. */
  attributes: OutputBatchAttributes;
  /**
   * The packages physically handed back inside this batch. Allowed on a top-up
   * too — the second half of a split delivery is three more rolls, not a
   * correction to the first half's. Empty, or totalling `qty` together with
   * `existingUnits`: naming some but not all has been refused since 2026-09-02.
   */
  units: { label: string; qty: Prisma.Decimal }[];
  /**
   * Packages that ALREADY exist and are being added to — the same roll returning
   * a second time. Separate from `units` because they take the other path: one is
   * created, the other only resolved. Only ever set on a `batchId` row.
   */
  existingUnits: { batchUnitId: string; qty: Prisma.Decimal }[];
}

/** The packages a plan names, normalised and split by which path they take.
 * Empty when the org runs no unit level, which is every receipt written before
 * this feature existed. */
function batchUnits(row: JobReceiptOutputBatchInput): { label: string; qty: Prisma.Decimal }[] {
  return (row.units ?? [])
    .filter((unit) => !unit.batchUnitId)
    .map((unit) => ({
      // Blank is legal — `createBatchUnits` auto-names it `#seq`.
      label: (unit.label ?? '').trim(),
      qty: new Prisma.Decimal(unit.qty),
    }));
}

function existingBatchUnits(
  row: JobReceiptOutputBatchInput,
): { batchUnitId: string; qty: Prisma.Decimal }[] {
  return (row.units ?? [])
    .filter((unit) => unit.batchUnitId)
    .map((unit) => ({
      batchUnitId: unit.batchUnitId!,
      qty: new Prisma.Decimal(unit.qty),
    }));
}

/** What a NEW batch is stamped with at the gate. Every field means "not stated"
 * when null, which is a different fact from zero on the two prices. */
interface OutputBatchAttributes {
  manufacturerBatch: string | null;
  manufacturedDate: Date | null;
  expiryDate: Date | null;
  sellingPrice: number | null;
  mrp: number | null;
}

const NO_BATCH_ATTRIBUTES: OutputBatchAttributes = {
  manufacturerBatch: null,
  manufacturedDate: null,
  expiryDate: null,
  sellingPrice: null,
  mrp: null,
};

function batchAttributes(row: JobReceiptOutputBatchInput): OutputBatchAttributes {
  return {
    manufacturerBatch: row.manufacturerBatch?.trim() || null,
    manufacturedDate: row.manufacturedDate ?? null,
    expiryDate: row.expiryDate ?? null,
    sellingPrice: row.sellingPrice ?? null,
    mrp: row.mrp ?? null,
  };
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
  /** The rate agreed for this receipt; null takes the job order's (R6). */
  rate: Prisma.Decimal | null;
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
        rate: null,
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
      rate: row.rate == null ? null : new Prisma.Decimal(row.rate),
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
            attributes: batchAttributes(batch),
            units: batchUnits(batch),
            existingUnits: existingBatchUnits(batch),
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
            attributes: batchAttributes(batch),
            units: batchUnits(batch),
            existingUnits: existingBatchUnits(batch),
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
  // No attributes and no packages: the older shape had nowhere to state either.
  return [
    {
      batchId: null,
      batchReference,
      qty,
      attributes: NO_BATCH_ATTRIBUTES,
      units: [],
      existingUnits: [],
    },
  ];
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

      /**
       * 🔴 THE SAME CHECK ONE LEVEL DOWN, and since 2026-09-02 it is an EQUALITY
       * too — naming any package commits to naming them all, so a batch is broken
       * down completely or not at all. Naming NONE stays legal, which is what
       * keeps every org without the level, and every receipt posted before it
       * existed, working exactly as before.
       *
       * 🔴 Top-ups count. `existingUnits` is quantity going onto a package the
       * batch already holds, so leaving it out of the sum let a receipt name half
       * the batch and pass — the bug this line closes.
       *
       * Beside the write, not only in the schema: `validateBody` runs on the HTTP
       * route alone, and a script, an import or a test must not be able to post a
       * receipt whose packages do not account for the batch they are inside.
       */
      for (const [batchIndex, plan] of side.plans.entries()) {
        if (plan.units.length === 0 && plan.existingUnits.length === 0) continue;
        const inUnits = [...plan.units, ...plan.existingUnits].reduce(
          (sum, unit) => sum.plus(unit.qty),
          ZERO,
        );
        if (inUnits.minus(plan.qty).abs().greaterThan(tolerance)) {
          const label = plan.batchReference ?? 'the batch';
          throw new ApiError(
            400,
            `Returned item ${index + 1}: the units inside ${label} add up to ` +
              `${inUnits.toString()}, not the ${plan.qty.toString()} that came back into it.`,
            {
              [`outputs.${index}.${side.field}.${batchIndex}.units`]:
                'The units must account for the whole batch, or name none at all.',
            },
          );
        }

        const labels = plan.units.map((unit) => unit.label.toLowerCase());
        if (new Set(labels).size !== labels.length) {
          throw new ApiError(
            400,
            `Returned item ${index + 1}: two units of one batch share a label. A label is a physical tag, so it has to be unique.`,
            {
              [`outputs.${index}.${side.field}.${batchIndex}.units`]: 'A label is used twice.',
            },
          );
        }
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
  state: string;
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
      state: true,
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
    // Caught here as well as in `postMovement`, because a draft never posts and
    // would otherwise park a receipt that can never be opened.
    if (batch.state === UNALLOCATED_BATCH_STATE) {
      throw ApiError.badRequest(
        'A receipt cannot add to unallocated opening stock. Pick a named batch or create a new one.',
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
  /**
   * 🔴 WHICH PACKAGE went out on that challan line, so the consume can take it
   * back out of the same one.
   *
   * Not optional decoration. A challan that sent a whole roll leaves the batch
   * FULLY tagged at the processor, so an untagged consume against it is refused
   * by `postMovement`'s invariant — the packages would claim more than the batch
   * held. Carrying the package through is what makes a receipt against a
   * package-wise challan possible at all.
   *
   * A PARTIAL consume of a package is fine and stays fine: taking quantity out of
   * a package lowers both sides of that inequality equally, so what is left of
   * the roll simply stays at the processor.
   */
  batchUnitId: string | null;
  /** Which item was consumed — the challan line's own (§5.7). Material value is
   * split across outputs per item (R5). */
  itemId: string;
  qty: Prisma.Decimal;
}

/** A line of a ticked challan, with what is still at the processor on it. */
interface OpenIssueLine {
  id: string;
  jobIssueId: string;
  batchId: string;
  batchUnitId: string | null;
  itemId: string;
  outstanding: Prisma.Decimal;
}

async function openIssueLines(
  tx: TenantClient,
  organizationId: string,
  issueIds: readonly string[],
): Promise<OpenIssueLine[]> {
  const issueLines = await tx.jobIssueLine.findMany({
    where: { organizationId, jobIssueId: { in: [...issueIds] }, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      jobIssueId: true,
      batchId: true,
      batchUnitId: true,
      qty: true,
      itemId: true,
    },
  });
  const closedByLine = await closedQtyByIssueLine(
    tx,
    organizationId,
    issueLines.map((line) => line.id),
  );
  return issueLines.map(({ qty, ...line }) => ({
    ...line,
    outstanding: qty.minus(closedByLine.get(line.id) ?? ZERO),
  }));
}

/**
 * What stops a step's plan from costing a receipt — the same gaps the issue
 * refuses (V4), plus a composite with no recipe frozen onto it, which only a
 * step planned before landed costing can have.
 */
function costingProblems(step: {
  inputs: readonly { itemId: string; plannedQty: Prisma.Decimal | null; item: { name: string } }[];
  outputs: readonly {
    itemId: string;
    expectedQty: Prisma.Decimal | null;
    item: { name: string; itemStructure: string };
    components: readonly unknown[];
  }[];
}): string[] {
  const inputIds = new Set(step.inputs.map((row) => row.itemId));
  const noPlanned = step.inputs
    .filter((row) => !row.plannedQty || row.plannedQty.lessThanOrEqualTo(0))
    .map((row) => row.item.name);
  const noExpected = step.outputs
    .filter((row) => !row.expectedQty || row.expectedQty.lessThanOrEqualTo(0))
    .map((row) => row.item.name);
  // A pass-through output draws on itself and needs no recipe (R1).
  const noRecipe = step.outputs
    .filter(
      (row) =>
        row.item.itemStructure === 'composite' &&
        row.components.length === 0 &&
        !inputIds.has(row.itemId),
    )
    .map((row) => row.item.name);
  return [
    ...(step.outputs.length === 0 ? ['it lists nothing it produces'] : []),
    ...(noPlanned.length ? [`no planned quantity for ${noPlanned.join(', ')}`] : []),
    ...(noExpected.length ? [`no expected quantity for ${noExpected.join(', ')}`] : []),
    ...(noRecipe.length ? [`no recipe frozen onto the job order for ${noRecipe.join(', ')}`] : []),
  ];
}

/**
 * Decide which issue lines this receipt consumes, and how much of each.
 *
 * Unit-wise lines name their own issue line, so the answer is given. Bulk lines
 * do not — one total per item closes whatever is still outstanding, oldest first.
 * FIFO rather than proportional because the batches went out in an order and came
 * back in that order; splitting a bulk return across every open line by ratio
 * invents a mixing that did not happen.
 */
function allocateConsumption(
  issueLines: readonly OpenIssueLine[],
  lines: readonly JobReceiptLineInput[],
  /**
   * 🔴 THE DRAFT PATH. Over-receiving stops being an error and becomes a number
   * the document is allowed to hold: the goods may genuinely not all be back yet,
   * the operator may be entering what the delivery note claims before counting
   * it, and a draft that refuses to save until the arithmetic closes is a draft
   * that cannot be used for the one job drafts exist for.
   *
   * The remainder rides on the last eligible challan line so the quantity the
   * user typed survives the round trip. Nothing is posted either way — the strict
   * pass runs again at post, and refuses then.
   */
  lenient = false,
  /** The challans this receipt closes — served first in the bulk walk (R12). */
  closedIssueIds: ReadonlySet<string> = new Set(),
): ConsumeAllocation[] {
  const outstanding = new Map(issueLines.map((line) => [line.id, line.outstanding]));

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
      if (toConsume.greaterThan(left) && !lenient) {
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
        batchUnitId: issueLine.batchUnitId,
        itemId: issueLine.itemId,
        qty: toConsume,
      });
      continue;
    }

    /**
     * 🔴 Bulk: walk the open lines WITHIN ONE ITEM — closed challans first, then
     * oldest first (challan-closure R12).
     *
     * Unscoped by item, this settles a panel receipt by consuming thread, because
     * the thread's lines are simply older. The item is asked for whenever the
     * challans carry more than one; with a single item there is nothing to
     * disambiguate and the old shape keeps working.
     *
     * Oldest-first alone is not enough once a challan can be closed: closing the
     * NEWER of two challans would spend the quantity on the older one and leave
     * the closed challan still holding stock — ticking Close would close nothing.
     * The sort is stable, so each group keeps its oldest-first order.
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
    const eligible = (
      line.itemId ? issueLines.filter((issueLine) => issueLine.itemId === line.itemId) : issueLines
    ).toSorted(
      (a, b) => Number(closedIssueIds.has(b.jobIssueId)) - Number(closedIssueIds.has(a.jobIssueId)),
    );
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
        batchUnitId: issueLine.batchUnitId,
        itemId: issueLine.itemId,
        qty: take,
      });
    }

    if (toConsume.greaterThan(0)) {
      // A draft keeps the surplus, hung on the last line it could reach, so the
      // typed quantity is still there when the draft is reopened. With no
      // eligible line at all there is nothing to hang it on and it is dropped —
      // the draft still saves, and the post refuses it.
      const last = eligible[eligible.length - 1];
      if (lenient) {
        if (last) {
          allocations.push({
            jobIssueId: last.jobIssueId,
            jobIssueLineId: last.id,
            batchId: last.batchId,
            batchUnitId: last.batchUnitId,
            itemId: last.itemId,
            qty: toConsume,
          });
        }
        continue;
      }

      throw ApiError.badRequest(
        `${toConsume.toString()} more is being received than these challans still have outstanding.`,
      );
    }
  }

  return allocations;
}

/**
 * 🔴 SAVING A RECEIPT — as a draft, or posted. One function, for the same reason
 * `createNewJobIssue` is one: the two differ in what they check and what they
 * write, never in what they mean, and a second path is a second place for a rule
 * to go missing.
 *
 * WHAT A DRAFT SKIPS
 *
 *   · the disposition sum check   — the split is still being typed.
 *   · allocation balance          — the batches have not been named yet.
 *   · over-receipt                — `allocateConsumption({ lenient })`.
 *   · `createBatch` / packages    — 🔴 no batch is born by parking a form.
 *   · `postMovement`              — 🔴 THE POINT. No consume, no produce.
 *   · closing the challans        — a draft settles nothing, so the challans it
 *                                   names stay open and receivable.
 *   · `recomputeStep`             — nothing moved.
 *
 * 🔴 AND ONE THING A DRAFT LOSES, deliberately (2026-09-04). An output batch the
 * user is CREATING has no `batches` row to point at — `job_receipt_output_batches
 * .batch_id` is a NOT NULL foreign key to a real batch — and inventing that batch
 * early is exactly the thing a draft must not do. So new-batch allocations are
 * not saved; allocations that TOP UP an existing batch are. Reopening the draft
 * asks for the batch reference again, and `postJobReceiptDraft` refuses to post a
 * draft that never got one rather than guessing a label.
 */
export type ReceiptSaveMode = 'draft' | 'post';

export async function createNewJobReceipt(
  organizationId: string,
  data: CreateJobReceiptInput,
  userId?: string,
  mode: ReceiptSaveMode = 'post',
  existingId?: string,
) {
  const {
    customFields: rawCustomFields,
    lines,
    outputs: sentOutputs,
    issueIds,
    closedIssueIds = [],
    ...header
  } = data;
  const asDraft = mode === 'draft';
  const closedIssues = new Set(closedIssueIds);

  // Consumes fifty, produces fifty, and creates a package per accepted taka —
  // past Prisma's 5-second default (jobwork.types.ts).
  return runAsDocument(organizationId, async (tx) => {
    // First, so the outstanding quantities below include any receipt that just
    // posted on this step. A draft consumes nothing and does not lock.
    if (!asDraft) await lockStep(tx, organizationId, header.jobOrderStepId);

    const existing = existingId
      ? await tx.jobReceipt.findFirst({
          where: { id: existingId, organizationId, isDeleted: false },
          select: { id: true, status: true, receiptNumber: true },
        })
      : null;
    if (existingId && !existing) throw ApiError.notFound('Receipt not found');
    if (existing && existing.status !== 'draft') {
      throw ApiError.conflict(
        'This receipt has already been posted, so it can no longer be edited. ' +
          'Cancel it and enter a new one instead.',
      );
    }

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
    // R9: nothing more comes back against a finished step — what was left at the
    // processor has been written off, and a receipt now would consume it twice.
    if (step.status === 'completed' || step.status === 'short_closed') {
      throw ApiError.conflict(
        'This step has been completed or closed short, so nothing more can be received against it.',
      );
    }

    await assertItemsBelongToOrg(tx, organizationId, [header.outputItemId]);
    await assertUomsBelongToOrg(tx, organizationId, [header.outputUomId]);

    const issues = await tx.jobIssue.findMany({
      where: {
        id: { in: issueIds },
        organizationId,
        jobOrderStepId: step.id,
        isDeleted: false,
        // 🔴 A DRAFT CHALLAN CANNOT BE RECEIVED AGAINST, in either mode. Nothing
        // was sent, so there is nothing at the processor to come back — and a
        // receipt against one would consume stock the ledger says never left.
        status: POSTED_DOC_STATUS,
      },
      select: {
        id: true,
        challanNumber: true,
        destinationLocationId: true,
        processorType: true,
        processorId: true,
        processorNameSnapshot: true,
        // Rework and first-pass challans are costed by different rules (R1).
        isRework: true,
      },
    });
    if (issues.length !== issueIds.length) {
      throw ApiError.badRequest(
        'One of the selected challans does not belong to this step, or has been cancelled.',
      );
    }
    // Beside the write as well as in the schema, which runs on the HTTP route alone.
    if (closedIssueIds.some((id) => !issueIds.includes(id))) {
      throw new ApiError(
        400,
        'A challan can only be closed by a receipt that is received against it.',
        {
          closedIssueIds: 'Tick the challan before closing it.',
        },
      );
    }
    const challanNumberOf = (issueId: string) =>
      issues.find((issue) => issue.id === issueId)?.challanNumber ?? 'a challan';

    /**
     * 🔴 R14 — a challan closed by a POSTED receipt takes no more receipts. Reopening
     * it is cancelling that receipt (plan §0): its consume reverses and its lines stop
     * counting here, so the challan is open again with nothing else to undo. Checked
     * on a draft too — a draft that can never post is a document parked with a fault.
     */
    const alreadyClosed = await tx.jobReceiptLine.findMany({
      where: {
        organizationId,
        jobIssueId: { in: issueIds },
        closesChallan: true,
        isDeleted: false,
        jobReceipt: { isDeleted: false, status: POSTED_DOC_STATUS },
      },
      distinct: ['jobIssueId'],
      select: { jobIssueId: true, jobReceipt: { select: { receiptNumber: true } } },
    });
    if (alreadyClosed.length > 0) {
      const named = alreadyClosed
        .map(
          (row) =>
            `${challanNumberOf(row.jobIssueId!)} (closed by ${row.jobReceipt.receiptNumber})`,
        )
        .join(', ');
      const message =
        `Nothing more can be received on ${named}. Cancel the receipt that closed it to ` +
        'reopen the challan.';
      throw new ApiError(409, message, { issueIds: message });
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
    const processorLocationId = issues[0]?.destinationLocationId ?? null;

    // Somewhere we hold, or the one shed these very challans are standing in —
    // asked here rather than above because the second answer is `processorLocationId`,
    // which the challans decide. Asked for a draft too: a draft naming a location
    // the post will refuse is a document parked with a fault in it.
    await assertReceivableLocation(tx, organizationId, header.locationId, processorLocationId);

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
    // Not on a draft: the split is what the operator is still working out, and
    // the whole reason to park the form is that it does not add up yet.
    for (const [index, line] of asDraft ? [] : lines.entries()) {
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
     * 🔴 THE LANDED COST (docs/JOBWORK_LANDED_COST_PLAN.md §6.5, R1–R7).
     *
     * A receipt no longer settles its challans in full. It works out how much
     * material what came back used — from the ratio the step's own plan states,
     * planned input against expected output — unless the processor's figure was
     * typed, and allocates exactly that, oldest challan line first — after the lines
     * of any challan it closes, which it empties (challan-closure R10–R12). Whatever the
     * plan did not account for stays at the processor until the step is completed.
     */
    const reworkChallans = issues.filter((issue) => issue.isRework).length;
    const isRework = reworkChallans > 0;
    if (isRework && reworkChallans !== issues.length) {
      throw new ApiError(
        400,
        'Rework and first-pass challans consume different items by different rules, so they ' +
          'cannot be received on one receipt. Receive them separately.',
        { issueIds: 'Pick only rework challans, or only first-pass ones.' },
      );
    }

    // The plan the receipt is costed by — frozen on the step, read in one query.
    const planStep = await tx.jobOrderStep.findFirstOrThrow({
      where: { id: step.id, organizationId },
      select: {
        seq: true,
        inputs: {
          where: { isDeleted: false },
          orderBy: { seq: 'asc' },
          select: { itemId: true, uomId: true, plannedQty: true, item: { select: { name: true } } },
        },
        outputs: {
          where: { isDeleted: false },
          orderBy: { seq: 'asc' },
          select: {
            itemId: true,
            uomId: true,
            expectedQty: true,
            rate: true,
            item: { select: { name: true, itemStructure: true } },
            components: {
              where: { isDeleted: false },
              orderBy: { seq: 'asc' },
              select: { componentItemId: true, qtyPerUnit: true },
            },
          },
        },
      },
    });
    const plan: CostPlan = { inputs: planStep.inputs, outputs: planStep.outputs };
    const plannedOutputByItem = new Map(planStep.outputs.map((row) => [row.itemId, row]));
    const itemName = (itemId: string) =>
      [...planStep.inputs, ...planStep.outputs].find((row) => row.itemId === itemId)?.item.name ??
      'an item';

    // Rework has no plan of its own (R2), and a draft is still being typed.
    if (!isRework && !asDraft) {
      const problems = costingProblems(planStep);
      if (problems.length > 0) {
        const message =
          `Step ${planStep.seq} cannot be costed: ${problems.join('; ')}. Complete its plan on the ` +
          'job order while it is still editable — otherwise it was planned before landed costing, ' +
          'so complete it or close it short.';
        throw new ApiError(409, message, { plan: message });
      }
      const unplanned = outputRows.filter((row) => !plannedOutputByItem.has(row.itemId));
      if (unplanned.length > 0) {
        throw new ApiError(
          400,
          'What came back includes an item this step’s plan does not list, so nothing says what ' +
            'it is made from or what it costs. Add it to the job order first.',
          { outputs: 'Only items on the step’s plan can be received.' },
        );
      }
    }

    // What is still out on the ticked challans, per line and per item — read once.
    const issueLines = await openIssueLines(tx, organizationId, issueIds);
    const outstandingByItem = new Map<string, Prisma.Decimal>();
    for (const line of issueLines) {
      outstandingByItem.set(
        line.itemId,
        (outstandingByItem.get(line.itemId) ?? ZERO).plus(line.outstanding),
      );
    }
    const inputItemIds = [...outstandingByItem.keys()];

    // R11 — closing a challan consumes everything still out on it, per item.
    const closedFloor = new Map<string, Prisma.Decimal>();
    for (const line of issueLines) {
      if (!closedIssues.has(line.jobIssueId) || line.outstanding.lessThanOrEqualTo(0)) continue;
      closedFloor.set(line.itemId, (closedFloor.get(line.itemId) ?? ZERO).plus(line.outstanding));
    }

    // A typed Used figure, per item. Zero or blank means "work it out" (R4).
    const itemOfIssueLine = new Map(issueLines.map((line) => [line.id, line.itemId]));
    const itemOfLine = (line: JobReceiptLineInput) =>
      line.itemId ??
      (line.jobIssueLineId ? itemOfIssueLine.get(line.jobIssueLineId) : undefined) ??
      (inputItemIds.length === 1 ? inputItemIds[0] : undefined);
    const typedLines = lines.filter((line) => (line.issuedQty ?? 0) > 0);
    const typedByItem = new Map<string, Prisma.Decimal>();
    for (const line of typedLines) {
      const itemId = itemOfLine(line);
      // An ambiguous line is refused by `allocateConsumption`, which names the fix.
      if (!itemId) continue;
      typedByItem.set(itemId, (typedByItem.get(itemId) ?? ZERO).plus(line.issuedQty!));
    }

    const needs = needTable(
      plan,
      inputItemIds,
      outputRows.map((row) => ({
        itemId: row.itemId,
        acceptedQty: row.acceptedQty,
        reworkQty: row.reworkQty,
      })),
      isRework,
    );
    const { used, undrawn, belowFloor, closedUndrawn } = usedByItem(
      needs,
      inputItemIds,
      typedByItem,
      outstandingByItem,
      closedFloor,
    );

    // R13 — beside the undrawn refusal below, which is the same condition typed.
    if (!asDraft && closedUndrawn.length > 0) {
      const challans = [
        ...new Set(
          issueLines
            .filter(
              (line) => closedIssues.has(line.jobIssueId) && closedUndrawn.includes(line.itemId),
            )
            .map((line) => challanNumberOf(line.jobIssueId)),
        ),
      ];
      const message =
        `Closing ${challans.join(', ')} would consume ${closedUndrawn.map(itemName).join(', ')}, ` +
        'but nothing received on this receipt is made from it, so there is nothing to carry its ' +
        'value. Leave the challan open, or record what was made from it.';
      throw new ApiError(400, message, { closedIssueIds: message });
    }

    // R11 — a typed figure still wins, but not below what the closure consumes.
    if (!asDraft && belowFloor.length > 0) {
      const itemId = belowFloor[0]!;
      const typedQty = typedByItem.get(itemId)!;
      const lineIndex = lines.findIndex((line) => itemOfLine(line) === itemId);
      const message =
        `${typedQty.toString()} of ${itemName(itemId)} is typed as used, but closing the ` +
        `challan consumes the ${closedFloor.get(itemId)!.toString()} still out on it. Type at ` +
        'least that, or leave the challan open.';
      throw new ApiError(400, message, {
        [lineIndex >= 0 ? `lines.${lineIndex}` : 'lines']: message,
      });
    }

    if (!asDraft && undrawn.length > 0) {
      throw new ApiError(
        400,
        `Nothing received on this receipt is made from ${undrawn.map(itemName).join(', ')}, so ` +
          'there is nothing to carry what it used. Clear the used quantity, or record what was ' +
          'made from it.',
        { lines: 'A used quantity needs something received that is made from it.' },
      );
    }

    // Typed lines stand as sent; every other item's use is the calculated figure.
    const calculatedLines: JobReceiptLineInput[] = asDraft
      ? []
      : inputItemIds
          .filter((itemId) => !typedByItem.has(itemId) && (used.get(itemId) ?? ZERO).greaterThan(0))
          .map((itemId) => ({ itemId, issuedQty: Number(used.get(itemId)), receivedQty: 0 }));

    const usedTotal = [...used.values()].reduce((sum, qty) => sum.plus(qty), ZERO);
    if (!asDraft && usedTotal.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('Say how much of the issued material this receipt accounts for.');
    }

    /**
     * 🔴 A typed figure for an item a closure touches is re-expressed as one bulk
     * line, so it goes through R12's closed-first walk. A draft being posted sends
     * its typed quantities back on the challan LINES it parked them on, and those
     * named lines are consumed exactly as named — if the outstanding moved since
     * the draft was saved, they would no longer empty the closed challan.
     */
    const closingItems = new Set(closedFloor.keys());
    const typedForAllocation: JobReceiptLineInput[] = asDraft
      ? typedLines
      : [
          ...typedLines.filter((line) => !closingItems.has(itemOfLine(line) ?? '')),
          ...[...closingItems]
            .filter((itemId) => typedByItem.has(itemId))
            .map((itemId) => ({
              itemId,
              issuedQty: Number(typedByItem.get(itemId)),
              receivedQty: 0,
            })),
        ];

    const allocations = allocateConsumption(
      issueLines,
      [...typedForAllocation, ...calculatedLines],
      asDraft,
      closedIssues,
    );

    /**
     * R10 — every line of a closed challan is consumed to zero. R11 and R12 make
     * this true by construction; it stays as the net, because a closure that
     * leaves stock behind is a receipt whose cost is silently short.
     */
    if (!asDraft) {
      const allocatedByLine = new Map<string, Prisma.Decimal>();
      for (const row of allocations) {
        allocatedByLine.set(
          row.jobIssueLineId,
          (allocatedByLine.get(row.jobIssueLineId) ?? ZERO).plus(row.qty),
        );
      }
      const leftOpen = issueLines.find(
        (line) =>
          closedIssues.has(line.jobIssueId) &&
          line.outstanding.minus(allocatedByLine.get(line.id) ?? ZERO).greaterThan(0),
      );
      if (leftOpen) {
        const message =
          `Closing ${challanNumberOf(leftOpen.jobIssueId)} consumes everything still out on it, ` +
          `but this receipt leaves ${leftOpen.outstanding
            .minus(allocatedByLine.get(leftOpen.id) ?? ZERO)
            .toString()} of ${itemName(leftOpen.itemId)} there.`;
        throw new ApiError(400, message, { closedIssueIds: message });
      }
    }

    // A draft keeps every ticked challan even with nothing typed against it yet —
    // `postJobReceiptDraft` finds its challans from these lines (§6.5). A posted
    // receipt keeps one row per closed challan that consumed nothing, so the
    // closure is still recorded (R10).
    const covered = new Set(allocations.map((row) => row.jobIssueLineId));
    const closedCovered = new Set(allocations.map((row) => row.jobIssueId));
    for (const line of issueLines) {
      if (covered.has(line.id)) continue;
      if (!asDraft && (!closedIssues.has(line.jobIssueId) || closedCovered.has(line.jobIssueId))) {
        continue;
      }
      covered.add(line.id);
      closedCovered.add(line.jobIssueId);
      allocations.push({
        jobIssueId: line.jobIssueId,
        jobIssueLineId: line.id,
        batchId: line.batchId,
        batchUnitId: line.batchUnitId,
        itemId: line.itemId,
        qty: ZERO,
      });
    }

    /**
     * 🔴 CHECKED BEFORE A SINGLE ROW IS POSTED, and after the units above are
     * settled — the unit check compares against the item's stocking unit, so it
     * has to run once that is known. A batch this receipt may not add to has to
     * fail while nothing has moved; discovering it halfway through leaves the
     * ledger holding half a receipt.
     */
    // Not on a draft — it is a COMPLETENESS check ("every metre came back into
    // some batch"), and a draft is incomplete by definition. It runs in full at
    // post, before a single row is written, exactly as it always has.
    if (!asDraft) assertAllocationsBalance(outputRows);

    const ownership = step.jobOrder.ownership as Ownership;
    const existingBatches = await loadExistingOutputBatches(
      tx,
      organizationId,
      outputRows,
      ownership,
      step.jobOrder.ownerPartyId,
    );

    const primaryOutput = outputRows.find((row) => row.isPrimary)!;

    // The header's issued total is the principal input's, in its own unit — a sum
    // across a multi-item challan would be 100 PCS + 5 CONE, which is nothing.
    const principalItemId = planStep.inputs[0]?.itemId ?? inputItemIds[0] ?? null;
    const principalConsumedQty = allocations
      .filter((allocation) => allocation.itemId === principalItemId)
      .reduce((sum, allocation) => sum.plus(allocation.qty), ZERO);

    // The rate this receipt charges each row at: typed on the receipt, else the
    // job order's (R6). Rework is charged too — the pieces are accepted now.
    const rateByItem = new Map(
      outputRows.map((row) => [
        row.itemId,
        row.rate ?? plannedOutputByItem.get(row.itemId)?.rate ?? null,
      ]),
    );

    const defs = await loadActiveDefinitions(tx, organizationId, 'job_receipt');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      // A draft's custom fields are re-validated on the way to being posted, so
      // `update` here — it is what keeps a required field from blocking the save
      // of a form somebody has not finished filling in.
      mode: asDraft ? 'update' : 'create',
    }) as Prisma.InputJsonValue;

    // A draft KEEPS its number across edits — re-allocating would walk the
    // series forward every time somebody opens and saves a parked receipt.
    const receiptNumber =
      existing?.receiptNumber ?? (await allocateNumber(tx, organizationId, 'job_receipt'));
    const receiptDate = header.receiptDate ?? new Date();
    // Drafts too — see the same call in `jobIssues.service`.
    await assertOnOrAfterMigration(tx, {
      organizationId,
      date: receiptDate,
      field: 'receiptDate',
      label: 'receipt',
    });

    const headerData = {
      jobOrderId: step.jobOrderId,
      jobOrderStepId: step.id,
      receiptDate,
      processorType: issues[0]?.processorType ?? 'vendor',
      processorId: issues[0]?.processorId ?? null,
      processorNameSnapshot: issues[0]?.processorNameSnapshot ?? null,
      locationId: header.locationId,
      status: asDraft ? 'draft' : 'posted',
      /**
       * 🔴 THE SIX TOTALS ARE THE PRIMARY OUTPUT'S, IN ITS OWN UNIT — not a sum
       * across items. Three items in three units cannot be added, so rather than
       * store a meaningless figure the header describes one row and
       * `job_receipt_outputs` holds the rest.
       *
       * The `outputItemId` / `outputUomId` columns that used to say WHICH row
       * these belong to went on 2026-08-12; it is the primary output, and that is
       * derivable from the child list. `chainNotReady` still sums
       * `totalReceivedQty`, which is why these six stay.
       *
       * 🔴 A DRAFT FILLS THESE IN TOO, so the list page can show what it is for.
       * They are therefore populated while the ledger behind them is empty, which
       * is precisely why every sum over receipts filters on `POSTED_DOC_STATUS` —
       * `chainNotReady` above all, since it reads `totalReceivedQty` alone and
       * would otherwise let a parked receipt unlock the next step.
       */
      totalIssuedQty: principalConsumedQty,
      totalReceivedQty: primaryOutput.receivedQty,
      totalAcceptedQty: primaryOutput.acceptedQty,
      totalReworkQty: primaryOutput.reworkQty,
      totalScrapQty: primaryOutput.scrapQty,
      totalReturnedQty: primaryOutput.returnedQty,
      remarks: header.remarks?.trim() || null,
      customFields,
      updatedBy: userId ?? null,
    };

    const receipt = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      existing
        ? tx.jobReceipt.update({ where: { id: existing.id }, data: headerData })
        : tx.jobReceipt.create({
            data: { ...headerData, organizationId, receiptNumber, createdBy: userId ?? null },
          }),
    );

    /**
     * 🔴 HARD DELETE, and legal for exactly the same reason as on the issue side:
     * a draft's children never counted. No ledger row references them, no report
     * sums them, and nobody outside this document has seen them — so there is no
     * history for a soft delete to preserve, and stamping `is_deleted` instead
     * would leave a dead row per line per save on a document meant to be edited
     * repeatedly.
     *
     * `existing` is proved to be a draft above, so this is unreachable once a
     * receipt is posted. Batch rows are NOT touched here because a draft never
     * created any — that is the whole point of the batch work being skipped.
     */
    if (existing) {
      await tx.jobReceiptOutputBatch.deleteMany({
        where: { organizationId, jobReceiptId: existing.id },
      });
      await tx.jobReceiptOutput.deleteMany({
        where: { organizationId, jobReceiptId: existing.id },
      });
      await tx.jobReceiptLine.deleteMany({
        where: { organizationId, jobReceiptId: existing.id },
      });
    }

    /**
     * STEP 1 — consume the input where it physically is: the processor's
     * location. The value that leaves here is what the output batch inherits, which
     * is how cost follows material through the chain without anyone storing it.
     */
    /**
     * 🔴 ONE balance query for every allocation, then the running balance is kept
     * IN MEMORY as each consume is posted (2026-09-01). This was a `getBalance`
     * per allocation: a round trip per row, on the one connection this
     * transaction holds.
     *
     * The decrement below is NOT bookkeeping, it is the semantics. Two allocations
     * can name the same batch — the same batch issued on two challans of one step
     * — and the second one's unit value has to see what the first one took out.
     * Pricing both against a single up-front read is the tempting version of this
     * change and it is wrong: it values material the first allocation already
     * consumed, and prices a batch as though it were full when the first
     * allocation drained it to nothing.
     */
    const consumedBatchIds = [...new Set(allocations.map((allocation) => allocation.batchId))];
    // Both reads feed `postMovement` alone, so a draft — which never posts —
    // skips them and the loop below with them.
    const balances = asDraft
      ? new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>()
      : await getBalancesByBatch(tx, {
          organizationId,
          locationId: processorLocationId ?? undefined,
          batchIds: consumedBatchIds,
        });
    // The same hoist for the batch rows each post copies its item and owner off.
    const consumedBatches = asDraft
      ? new Map()
      : await resolveBatchesForPosting(tx, organizationId, consumedBatchIds);

    /** What actually left the ledger, per input item — the material R5 splits. */
    const consumedValueByItem = new Map<string, Prisma.Decimal>();
    const parentBatchIds = new Set<string>();
    for (const allocation of asDraft ? [] : allocations) {
      if (allocation.qty.lessThanOrEqualTo(0)) continue;
      const balance = balances.get(allocation.batchId) ?? { qty: ZERO, value: ZERO };
      const unitValue = balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : ZERO;
      const lineValue = unitValue.times(allocation.qty).toDecimalPlaces(4);
      parentBatchIds.add(allocation.batchId);

      const posted = await postMovement(
        tx,
        {
          organizationId,
          batchId: allocation.batchId,
          // Back out of the package it went out in — see `ConsumeAllocation`.
          batchUnitId: allocation.batchUnitId,
          locationId: processorLocationId!,
          movementType: 'consume',
          qtyOut: allocation.qty,
          valueOut: lineValue,
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: receipt.id,
          postedAt: receiptDate,
          userId,
        },
        consumedBatches,
      );

      /* Taken from the row actually WRITTEN, never from `lineValue`.
         `postMovement` zeroes value on customer-owned stock (§5.3), so re-deriving
         what it stored is how this copy and the ledger drift apart. */
      balances.set(allocation.batchId, {
        qty: balance.qty.minus(posted.qtyOut),
        value: balance.value.minus(posted.valueOut),
      });
      consumedValueByItem.set(
        allocation.itemId,
        (consumedValueByItem.get(allocation.itemId) ?? ZERO).plus(posted.valueOut),
      );
    }
    const consumedValue = [...consumedValueByItem.values()].reduce(
      (sum, value) => sum.plus(value),
      ZERO,
    );

    /**
     * 🔴 R5–R7: each input's value follows the rows that drew on it, by need, and
     * each row adds its own charge. Recomputed from what was POSTED rather than
     * from the typed-or-calculated quantities, so the ledger and the breakdown
     * cannot disagree.
     */
    const materialByItem = materialByOutput(needs, consumedValueByItem);
    const valuesByItem = new Map(
      outputRows.map((row) => {
        const material = materialByItem.get(row.itemId) ?? ZERO;
        return [
          row.itemId,
          {
            material,
            ...outputValues(
              material,
              rateByItem.get(row.itemId) ?? null,
              row.acceptedQty,
              row.reworkQty,
            ),
          },
        ];
      }),
    );
    const splitMaterial = [...valuesByItem.values()].reduce(
      (sum, row) => sum.plus(row.material),
      ZERO,
    );
    // Consumed value no returned row draws on would vanish from the books. The
    // undrawn refusal above should make this unreachable; it stays as the net.
    if (!asDraft && !splitMaterial.equals(consumedValue)) {
      throw ApiError.conflict(
        `This receipt consumed material worth ${consumedValue.toString()} but only ` +
          `${splitMaterial.toString()} of it lands in what came back. Nothing has been posted.`,
      );
    }
    const processChargeTotal = [...valuesByItem.values()].reduce(
      (sum, row) => sum.plus(row.charge),
      ZERO,
    );

    /**
     * STEPS 2–4 — a batch per returned ITEM, and the value split across them.
     *
     * 🔴 Scrap and returned quantities take NO share. The whole cost lands on the
     * pieces that survived, which is the point of §5.5: 4,850 good metres that
     * cost what 5,000 cost. Within one item, accepted and rework split the
     * material by quantity — legitimate here, and ONLY here, because both sides
     * are the same item in the same unit — and the charge lands on accepted (R7).
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
        /* Both branches already hold the batch row — `existingBatches` read it,
           or `createBatch` just returned it — so the post below has no reason to
           read it again. */
        let postableBatch: ResolvedBatches;

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
          postableBatch = asResolvedBatch(existing);

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
            // Stated at the gate or never — see `OutputBatchPlan`.
            ...plan.attributes,
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            sourceDocId: receipt.id,
            userId,
          });
          batchId = batch.id;
          isNewBatch = true;
          postableBatch = asResolvedBatch(batch);
        }

        /**
         * 🔴 THE PACKAGES THE PROCESSOR HANDED BACK, created before anything is
         * posted so each `produce` can name the one it belongs to.
         *
         * On a top-up this CONTINUES the batch's own `seq` rather than restarting
         * — the first delivery's T-1..T-3 and this one's T-4..T-6 are six rolls of
         * one batch, and two rolls both called "1" could not be told apart on the
         * goods.
         */
        // Guarded beside the write as well as in the schema: a batch born on this
        // receipt has no packages that predate it, and the schema runs on the
        // HTTP route alone.
        if (plan.existingUnits.length && isNewBatch) {
          throw ApiError.badRequest('A batch being created has no existing units to add to.', {
            outputs: 'Pick an existing batch before adding to one of its units.',
          });
        }

        /**
         * 🔴 Two kinds of package row, two paths. A `label` row is a roll handed
         * back for the first time and is CREATED; a `batchUnitId` row is the same
         * roll returning again and is only RESOLVED, because `createBatchUnits`
         * refuses a label the batch already carries — a label is a physical tag.
         * Both then produce the same movement.
         */
        const createdUnits = [
          ...(plan.units.length
            ? await createBatchUnits(tx, {
                organizationId,
                batchId,
                units: plan.units,
                uomId: output.uomId,
                sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
                sourceDocId: receipt.id,
                userId,
              })
            : []),
          ...(plan.existingUnits.length
            ? await resolveExistingBatchUnits(tx, {
                organizationId,
                batchId,
                units: plan.existingUnits,
              })
            : []),
        ];

        /**
         * The side's value is already this batch's share; it is now split again
         * across the packages BY QUANTITY — legitimate here for the same reason it
         * was one level up, because every package is the same item in the same
         * unit. Through `splitByQty` so the last one takes the remainder and not a
         * paisa of the batch's share goes missing.
         *
         * The untagged remainder is the final part of that split, which is what
         * keeps the batch's total value identical to what it would have been with
         * no packages at all. A package carries no value of its own (§2.2) — it
         * inherits its batch's weighted average, and this is how.
         */
        const tagged = createdUnits.reduce((sum, unit) => sum.plus(unit.qty), ZERO);
        const loose = plan.qty.minus(tagged);
        const parts = [
          ...createdUnits.map((unit) => unit.qty),
          ...(loose.greaterThan(0) ? [loose] : []),
        ];
        const unitShares = splitByQty(share, parts);

        const remarks =
          kind === 'rework' ? 'Rework — to be re-issued against the same step.' : undefined;

        for (const [unitIndex, unit] of createdUnits.entries()) {
          await postMovement(
            tx,
            {
              organizationId,
              batchId,
              batchUnitId: unit.id,
              locationId: header.locationId,
              movementType: 'produce',
              qtyIn: unit.qty,
              valueIn: unitShares[unitIndex] ?? ZERO,
              sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
              sourceDocId: receipt.id,
              remarks,
              postedAt: receiptDate,
              userId,
            },
            postableBatch,
          );
        }

        // A batch broken up entirely leaves nothing behind, and a zero-quantity
        // movement is one `postMovement` refuses by design.
        if (loose.greaterThan(0)) {
          await postMovement(
            tx,
            {
              organizationId,
              batchId,
              locationId: header.locationId,
              movementType: 'produce',
              qtyIn: loose,
              valueIn: unitShares[unitShares.length - 1] ?? ZERO,
              sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
              sourceDocId: receipt.id,
              remarks,
              postedAt: receiptDate,
              userId,
            },
            postableBatch,
          );
        }

        posted.push({ kind, batchId, qty: plan.qty, isNewBatch });
      }

      return posted;
    };

    /**
     * 🔴 A DRAFT NEVER REACHES `postSide`, SO IT CREATES NO BATCH AND NO PACKAGE.
     *
     * This is the receipt side's version of "a draft moves no stock", and it is
     * the stronger half: a receipt is where batches are BORN. Running this for a
     * parked form would mint a batch, a package grid and a `produce` row for
     * goods nobody has accepted yet, and deleting the draft afterwards would
     * leave all three behind with nothing to explain them.
     */
    for (const output of asDraft ? [] : outputRows) {
      const { acceptedValue, reworkValue } = valuesByItem.get(output.itemId)!;

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
      /**
       * 🔴 WHAT A DRAFT KEEPS OF THE BATCH PLAN: the allocations that name a
       * batch which ALREADY EXISTS, and only those.
       *
       * A top-up points at a real `batches` row, so it survives the round trip
       * untouched. A NEW batch is nothing but a label the user typed — there is
       * no row to point `batch_id` at, and creating one would be the very thing
       * this whole path avoids — so it is dropped, and reopening the draft asks
       * for the reference again. `postJobReceiptDraft` refuses rather than
       * guessing.
       */
      const posted =
        postedByItem.get(output.itemId) ??
        (asDraft
          ? [
              ...output.batches
                .filter((plan) => plan.batchId)
                .map((plan) => ({
                  kind: 'accepted' as const,
                  batchId: plan.batchId!,
                  qty: plan.qty,
                  isNewBatch: false,
                })),
              ...output.reworkBatches
                .filter((plan) => plan.batchId)
                .map((plan) => ({
                  kind: 'rework' as const,
                  batchId: plan.batchId!,
                  qty: plan.qty,
                  isNewBatch: false,
                })),
            ]
          : []);
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
          // No longer drives cost (R5); kept null until Migration 2 drops it.
          valueShare: null,
          // 🔴 The breakdown as posted, never re-derived — a later change to the
          // job order's rate must not rewrite what this receipt cost.
          rate: rateByItem.get(output.itemId) ?? null,
          materialValue: valuesByItem.get(output.itemId)?.material ?? ZERO,
          processCharge: valuesByItem.get(output.itemId)?.charge ?? ZERO,
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
          // A draft keeps the tick too, so a parked receipt remembers it.
          closesChallan: closedIssues.has(allocation.jobIssueId),
          customFields: lineCustomFields,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    }

    if (!asDraft) {
      await tx.jobReceipt.update({
        where: { id: receipt.id },
        data: { outputBatchId, reworkBatchId, consumedValue, processChargeTotal },
      });
    }

    /**
     * 🔴 A RECEIPT NO LONGER TOUCHES THE CHALLAN'S STATUS (2026-09-07).
     *
     * This used to read every line of every ticked challan, sum what was still
     * out, and stamp `closed` or `partially_received` on each one. All of it is
     * gone: a challan is `issued` until somebody cancels it.
     *
     * The status was the only thing removed. Ticking a challan still decides
     * WHICH BATCH at the processor this receipt draws down and by how much —
     * `allocateConsumption` above — so the stock still leaves the processor and
     * its cost still flows into the output. What went was a derived label that
     * duplicated, less accurately, what the ledger already says: what is still at
     * a jobworker is the balance at their location, per batch, and no status
     * column can disagree with that because none is consulted.
     *
     * `closedQtyByIssueLine` stays and is still the cap on over-consumption —
     * that is arithmetic about material, not about a document's state.
     */
    if (!asDraft) await recomputeStep(tx, organizationId, step.id);

    return tx.jobReceipt.findFirstOrThrow({
      where: { id: receipt.id, organizationId },
      include: RECEIPT_INCLUDE,
    });
  });
}

/**
 * Post a draft receipt as it stands.
 *
 * 🔴 IT GOES BACK THROUGH `createNewJobReceipt` in `post` mode, never a status
 * flip. The draft was saved leniently — its dispositions may not add up, it may
 * account for more than the challans have outstanding, and the goods it consumes
 * may have moved on since. Every one of those checks lives in that function, and
 * a shortcut past them is a receipt that posts a ledger nobody can reconcile.
 *
 * 🔴 AND IT REFUSES A DRAFT THAT NEVER NAMED ITS OUTPUT BATCHES. A draft cannot
 * store a batch it is CREATING (see the note on `createNewJobReceipt`), so most
 * drafts come back here with an accepted quantity and nothing to put it in.
 * `assertAllocationsBalance` would catch it anyway — but with "the accepted
 * batches add up to 0", which reads as a bug rather than as the one field the
 * form still needs. Saying so plainly here is the difference between a user who
 * knows to reopen the draft and one who thinks the software is broken.
 */
export async function postJobReceiptDraft(organizationId: string, id: string, userId?: string) {
  const draft = await runAsTenant(organizationId, (tx) =>
    tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: RECEIPT_INCLUDE,
    }),
  );
  if (!draft) throw ApiError.notFound('Receipt not found');
  if (draft.status !== 'draft') throw ApiError.conflict('This receipt has already been posted.');

  const issueIds = [
    ...new Set(draft.lines.flatMap((line) => (line.jobIssueId ? [line.jobIssueId] : []))),
  ];

  /**
   * 🔴 A draft with no challan on it cannot be posted.
   *
   * `createNewJobReceipt` refuses it too — nothing was issued, so there is nothing
   * for the receipt to account for — but only after resolving the step, the
   * outputs and the batches, and the message it lands on describes an arithmetic
   * failure rather than the missing field. Said here, it names the one thing to
   * go and do.
   *
   * Restored 2026-09-07 with the check inside that function; it was removed on
   * 2026-09-04 (`fd2ddfe`) and JR-00019 / JR-00020 went through the gap, minting
   * 90 shirts against no material at all.
   */
  if (issueIds.length === 0) {
    throw ApiError.badRequest(
      'This draft does not say which challan it accounts for. Open it and pick the challan first.',
    );
  }

  /**
   * 🔴 A DRAFT THAT NEVER NAMED ITS OUTPUT BATCHES CANNOT BE POSTED FROM HERE.
   *
   * A draft cannot store a batch it is CREATING — the batch does not exist until
   * something posts it — so a receipt parked for a batch-tracked output comes
   * back with an accepted quantity and nothing to put it in. Reopening the draft
   * and pressing Receive is the way through: the form asks for the reference and
   * posts in one go.
   *
   * Without this, `createBatch` refuses far downstream with "This item is
   * batch-tracked, so the batch needs a reference" — true, but thrown from inside
   * the posting machinery with no hint that the fix is to reopen the draft. The
   * Post button on the detail drawer then looks broken for every batch-tracked
   * item while working fine for untracked ones.
   *
   * 🔴 THE TEST IS THE ITEM'S OWN `inventoryTracking`, not a guess at the item's
   * name. A guard removed on 2026-09-04 decided this by matching the name against
   * "service", "dyeing" and "stitching", which refuses a real item called Dyeing
   * Cloth and waves through a batch-tracked one called anything else. Whether a
   * batch is needed is the item's answer, and `createBatch` enforces exactly the
   * same rule at the other end.
   *
   * An output that names an EXISTING batch is fine — that id survives a draft,
   * because the batch is already there to point at.
   */
  const needsReference = draft.outputs.filter((output) => {
    if (output.item?.inventoryTracking !== 'batch') return false;
    const has = (kind: string) => output.batches.some((row) => row.kind === kind);
    return (
      (output.acceptedQty.greaterThan(0) && !has('accepted')) ||
      (output.reworkQty.greaterThan(0) && !has('rework'))
    );
  });
  if (needsReference.length > 0) {
    const names = needsReference.map((output) => output.item?.name ?? 'the goods').join(', ');
    throw ApiError.badRequest(
      `This draft does not say which batch ${names} came back into. Open the draft, enter the ` +
        'batch reference, and receive it from there.',
      { outputs: 'Enter the batch reference on the draft.' },
    );
  }

  return createNewJobReceipt(
    organizationId,
    {
      jobOrderStepId: draft.jobOrderStepId,
      receiptDate: draft.receiptDate,
      issueIds,
      closedIssueIds: [
        ...new Set(
          draft.lines.flatMap((line) =>
            line.closesChallan && line.jobIssueId ? [line.jobIssueId] : [],
          ),
        ),
      ],
      locationId: draft.locationId,
      remarks: draft.remarks,
      customFields: draft.customFields as Record<string, unknown>,
      lines: draft.lines.map((line) => ({
        jobIssueId: line.jobIssueId,
        jobIssueLineId: line.jobIssueLineId,
        issuedQty: Number(line.issuedQty),
        receivedQty: Number(line.receivedQty),
        acceptedQty: Number(line.acceptedQty),
        reworkQty: Number(line.reworkQty),
        scrapQty: Number(line.scrapQty),
        returnedQty: Number(line.returnedQty),
      })),
      outputs: draft.outputs.map((output) => ({
        itemId: output.itemId,
        uomId: output.uomId,
        receivedQty: Number(output.receivedQty),
        acceptedQty: Number(output.acceptedQty),
        reworkQty: Number(output.reworkQty),
        scrapQty: Number(output.scrapQty),
        returnedQty: Number(output.returnedQty),
        isPrimary: output.isPrimary,
        rate: output.rate === null ? null : Number(output.rate),
        reasonId: output.reasonId,
        responsibility: output.responsibility,
        remarks: output.remarks,
        batches: output.batches
          .filter((row) => row.kind === 'accepted')
          .map((row) => ({ batchId: row.batch.id, qty: Number(row.qty) })),
        reworkBatches: output.batches
          .filter((row) => row.kind === 'rework')
          .map((row) => ({ batchId: row.batch.id, qty: Number(row.qty) })),
      })),
    } as CreateJobReceiptInput,
    userId,
    'post',
    draft.id,
  );
}

/**
 * Delete a draft receipt. Children go for real, the header is soft-deleted.
 *
 * 🔴 Only a draft, and only because a draft posted nothing: no ledger row, no
 * batch, no package, no challan reopened. A POSTED receipt is cancelled
 * (`cancelJobReceipt`), which reverses what it wrote — deleting one would strand
 * the batches it created with no document explaining where they came from.
 *
 * The header stays as a soft-deleted row so its receipt NUMBER remains taken.
 */
export async function deleteJobReceiptDraft(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const draft = await tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, status: true },
    });
    if (!draft) throw ApiError.notFound('Receipt not found');
    if (draft.status !== 'draft') {
      throw ApiError.conflict(
        'Only a draft can be deleted. This receipt has been posted — cancel it instead, ' +
          'which posts the reversing stock entries.',
      );
    }

    await tx.jobReceiptOutputBatch.deleteMany({
      where: { organizationId, jobReceiptId: draft.id },
    });
    await tx.jobReceiptOutput.deleteMany({ where: { organizationId, jobReceiptId: draft.id } });
    await tx.jobReceiptLine.deleteMany({ where: { organizationId, jobReceiptId: draft.id } });
    await tx.jobReceipt.update({
      where: { id: draft.id },
      data: { isDeleted: true, updatedBy: userId ?? null },
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
    const target = await tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { jobOrderStepId: true },
    });
    if (!target) throw ApiError.notFound('Receipt not found');
    await lockStep(tx, organizationId, target.jobOrderStepId);

    const receipt = await tx.jobReceipt.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!receipt) throw ApiError.notFound('Receipt not found');
    if (receipt.status === 'cancelled')
      throw ApiError.conflict('This receipt is already cancelled.');

    // R9: a finished step has had what was left at the processor written off, so
    // reversing a consume would put material back somewhere the step already closed.
    const receiptStep = await tx.jobOrderStep.findFirst({
      where: { id: receipt.jobOrderStepId, organizationId },
      select: { status: true },
    });
    if (receiptStep?.status === 'completed' || receiptStep?.status === 'short_closed') {
      throw ApiError.conflict(
        'This receipt’s step has been completed or closed short, so the receipt can no longer be cancelled.',
      );
    }

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
        /**
         * 🔴 THE COLUMN THIS PATH MOST EASILY FORGETS, AND THE WORST ONE TO MISS.
         *
         * Every reversal below copies its identity off the row it undoes. Leave
         * this out and the reversals post as UNTAGGED: the batch's balance comes
         * back perfectly correct, so nothing on any screen looks wrong, while
         * every package this receipt created keeps its quantity forever and an
         * untagged negative appears beside it. There is no error, no warning, and
         * no way to notice until someone asks where a roll went.
         *
         * `jobReceipts.batchUnits.test.ts` fails the moment this is dropped.
         */
        batchUnitId: true,
        locationId: true,
        qtyIn: true,
        qtyOut: true,
        valueIn: true,
        valueOut: true,
      },
    });

    // Every row this receipt posted is reversed, and a receipt touches the same
    // handful of batches over and over — so the batch rows are read once here
    // rather than once per reversal.
    const reversedBatches = await resolveBatchesForPosting(
      tx,
      organizationId,
      posted.map((row) => row.batchId),
    );

    const now = new Date();
    for (const row of posted) {
      await postMovement(
        tx,
        {
          organizationId,
          batchId: row.batchId,
          batchUnitId: row.batchUnitId,
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
        },
        reversedBatches,
      );
    }

    /**
     * 🔴 THE PACKAGES THIS RECEIPT CREATED GO WITH IT — and unlike the batches,
     * they have to.
     *
     * A cancelled receipt leaves its BATCHES behind at zero, deliberately: a batch
     * reference is not unique (two suppliers both number from 1, and Zoho allows
     * duplicates), so an empty one costs nothing and re-entering the receipt mints
     * a fresh batch anyway.
     *
     * A package label IS unique inside its batch. So on the TOP-UP path — receipt
     * 2 adds T-4..T-6 to a batch receipt 1 created — cancelling and re-entering
     * would hit "T-4 already exists in this batch" and the user would be stuck
     * with no way to say what they meant. Anything another document has moved
     * keeps its row: those ledger rows name it forever and have to stay
     * interpretable.
     */
    const created = await tx.batchUnit.findMany({
      where: {
        organizationId,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: id,
        isDeleted: false,
      },
      select: { id: true },
    });
    for (const unit of created) {
      const movedElsewhere = await tx.stockLedgerEntry.count({
        where: {
          organizationId,
          batchUnitId: unit.id,
          NOT: { sourceDocType: SOURCE_DOC_TYPES.jobReceipt, sourceDocId: id },
        },
      });
      if (movedElsewhere === 0) {
        await tx.batchUnit.update({
          where: { id: unit.id },
          data: { isDeleted: true, updatedBy: userId ?? null },
        });
      }
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

    /* Nothing else to reopen. What a cancellation gives back is the OUTSTANDING
       quantity, derived from this receipt's own lines — which `closedQtyByIssueLine`
       stops counting the moment the status here becomes `cancelled`. A challan this
       receipt CLOSED reopens the same way: R14 reads posted receipts only
       (challan-closure plan §0). */
    await recomputeStep(tx, organizationId, receipt.jobOrderStepId);
    return updated;
  });
}
