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
  createLot,
  createPackages,
  getBalance,
  postMovement,
  type Ownership,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import {
  assertItemsBelongToOrg,
  assertLocationsBelongToOrg,
  assertUomsBelongToOrg,
} from '../jobwork.refs.ts';
import { SOURCE_DOC_TYPES, runAsDocument, type ReceiptMode } from '../jobwork.types.ts';
import { recomputeStep } from '../job-orders/jobOrders.status.ts';
import type {
  CreateJobReceiptInput,
  JobReceiptLineInput,
  JobReceiptOutputInput,
} from './jobReceipts.schemas.ts';

/**
 * Receipts — goods back from a processor, and the only place an output lot is
 * born.
 *
 * WHAT ONE SAVE DOES, IN ORDER
 *
 *   1. consumes the input at the PROCESSOR's location  (movementType `consume`)
 *   2. creates the output lot, with `parentLotIds` = the lots consumed
 *   3. produces the output at OUR location             (movementType `produce`)
 *   4. creates a SEPARATE rework lot when anything needs redoing
 *   5. recomputes the step and the job order
 *
 * 🔴 SCRAP GETS NO OUTPUT ROW AND THAT IS THE COSTING MODEL (§5.5). The input it
 * consumed is gone, and its share of the cost stays inside the lot that
 * survived — so the good pieces carry the true cost of the failures. Creating a
 * zero-value scrap lot instead would make the accepted pieces look cheaper than
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
  outputItem: { select: { id: true, name: true, sku: true } },
  outputUom: { select: { id: true, unitName: true, symbol: true } },
  location: { select: { id: true, name: true } },
  outputLot: { select: { id: true, lotNumber: true } },
  reworkLot: { select: { id: true, lotNumber: true } },
  /** The CONSUMPTION record — one row per challan line this receipt closes. */
  lines: {
    where: { isDeleted: false },
    include: {
      reason: { select: { id: true, name: true } },
      parentPackage: { select: { id: true, packageNumber: true, label: true, qty: true } },
      jobIssue: { select: { id: true, challanNumber: true } },
      jobIssueLine: { select: { id: true, item: { select: { id: true, name: true } } } },
    },
  },
  /** 🔴 What came back, one row per item (§5.7). The header's `outputItem` and
   * six totals describe the primary alone. */
  outputs: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      item: { select: { id: true, name: true, sku: true } },
      uom: { select: { id: true, unitName: true, symbol: true } },
      reason: { select: { id: true, name: true } },
      outputLot: { select: { id: true, lotNumber: true } },
      reworkLot: { select: { id: true, lotNumber: true } },
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
 * What the Receive dialog needs before anyone types anything: the mode (decided
 * for them), the open challans, and — in unit-wise mode — one pre-built row per
 * taka that went out and has not come back.
 *
 * The rows are GENERATED, not entered (§6.2). Asking someone to re-key forty
 * taka numbers they already keyed on the challan is how the two lists stop
 * matching.
 */
export async function getReceivePrefill(organizationId: string, jobOrderStepId: string) {
  return runAsTenant(organizationId, async (tx) => {
    const step = await tx.jobOrderStep.findFirst({
      where: { id: jobOrderStepId, organizationId, isDeleted: false },
      include: {
        process: { select: { id: true, name: true, preservesPackaging: true } },
        jobOrder: { select: { id: true, jobOrderNumber: true, ownership: true } },
        receiveItem: { select: { id: true, name: true, sku: true } },
        receiveUom: { select: { id: true, unitName: true, symbol: true } },
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

    /**
     * ⚠️ LOT LEVEL ONLY, for now. Goods come back as a quantity against the lot;
     * there is no taka-by-taka grid.
     *
     * `Process.preservesPackaging` still decides this in the domain (§6.1) and
     * the unit-wise path below still works — it is simply not reached, because
     * per-taka receiving is more than the shop floor needs today. Flip this back
     * to `step.process.preservesPackaging ? 'unit_wise' : 'bulk'` to restore it;
     * nothing else has to change.
     */
    const mode = 'bulk' as ReceiptMode;

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
            lot: { select: { id: true, lotNumber: true } },
            lotPackage: { select: { id: true, packageNumber: true, label: true, qty: true } },
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
          itemId: line.itemId ?? issue.itemId,
          itemName: line.item?.name ?? null,
          uomSymbol: line.uom?.symbol ?? line.uom?.unitName ?? null,
          lotId: line.lotId,
          lotNumber: line.lot.lotNumber,
          lotPackageId: line.lotPackageId,
          packageLabel: line.lotPackage?.label ?? null,
          packageNumber: line.lotPackage?.packageNumber ?? null,
          issuedQty: outstanding.toString(),
        });
      }
    }

    return {
      step,
      mode,
      /** 🔴 Why the mode is what it is, in the user's words. The dialog shows this
       * instead of a disabled toggle, because a greyed-out control invites the
       * question "why can't I?" and answers nothing. */
      modeReason: 'Goods are received as a quantity against each item.',
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
    case 'lump_sum':
      return rate;
    case 'per_kg':
      /**
       * Charged against the received quantity, which is only correct when the
       * item is measured in kilograms — and no weight is captured anywhere in the
       * system yet, so there is nothing better to multiply. The alternative is
       * silently charging zero, which would understate every bill. Flagged here
       * rather than hidden: when a weight field lands on `items`, this is the
       * line that changes.
       */
      return rate.times(receivedQty);
    default:
      return ZERO;
  }
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
  fallback: { itemId: string; uomId: string | null },
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
    };
  });
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

interface ConsumeAllocation {
  jobIssueId: string;
  jobIssueLineId: string;
  lotId: string;
  lotPackageId: string | null;
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
 * FIFO rather than proportional because the lots went out in an order and came
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
      lotId: true,
      lotPackageId: true,
      qty: true,
      itemId: true,
      // Null `itemId` only on rows written before Sprint 5, which the header
      // still describes. The fallback goes with Migration B.
      jobIssue: { select: { itemId: true } },
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
          `Challan line for lot ${issueLine.lotId} has ${left.toString()} still out, ` +
            `but ${toConsume.toString()} is being received against it.`,
        );
      }
      outstanding.set(issueLine.id, left.minus(toConsume));
      allocations.push({
        jobIssueId: issueLine.jobIssueId,
        jobIssueLineId: issueLine.id,
        lotId: issueLine.lotId,
        lotPackageId: issueLine.lotPackageId,
        itemId: issueLine.itemId ?? issueLine.jobIssue.itemId,
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
    const itemsOnChallans = new Set(
      issueLines.map((issueLine) => issueLine.itemId ?? issueLine.jobIssue.itemId),
    );
    if (!line.itemId && itemsOnChallans.size > 1) {
      throw new ApiError(
        400,
        'These challans carry several items, so each line has to say which one it accounts for. ' +
          'Otherwise the oldest open line is consumed first, whatever item it is.',
        { lines: 'Name the item on every line when the challans carry more than one.' },
      );
    }
    const eligible = line.itemId
      ? issueLines.filter(
          (issueLine) => (issueLine.itemId ?? issueLine.jobIssue.itemId) === line.itemId,
        )
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
        lotId: issueLine.lotId,
        lotPackageId: issueLine.lotPackageId,
        itemId: issueLine.itemId ?? issueLine.jobIssue.itemId,
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
        process: { select: { preservesPackaging: true, name: true } },
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
     * ⚠️ LOT LEVEL ONLY, for now. Goods come back as a quantity against the lot;
     * there is no taka-by-taka grid.
     *
     * `Process.preservesPackaging` still decides this in the domain (§6.1) and
     * the unit-wise path below still works — it is simply not reached, because
     * per-taka receiving is more than the shop floor needs today. Flip this back
     * to `step.process.preservesPackaging ? 'unit_wise' : 'bulk'` to restore it;
     * nothing else has to change.
     */
    const mode = 'bulk' as ReceiptMode;

    const outputItemId = header.outputItemId ?? step.receiveItemId ?? step.issueItemId;
    if (!outputItemId) {
      throw ApiError.badRequest('This step has no output item, so there is nothing to receive.');
    }
    const outputUomId = header.outputUomId ?? step.receiveUomId ?? step.issueUomId;

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
     * the value split and the lots both hang off it.
     */
    const outputRows = resolveOutputs(sentOutputs, totals, {
      itemId: outputItemId,
      uomId: outputUomId,
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
    const principalItemId = principalInput?.itemId ?? step.issueItemId;
    // The fallback covers a step whose input rows the backfill has not reached:
    // there is only one item on it, so the cross-item sum IS that item's.
    const principalConsumedQty = principalItemId
      ? (consumedByItem.get(principalItemId) ?? ZERO)
      : totals.issued;

    /**
     * 🔴 In unit-wise mode the per-taka dispositions on the lines are what build
     * the primary output's packages, so they cannot disagree with the primary's
     * own totals — one of the two numbers would then be fiction, and nothing
     * downstream could tell which.
     */
    if (mode === 'unit_wise' && sentOutputs?.length && totals.accepted.greaterThan(0)) {
      if (!totals.accepted.equals(primaryOutput.acceptedQty)) {
        throw new ApiError(
          400,
          `The takas account for ${totals.accepted.toString()} accepted, but the main returned ` +
            `item says ${primaryOutput.acceptedQty.toString()}.`,
          { outputs: 'Must match the per-taka quantities on this receipt.' },
        );
      }
    }

    const defs = await loadActiveDefinitions(tx, organizationId, 'job_receipt');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    const receiptNumber = await allocateNumber(tx, organizationId, 'job_receipt');
    const receiptDate = header.receiptDate ?? new Date();
    const ownership = step.jobOrder.ownership as Ownership;

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
          mode,
          /**
           * 🔴 The header describes the PRINCIPAL input and the PRIMARY output,
           * and nothing else. Every other item is on `job_receipt_outputs`.
           *
           * Six totals in one row cannot describe three items in three units —
           * so rather than sum them into a meaningless figure, each of these is
           * one item's, in one unit. They go with Migration B.
           */
          outputItemId: primaryOutput.itemId,
          outputUomId: primaryOutput.uomId,
          locationId: header.locationId,
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
     * location. The value that leaves here is what the output lot inherits, which
     * is how cost follows material through the chain without anyone storing it.
     */
    let consumedValue = ZERO;
    const parentLotIds = new Set<string>();
    for (const allocation of allocations) {
      const balance = await getBalance(tx, {
        organizationId,
        lotId: allocation.lotId,
        locationId: processorLocationId,
      });
      const unitValue = balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : ZERO;
      const lineValue = unitValue.times(allocation.qty).toDecimalPlaces(4);
      consumedValue = consumedValue.plus(lineValue);
      parentLotIds.add(allocation.lotId);

      await postMovement(tx, {
        organizationId,
        lotId: allocation.lotId,
        lotPackageId: allocation.lotPackageId,
        locationId: processorLocationId,
        movementType: 'consume',
        qtyOut: allocation.qty,
        valueOut: lineValue,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: receipt.id,
        postedAt: receiptDate,
        userId,
      });

      if (allocation.lotPackageId) {
        await tx.lotPackage.update({
          where: { id: allocation.lotPackageId },
          data: { state: 'consumed', updatedBy: userId ?? null },
        });
      }
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
     * STEPS 2–4 — a lot per returned ITEM, and the value split across them.
     *
     * 🔴 Scrap and returned quantities take NO share. The whole cost lands on the
     * pieces that survived, which is the point of §5.5: 4,850 good metres that
     * cost what 5,000 cost. Within one item, accepted and rework then split that
     * item's share by quantity — legitimate here, and ONLY here, because both
     * sides are the same item in the same unit.
     *
     * 🔴 Rework goes into a lot of its OWN, always (plan §7). Merging it into the
     * accepted lot would lose the piece count rework has to be measured by, and
     * the re-issue would have no way to send back only the pieces that failed.
     */
    let outputLotId: string | null = null;
    let reworkLotId: string | null = null;
    const lotsByOutput = new Map<
      string,
      { outputLotId: string | null; reworkLotId: string | null }
    >();

    for (const output of outputRows) {
      const rowValue = valueByItem.get(output.itemId) ?? ZERO;
      const surviving = output.acceptedQty.plus(output.reworkQty);
      let rowOutputLotId: string | null = null;
      let rowReworkLotId: string | null = null;

      if (output.acceptedQty.greaterThan(0)) {
        const lot = await createLot(tx, {
          organizationId,
          itemId: output.itemId,
          uomId: output.uomId,
          ownership,
          ownerPartyId: step.jobOrder.ownerPartyId,
          // 🔴 Genealogy, written here or never. It cannot be reconstructed from
          // history that was not recorded (§11.3). EVERY output traces back to
          // EVERY lot consumed — offcuts came from the same fabric the panels did.
          parentLotIds: [...parentLotIds],
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: receipt.id,
          userId,
        });
        rowOutputLotId = lot.id;

        const acceptedValue = surviving.greaterThan(0)
          ? rowValue.times(output.acceptedQty).dividedBy(surviving).toDecimalPlaces(4)
          : rowValue;

        /**
         * 🔴 Unit-wise produces PACKAGE BY PACKAGE, and that is the only reason
         * the mode exists. Each accepted line becomes one package carrying
         * `parentPackageId` — the 1:1 mapping between the taka that went out and
         * the one that came back (§6.2). Nothing can rebuild it afterwards from
         * quantities, so it is recorded now or it is lost.
         *
         * PRIMARY OUTPUT ONLY. A by-product has no taka that went out to map back
         * to: the offcuts from forty rolls are not "roll 17's offcuts", they are
         * a heap. Giving them packages would invent a traceability that does not
         * physically exist.
         *
         * The movements are posted per package too, not once for the lot: a
         * package-level balance is what lets the NEXT step's picker offer
         * individual takas, and a lot-level row would leave every package showing
         * zero available.
         */
        const acceptedLines = lines.filter((line) => (line.acceptedQty ?? 0) > 0);
        if (mode === 'unit_wise' && output.isPrimary && acceptedLines.length > 0) {
          const created = await createPackages(tx, {
            organizationId,
            lotId: lot.id,
            packages: acceptedLines.map((line) => ({
              qty: line.acceptedQty ?? 0,
              parentPackageId: line.parentPackageId ?? null,
            })),
            userId,
          });

          let valueLeft = acceptedValue;
          for (const [index, pkg] of created.entries()) {
            const isLast = index === created.length - 1;
            const share = isLast
              ? valueLeft
              : acceptedValue.times(pkg.qty).dividedBy(output.acceptedQty).toDecimalPlaces(4);
            valueLeft = valueLeft.minus(share);

            await postMovement(tx, {
              organizationId,
              lotId: lot.id,
              lotPackageId: pkg.id,
              locationId: header.locationId,
              movementType: 'produce',
              qtyIn: pkg.qty,
              valueIn: share,
              sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
              sourceDocId: receipt.id,
              postedAt: receiptDate,
              userId,
            });
          }
        } else {
          await postMovement(tx, {
            organizationId,
            lotId: lot.id,
            locationId: header.locationId,
            movementType: 'produce',
            qtyIn: output.acceptedQty,
            valueIn: acceptedValue,
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            sourceDocId: receipt.id,
            postedAt: receiptDate,
            userId,
          });
        }
      }

      if (output.reworkQty.greaterThan(0)) {
        const lot = await createLot(tx, {
          organizationId,
          itemId: output.itemId,
          uomId: output.uomId,
          ownership,
          ownerPartyId: step.jobOrder.ownerPartyId,
          parentLotIds: [...parentLotIds],
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: receipt.id,
          userId,
        });
        rowReworkLotId = lot.id;

        const share = surviving.greaterThan(0)
          ? rowValue.times(output.reworkQty).dividedBy(surviving).toDecimalPlaces(4)
          : ZERO;

        await postMovement(tx, {
          organizationId,
          lotId: lot.id,
          locationId: header.locationId,
          movementType: 'produce',
          qtyIn: output.reworkQty,
          valueIn: share,
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: receipt.id,
          remarks: 'Rework — to be re-issued against the same step.',
          postedAt: receiptDate,
          userId,
        });
      }

      lotsByOutput.set(output.itemId, {
        outputLotId: rowOutputLotId,
        reworkLotId: rowReworkLotId,
      });
      // The header's two columns are the PRIMARY's — the shortcut the receipt
      // screen and the rework re-issue already read. Every row's own pair is on
      // `job_receipt_outputs`.
      if (output.isPrimary) {
        outputLotId = rowOutputLotId;
        reworkLotId = rowReworkLotId;
      }
    }

    /**
     * 🔴 The RETURN side, recorded as rows (§5.7). `custom_fields` is left at its
     * default — the list is not a registered entity type, so there is nothing an
     * org could have defined to put in it.
     */
    for (const [index, output] of outputRows.entries()) {
      const lots = lotsByOutput.get(output.itemId);
      await tx.jobReceiptOutput.create({
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
          outputLotId: lots?.outputLotId ?? null,
          reworkLotId: lots?.reworkLotId ?? null,
          reasonId: output.reasonId,
          responsibility: output.responsibility,
          remarks: output.remarks,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
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
          parentPackageId: allocation.lotPackageId,
          issuedQty: allocation.qty,
          customFields: lineCustomFields,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    }

    await tx.jobReceipt.update({
      where: { id: receipt.id },
      data: { outputLotId, reworkLotId },
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
 * Refused once the lots it created have moved on. Un-posting a lot that has
 * already been issued to the next step would leave that step holding stock no
 * document explains — and the ledger has no way to express "this never happened"
 * retroactively, only "the opposite happened later".
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

    for (const lotId of [receipt.outputLotId, receipt.reworkLotId]) {
      if (!lotId) continue;
      const movedOn = await tx.stockLedgerEntry.count({
        where: {
          organizationId,
          lotId,
          sourceDocType: { not: SOURCE_DOC_TYPES.jobReceipt },
        },
      });
      if (movedOn > 0) {
        throw ApiError.conflict(
          'The lots this receipt created have already been used, so it cannot be cancelled.',
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
        lotId: true,
        lotPackageId: true,
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
        lotId: row.lotId,
        lotPackageId: row.lotPackageId,
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
