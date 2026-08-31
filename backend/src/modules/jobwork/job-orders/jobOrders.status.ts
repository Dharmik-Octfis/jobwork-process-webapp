import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { SOURCE_DOC_TYPES } from '../jobwork.types.ts';
import type { JobOrderStatus, JobOrderStepStatus } from '../jobwork.types.ts';

/**
 * 🔴 THE ONLY WRITER OF `job_orders.status` AND `job_order_steps.status`.
 *
 * Both columns are CALC+ (field-sources §4.3): stored so a list page can filter
 * and sort on them without aggregating six tables, but never typed by anyone.
 * Every module that changes what a step has issued or received — jobIssues,
 * jobReceipts — calls `recomputeStep` in the SAME transaction as the write it
 * just made, exactly as they call `postMovement` for the ledger.
 *
 * The rule is worth holding for the same reason the ledger's is. A status a user
 * can set is a status that disagrees with the documents underneath it, and the
 * disagreement is invisible: the list says "completed", the Overview page adds
 * up the receipts and says otherwise, and there is no way to tell which is
 * lying. Deriving it means there is only ever one answer.
 *
 * WHAT IS DERIVED AND WHAT IS NOT
 *
 * `short_closed` and `cancelled` are DECISIONS, not sums. Nobody can compute
 * "we are calling this finished 150 m short" from quantities — it is exactly the
 * case where the numbers do not balance and a human says stop anyway. So both
 * are set explicitly, and both are sticky: once a step is short-closed, a later
 * recompute must not quietly reopen it because a stray receipt arrived.
 */

const ZERO = new Prisma.Decimal(0);

/** Statuses no recompute may overwrite. They were chosen, not calculated. */
const STICKY_STEP_STATUSES: readonly string[] = ['short_closed'];
const STICKY_ORDER_STATUSES: readonly string[] = ['short_closed', 'cancelled'];

/**
 * 🔴 ONE ITEM'S FLOW THROUGH A STEP — issued out, accounted for on the way back
 * (domain §6.5).
 *
 * This exists because a step consumes a SET of items now (§5.7) and a single pair
 * of totals cannot describe three of them: 2,910 PCS + 12 CONE + 8,700 PCS is
 * 11,622 of nothing. Every quantity here is in ONE item's own unit, which is what
 * makes the comparison mean something.
 *
 * `consumedQty` is read from the LEDGER rather than from the receipt rows. A bulk
 * receipt line names no challan line — one typed total closes whatever is still
 * outstanding, oldest first (`jobReceipts.service.ts`) — so the receipt document
 * cannot say which item it consumed. The `consume` movements it posted can: they
 * carry the batch, and a batch is one item.
 */
export interface ItemFlow {
  itemId: string;
  issuedQty: Prisma.Decimal;
  consumedQty: Prisma.Decimal;
}

/**
 * 🔴 ONE RETURNED ITEM'S TOTALS — the output side, and a separate shape from
 * `ItemFlow` on purpose.
 *
 * The two sides have different lengths and different units: cutting consumes one
 * fabric and returns panels, offcuts and waste. Nothing here may be compared
 * with anything in `ItemFlow` — 2,850 pieces against 4,800 metres is not a
 * comparison, which is why step completion is measured on the input side alone
 * (§6.5).
 */
export interface OutputFlow {
  itemId: string;
  receivedQty: Prisma.Decimal;
  acceptedQty: Prisma.Decimal;
  reworkQty: Prisma.Decimal;
  scrapQty: Prisma.Decimal;
  returnedQty: Prisma.Decimal;
}

export interface StepTotals {
  /**
   * The cross-item aggregates the Overview page renders. They are only strictly
   * meaningful where a step moves ONE item — which is every step until the
   * multi-item UI lands — and `perItem` below is the truth in every case. The
   * page's own per-item rendering is step 8 of plan §12.1.
   */
  issuedQty: Prisma.Decimal;
  /**
   * 🔴 How much of the ISSUED material the receipts have accounted for, in the
   * INPUT's unit. This is the only quantity that can be compared with
   * `issuedQty`, and the distinction is the whole reason it exists.
   *
   * `receivedQty` below is in the OUTPUT's unit, and for any step where the item
   * changes those are different units entirely — cutting issues 4,800 METRES and
   * returns 2,850 PIECES. Comparing them would be the exact mistake the domain
   * forbids everywhere else: treating a changed unit as a conversion (§5.1).
   */
  consumedQty: Prisma.Decimal;
  receivedQty: Prisma.Decimal;
  acceptedQty: Prisma.Decimal;
  reworkQty: Prisma.Decimal;
  scrapQty: Prisma.Decimal;
  returnedQty: Prisma.Decimal;
  issueCount: number;
  receiptCount: number;
  /** One row per item this step has actually moved — issues included, whatever
   * the plan said. A rework issue sends the OUTPUT item back out, so it appears
   * here too and has to be accounted for before the step is finished. */
  perItem: ItemFlow[];
  /** One row per item that has actually come BACK, whatever the plan said — a
   * receipt may return an item nobody expected. */
  perOutput: OutputFlow[];
}

/**
 * Everything one step has moved, in one place.
 *
 * Cancelled documents are excluded from every sum. A cancelled issue has already
 * had its ledger rows reversed, so counting its lines would make the step look
 * like it is holding stock at a processor that came back weeks ago.
 */
export async function getStepTotals(
  tx: TenantClient,
  organizationId: string,
  jobOrderStepId: string,
): Promise<StepTotals> {
  const issues = await tx.jobIssue.findMany({
    where: {
      organizationId,
      jobOrderStepId,
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    select: { id: true },
  });

  const receipts = await tx.jobReceipt.findMany({
    where: {
      organizationId,
      jobOrderStepId,
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    select: {
      id: true,
      totalIssuedQty: true,
      totalReceivedQty: true,
      totalAcceptedQty: true,
      totalReworkQty: true,
      totalScrapQty: true,
      totalReturnedQty: true,
    },
  });

  const sum = (rows: { [k: string]: unknown }[], key: string) =>
    rows.reduce((acc, row) => acc.plus(new Prisma.Decimal(String(row[key] ?? 0))), ZERO);

  const receiptIds = receipts.map((receipt) => receipt.id);
  const perItem = await getItemFlows(
    tx,
    organizationId,
    issues.map((issue) => issue.id),
    receiptIds,
  );
  const perOutput = await getOutputFlows(tx, organizationId, receiptIds);

  return {
    // Summed from the LINES, not from `job_issues.total_qty`. That column is a
    // single-item convenience which nothing here reads any more; it goes with the
    // rest of the scalars in Migration B (plan §12.1).
    issuedQty: perItem.reduce((acc, row) => acc.plus(row.issuedQty), ZERO),
    consumedQty: perItem.reduce((acc, row) => acc.plus(row.consumedQty), ZERO),
    receivedQty: sum(receipts, 'totalReceivedQty'),
    acceptedQty: sum(receipts, 'totalAcceptedQty'),
    reworkQty: sum(receipts, 'totalReworkQty'),
    scrapQty: sum(receipts, 'totalScrapQty'),
    returnedQty: sum(receipts, 'totalReturnedQty'),
    issueCount: issues.length,
    receiptCount: receipts.length,
    perItem,
    perOutput,
  };
}

/**
 * What has actually come back, per item.
 *
 * Read from `job_receipt_outputs` — the receipt's own record of the returned set
 * (§5.7). The header's six totals describe the PRIMARY output alone, so summing
 * those would silently drop every by-product.
 */
async function getOutputFlows(
  tx: TenantClient,
  organizationId: string,
  receiptIds: readonly string[],
): Promise<OutputFlow[]> {
  if (receiptIds.length === 0) return [];
  const rows = await tx.jobReceiptOutput.groupBy({
    by: ['itemId'],
    where: { organizationId, jobReceiptId: { in: [...receiptIds] }, isDeleted: false },
    _sum: {
      receivedQty: true,
      acceptedQty: true,
      reworkQty: true,
      scrapQty: true,
      returnedQty: true,
    },
  });
  return rows.map((row) => ({
    itemId: row.itemId,
    receivedQty: row._sum.receivedQty ?? ZERO,
    acceptedQty: row._sum.acceptedQty ?? ZERO,
    reworkQty: row._sum.reworkQty ?? ZERO,
    scrapQty: row._sum.scrapQty ?? ZERO,
    returnedQty: row._sum.returnedQty ?? ZERO,
  }));
}

/**
 * What went out and what has been accounted for, per item.
 *
 * Issued comes from the challan LINES: the item lives there now (§5.7), and
 * `job_issue_lines.itemId` is nullable only because rows written before Sprint 5
 * were back-filled from the header — hence the fallback, which disappears with
 * Migration B.
 *
 * Consumed comes from the `consume` movements those receipts posted. Cancelled
 * receipts never reach this function, so their reversals cannot be double-counted
 * — the caller has already filtered them out by status.
 */
async function getItemFlows(
  tx: TenantClient,
  organizationId: string,
  issueIds: readonly string[],
  receiptIds: readonly string[],
): Promise<ItemFlow[]> {
  const flows = new Map<string, ItemFlow>();
  const of = (itemId: string) => {
    const existing = flows.get(itemId);
    if (existing) return existing;
    const created = { itemId, issuedQty: ZERO, consumedQty: ZERO };
    flows.set(itemId, created);
    return created;
  };

  if (issueIds.length > 0) {
    const lines = await tx.jobIssueLine.findMany({
      where: { organizationId, jobIssueId: { in: [...issueIds] }, isDeleted: false },
      select: { qty: true, itemId: true },
    });
    for (const line of lines) {
      const flow = of(line.itemId);
      flow.issuedQty = flow.issuedQty.plus(line.qty);
    }
  }

  if (receiptIds.length > 0) {
    const consumed = await tx.stockLedgerEntry.groupBy({
      by: ['itemId'],
      where: {
        organizationId,
        sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
        sourceDocId: { in: [...receiptIds] },
        movementType: 'consume',
      },
      _sum: { qtyOut: true },
    });
    for (const row of consumed) {
      const flow = of(row.itemId);
      flow.consumedQty = flow.consumedQty.plus(row._sum.qtyOut ?? ZERO);
    }
  }

  return [...flows.values()];
}

/**
 * The step status these totals imply.
 *
 * 🔴 PER ITEM, AND ON THE INPUT SIDE (§6.5). Two rules, and the first one only
 * appeared with §5.7.
 *
 * **Per item.** The step is `completed` when EVERY item it has issued has been
 * fully accounted for. Three items in three units cannot collapse into one pair
 * of totals, and a step whose panels are back but whose thread is still at the
 * stitcher is not finished — summing them would say it was.
 *
 * **On the input side** — consumed against issued, never received against
 * issued. Both of those are in the input's own unit, so the comparison means
 * something for every step. Judging by `receivedQty` would work for dyeing
 * (metres in, metres out) and be nonsense for cutting (metres in, pieces out),
 * where a perfectly complete step would sit at `partially_received` forever
 * because 2,850 is less than 4,800.
 *
 * "Consumed" counts EVERY disposition, including scrap and the pieces handed
 * straight back at the gate. The question a status answers is "is anything still
 * sitting at the processor", and a scrapped metre is not sitting anywhere — it
 * has been accounted for. Judging by accepted quantity alone would leave every
 * step with any wastage permanently `partially_received`, which is most of them.
 */
export function stepStatusFrom(totals: StepTotals, isCompleted: boolean): JobOrderStepStatus {
  if (isCompleted) return 'completed';
  const moved = totals.perItem.filter((row) => row.issuedQty.greaterThan(0));
  if (moved.length === 0) return 'pending';
  if (moved.every((row) => row.consumedQty.lessThanOrEqualTo(0))) return 'issued';

  // We no longer automatically return 'completed'. If it has received something,
  // it is partially_received until manually completed.
  return 'partially_received';
}

/**
 * 🔴 A STEP CANNOT ISSUE UNTIL THE STEP BEFORE IT HAS RETURNED SOMETHING.
 *
 * The steps of a job order are a SEQUENCE of operations on the same material:
 * step 2 works on what step 1 sent back. Until step 1 has received anything
 * there is physically nothing for step 2 to send, and a challan raised anyway
 * describes goods that do not exist.
 *
 * 🔴 BY POSITION, not by matching items. It used to ask whether step 2's inputs
 * were *declared* as fed by step 1 — and a step whose PRODUCES list was left
 * empty, or which named a different item, declared no link at all, so the rule
 * silently did not apply and step 2 could issue against nothing. Position is
 * what the shop floor means by "the next step", and it cannot be typed wrong.
 *
 * "Returned something" is `receivedQty > 0` on a non-cancelled receipt. Not
 * accepted quantity: a consignment that came back entirely as rework did come
 * back, and the rework has to be re-issued from somewhere.
 *
 * Lives here rather than in the service because both the Overview (to disable
 * the button) and `jobIssues.service.ts` (to refuse the save) must ask exactly
 * the same question — a button that merely hides is a rule a second tab walks
 * straight past.
 */
export async function chainNotReady(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
  step: { id: string; seq: number },
): Promise<string | null> {
  if (step.seq <= 1) return null;

  const previous = await tx.jobOrderStep.findFirst({
    where: { organizationId, jobOrderId, seq: { lt: step.seq }, isDeleted: false },
    orderBy: { seq: 'desc' },
    select: { id: true, seq: true, processNameSnapshot: true, status: true },
  });
  // No step above it — the seq numbering has a hole, so there is nothing to wait
  // for and blocking would be arbitrary.
  if (!previous) return null;

  // A step closed short is finished by decision, not by arithmetic. Whatever it
  // did or did not return, nobody is waiting on it any more.
  if (previous.status === 'short_closed') return null;

  const returned = await tx.jobReceipt.aggregate({
    where: {
      organizationId,
      jobOrderStepId: previous.id,
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    _sum: { totalReceivedQty: true },
  });
  if ((returned._sum.totalReceivedQty ?? ZERO).greaterThan(0)) return null;

  return `Nothing has come back from step ${previous.seq} (${previous.processNameSnapshot}) yet, so there is nothing to send on.`;
}

/**
 * Recompute one step, then its parent order. Call it in the same transaction as
 * whatever changed — an issue saved but a status left stale is two screens
 * telling two different stories.
 */
export async function recomputeStep(
  tx: TenantClient,
  organizationId: string,
  jobOrderStepId: string,
) {
  const step = await tx.jobOrderStep.findFirst({
    where: { id: jobOrderStepId, organizationId, isDeleted: false },
    select: { id: true, jobOrderId: true, status: true, isCompleted: true },
  });
  if (!step) return;

  if (!STICKY_STEP_STATUSES.includes(step.status)) {
    const totals = await getStepTotals(tx, organizationId, jobOrderStepId);
    const next = stepStatusFrom(totals, step.isCompleted);
    if (next !== step.status) {
      await tx.jobOrderStep.update({ where: { id: step.id }, data: { status: next } });
    }
  }

  await recomputeJobOrder(tx, organizationId, step.jobOrderId);
}

/**
 * The order's status, rolled up from its steps.
 *
 * `draft` means "nothing has physically happened yet" — no step has issued
 * anything, so the order can still be edited freely. The first issue moves it to
 * `in_progress` and, from then on, editing the steps grid is refused (see
 * jobOrders.service.ts): the numbers on a released order are on paperwork a
 * processor is holding.
 */
export async function recomputeJobOrder(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
) {
  const order = await tx.jobOrder.findFirst({
    where: { id: jobOrderId, organizationId, isDeleted: false },
    select: { id: true, status: true },
  });
  if (!order || STICKY_ORDER_STATUSES.includes(order.status)) return;

  const steps = await tx.jobOrderStep.findMany({
    where: { organizationId, jobOrderId, isDeleted: false },
    select: { status: true },
  });

  let next: JobOrderStatus;
  if (steps.length === 0 || steps.every((s) => s.status === 'pending')) {
    next = 'draft';
  } else if (steps.every((s) => s.status === 'completed' || s.status === 'short_closed')) {
    next = 'completed';
  } else {
    next = 'in_progress';
  }

  if (next !== order.status) {
    await tx.jobOrder.update({ where: { id: order.id }, data: { status: next } });
  }
}

/**
 * Bulk version of getStepTotals to solve N+1 on the overview page.
 */
export async function getAllStepTotals(
  tx: TenantClient,
  organizationId: string,
  stepIds: string[],
): Promise<Map<string, StepTotals>> {
  const result = new Map<string, StepTotals>();
  if (stepIds.length === 0) return result;

  const allIssues = await tx.jobIssue.findMany({
    where: {
      organizationId,
      jobOrderStepId: { in: stepIds },
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    select: { id: true, jobOrderStepId: true },
  });

  const allReceipts = await tx.jobReceipt.findMany({
    where: {
      organizationId,
      jobOrderStepId: { in: stepIds },
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    select: {
      id: true,
      jobOrderStepId: true,
      totalIssuedQty: true,
      totalReceivedQty: true,
      totalAcceptedQty: true,
      totalReworkQty: true,
      totalScrapQty: true,
      totalReturnedQty: true,
    },
  });

  const issueIds = allIssues.map((i) => i.id);
  const receiptIds = allReceipts.map((r) => r.id);

  const allLines = issueIds.length > 0 ? await tx.jobIssueLine.findMany({
    where: { organizationId, jobIssueId: { in: issueIds }, isDeleted: false },
    select: { qty: true, itemId: true, jobIssueId: true },
  }) : [];

  const allConsumed = receiptIds.length > 0 ? await tx.stockLedgerEntry.groupBy({
    by: ['itemId', 'sourceDocId'],
    where: {
      organizationId,
      sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
      sourceDocId: { in: receiptIds },
      movementType: 'consume',
    },
    _sum: { qtyOut: true },
  }) : [];

  const allOutputs = receiptIds.length > 0 ? await tx.jobReceiptOutput.groupBy({
    by: ['itemId', 'jobReceiptId'],
    where: { organizationId, jobReceiptId: { in: receiptIds }, isDeleted: false },
    _sum: {
      receivedQty: true,
      acceptedQty: true,
      reworkQty: true,
      scrapQty: true,
      returnedQty: true,
    },
  }) : [];

  const sum = (rows: { [k: string]: unknown }[], key: string) =>
    rows.reduce((acc, row) => acc.plus(new Prisma.Decimal(String(row[key] ?? 0))), ZERO);

  for (const stepId of stepIds) {
    const stepIssues = allIssues.filter(i => i.jobOrderStepId === stepId);
    const stepReceipts = allReceipts.filter(r => r.jobOrderStepId === stepId);
    const stepIssueIds = new Set(stepIssues.map(i => i.id));
    const stepReceiptIds = new Set(stepReceipts.map(r => r.id));

    const stepLines = allLines.filter(l => l.jobIssueId && stepIssueIds.has(l.jobIssueId));
    const stepConsumed = allConsumed.filter(c => c.sourceDocId && stepReceiptIds.has(c.sourceDocId));
    const stepOutputs = allOutputs.filter(o => stepReceiptIds.has(o.jobReceiptId));

    const flows = new Map<string, ItemFlow>();
    const of = (itemId: string) => {
      const existing = flows.get(itemId);
      if (existing) return existing;
      const created = { itemId, issuedQty: ZERO, consumedQty: ZERO };
      flows.set(itemId, created);
      return created;
    };
    for (const line of stepLines) {
      const flow = of(line.itemId);
      flow.issuedQty = flow.issuedQty.plus(line.qty);
    }
    for (const row of stepConsumed) {
      const flow = of(row.itemId);
      flow.consumedQty = flow.consumedQty.plus(row._sum.qtyOut ?? ZERO);
    }
    const perItem = [...flows.values()];

    const outFlows = new Map<string, OutputFlow>();
    const outOf = (itemId: string) => {
      const existing = outFlows.get(itemId);
      if (existing) return existing;
      const created = { itemId, receivedQty: ZERO, acceptedQty: ZERO, reworkQty: ZERO, scrapQty: ZERO, returnedQty: ZERO };
      outFlows.set(itemId, created);
      return created;
    };
    for (const row of stepOutputs) {
      const flow = outOf(row.itemId);
      flow.receivedQty = flow.receivedQty.plus(row._sum.receivedQty ?? ZERO);
      flow.acceptedQty = flow.acceptedQty.plus(row._sum.acceptedQty ?? ZERO);
      flow.reworkQty = flow.reworkQty.plus(row._sum.reworkQty ?? ZERO);
      flow.scrapQty = flow.scrapQty.plus(row._sum.scrapQty ?? ZERO);
      flow.returnedQty = flow.returnedQty.plus(row._sum.returnedQty ?? ZERO);
    }
    const perOutput = [...outFlows.values()];

    result.set(stepId, {
      issuedQty: perItem.reduce((acc, row) => acc.plus(row.issuedQty), ZERO),
      consumedQty: perItem.reduce((acc, row) => acc.plus(row.consumedQty), ZERO),
      receivedQty: sum(stepReceipts, 'totalReceivedQty'),
      acceptedQty: sum(stepReceipts, 'totalAcceptedQty'),
      reworkQty: sum(stepReceipts, 'totalReworkQty'),
      scrapQty: sum(stepReceipts, 'totalScrapQty'),
      returnedQty: sum(stepReceipts, 'totalReturnedQty'),
      issueCount: stepIssues.length,
      receiptCount: stepReceipts.length,
      perItem,
      perOutput,
    });
  }

  return result;
}

/**
 * Bulk version of chainNotReady.
 */
export async function getAllChainNotReady(
  tx: TenantClient,
  organizationId: string,
  _jobOrderId: string,
  steps: { id: string; seq: number; processNameSnapshot: string; status: string }[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (steps.length === 0) return result;

  const previousIds = steps.filter(s => s.seq > 1).map(s => {
    // Find the immediately preceding step
    const prevs = steps.filter(p => p.seq < s.seq).sort((a, b) => b.seq - a.seq);
    return prevs[0]?.id;
  }).filter(Boolean) as string[];

  const returned = previousIds.length > 0 ? await tx.jobReceipt.groupBy({
    by: ['jobOrderStepId'],
    where: {
      organizationId,
      jobOrderStepId: { in: previousIds },
      isDeleted: false,
      status: { not: 'cancelled' },
    },
    _sum: { totalReceivedQty: true },
  }) : [];
  const returnedByStep = new Map(returned.map(r => [r.jobOrderStepId, r._sum.totalReceivedQty ?? ZERO]));

  for (const step of steps) {
    if (step.seq <= 1) {
      result.set(step.id, null);
      continue;
    }
    const prevs = steps.filter(p => p.seq < step.seq).sort((a, b) => b.seq - a.seq);
    const previous = prevs[0];
    if (!previous) {
      result.set(step.id, null);
      continue;
    }
    if (previous.status === 'short_closed') {
      result.set(step.id, null);
      continue;
    }
    const received = returnedByStep.get(previous.id) ?? ZERO;
    if (received.greaterThan(0)) {
      result.set(step.id, null);
      continue;
    }
    result.set(step.id, `Nothing has come back from step ${previous.seq} (${previous.processNameSnapshot}) yet, so there is nothing to send on.`);
  }
  return result;
}
