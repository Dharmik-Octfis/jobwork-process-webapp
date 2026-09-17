import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import {
  getBalancesByBatch,
  postMovement,
  resolveBatchesForPosting,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import { closedQtyByIssueLine } from '../jobwork.posting.ts';
import { POSTED_DOC_STATUS, SOURCE_DOC_TYPES } from '../jobwork.types.ts';

const ZERO = new Prisma.Decimal(0);
/** Below this a shortfall is rounding in the consume rows, not missing stock. */
const SHORTFALL_NOISE = new Prisma.Decimal('0.0001');

export interface WrittenOff {
  itemId: string;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
}

/**
 * 🔴 R8 — WHAT A FINISHED STEP LEAVES AT THE PROCESSOR IS WRITTEN OFF
 * (docs/JOBWORK_LANDED_COST_PLAN.md §3, D7–D8).
 *
 * Receipts consume only what the plan says the returned goods used, so a step
 * ends with material still standing at the processor. Completing the step is the
 * moment somebody says none of it is coming back: every posted challan line's
 * remainder is scrapped where it stands — same batch, same package — at that
 * batch's running cost there, and its value is job order loss. It is never loaded
 * back onto output batches, which may already have moved on (D8).
 *
 * All of it, however small, so a completed step leaves exactly nothing behind.
 * Customer-owned stock posts at zero value, as everywhere (`postMovement`).
 *
 * Call it with the step locked (`lockStep`), inside the transaction that marks the
 * step finished. One grouped balance read per place the challans went, and the
 * running balance kept in memory as each row posts — two lines on one batch must
 * see what the first took.
 */
export async function writeOffStep(
  tx: TenantClient,
  organizationId: string,
  stepId: string,
  opts: { reason: string; userId?: string | null },
): Promise<WrittenOff[]> {
  const issues = await tx.jobIssue.findMany({
    where: { organizationId, jobOrderStepId: stepId, isDeleted: false, status: POSTED_DOC_STATUS },
    orderBy: { issueDate: 'asc' },
    select: {
      challanNumber: true,
      destinationLocationId: true,
      lines: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, batchId: true, batchUnitId: true, itemId: true, qty: true },
      },
    },
  });
  const lines = issues.flatMap((issue) =>
    issue.lines.map((line) => ({
      ...line,
      challanNumber: issue.challanNumber,
      locationId: issue.destinationLocationId,
    })),
  );
  if (lines.length === 0) return [];

  const closed = await closedQtyByIssueLine(
    tx,
    organizationId,
    lines.map((line) => line.id),
  );
  const open = lines
    .map((line) => ({ ...line, outstanding: line.qty.minus(closed.get(line.id) ?? ZERO) }))
    .filter((line) => line.outstanding.greaterThan(0));
  if (open.length === 0) return [];

  const batchIdsByLocation = new Map<string, Set<string>>();
  for (const line of open) {
    const batchIds = batchIdsByLocation.get(line.locationId) ?? new Set<string>();
    batchIds.add(line.batchId);
    batchIdsByLocation.set(line.locationId, batchIds);
  }
  const balances = new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>();
  for (const [locationId, batchIds] of batchIdsByLocation) {
    const read = await getBalancesByBatch(tx, {
      organizationId,
      locationId,
      batchIds: [...batchIds],
    });
    for (const [batchId, balance] of read) balances.set(`${locationId}:${batchId}`, balance);
  }
  const batches = await resolveBatchesForPosting(tx, organizationId, [
    ...new Set(open.map((line) => line.batchId)),
  ]);

  const written: WrittenOff[] = [];
  for (const line of open) {
    const key = `${line.locationId}:${line.batchId}`;
    const balance = balances.get(key) ?? { qty: ZERO, value: ZERO };
    /*
     * 🔴 Refused rather than posted into a negative balance. The challans say this
     * much is still out and the ledger says it is not there — writing it off anyway
     * would bury that disagreement under a loss figure nobody could reconcile.
     */
    if (line.outstanding.minus(balance.qty).greaterThan(SHORTFALL_NOISE)) {
      throw ApiError.conflict(
        `Challan ${line.challanNumber} says ${line.outstanding.toString()} is still with the ` +
          `processor, but the stock ledger holds only ${balance.qty.toString()} of that batch there. ` +
          'The step cannot be written off until the two agree.',
      );
    }
    const qty = Prisma.Decimal.min(line.outstanding, balance.qty);
    if (qty.lessThanOrEqualTo(0)) continue;
    const unitValue = balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : ZERO;

    const posted = await postMovement(
      tx,
      {
        organizationId,
        batchId: line.batchId,
        batchUnitId: line.batchUnitId,
        locationId: line.locationId,
        movementType: 'scrap',
        qtyOut: qty,
        valueOut: unitValue.times(qty).toDecimalPlaces(4),
        sourceDocType: SOURCE_DOC_TYPES.jobOrderStep,
        sourceDocId: stepId,
        sourceDocLineId: line.id,
        remarks: opts.reason,
        userId: opts.userId ?? null,
      },
      batches,
    );
    // From the row actually written — `postMovement` zeroes customer-owned value.
    balances.set(key, {
      qty: balance.qty.minus(posted.qtyOut),
      value: balance.value.minus(posted.valueOut),
    });
    written.push({ itemId: line.itemId, qty: posted.qtyOut, value: posted.valueOut });
  }
  return written;
}
