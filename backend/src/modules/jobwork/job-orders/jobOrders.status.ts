import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS, SOURCE_DOC_TYPES } from '../jobwork.types.ts';
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
  /** Scrapped at the processor when the step was completed — job order loss
   * (landed-cost R8). Net of any reversal. */
  writtenOffQty: Prisma.Decimal;
  writtenOffValue: Prisma.Decimal;
  /** Issued on challans a posted receipt closed (challan-closure R10) — consumed
   * into cost, as opposed to still out or written off. */
  closedQty: Prisma.Decimal;
}

const emptyFlow = (itemId: string): ItemFlow => ({
  itemId,
  issuedQty: ZERO,
  consumedQty: ZERO,
  writtenOffQty: ZERO,
  writtenOffValue: ZERO,
  closedQty: ZERO,
});

/** The challans among `receiptIds`' lines that a receipt closed — one read. */
async function closedIssueIds(
  tx: TenantClient,
  organizationId: string,
  receiptIds: readonly string[],
): Promise<Set<string>> {
  if (receiptIds.length === 0) return new Set();
  const rows = await tx.jobReceiptLine.findMany({
    where: {
      organizationId,
      jobReceiptId: { in: [...receiptIds] },
      closesChallan: true,
      isDeleted: false,
    },
    distinct: ['jobIssueId'],
    select: { jobIssueId: true },
  });
  return new Set(rows.flatMap((row) => (row.jobIssueId ? [row.jobIssueId] : [])));
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
  /** What the ACCEPTED goods landed at, summed from each posted receipt's stored
   * breakdown — divide by `acceptedQty` for the running cost per unit (R7). */
  landedValue: Prisma.Decimal;
}

/**
 * One receipt row's cost that stays with its accepted goods: their share of the
 * material, by quantity, plus the whole charge — rework carries material only (R7).
 * Per ROW, because the share is a ratio and summed rows would blur it.
 */
function acceptedLandedValue(sum: {
  acceptedQty: Prisma.Decimal | null;
  reworkQty: Prisma.Decimal | null;
  materialValue: Prisma.Decimal | null;
  processCharge: Prisma.Decimal | null;
}): Prisma.Decimal {
  const accepted = sum.acceptedQty ?? ZERO;
  const units = accepted.plus(sum.reworkQty ?? ZERO);
  const material = units.greaterThan(0)
    ? (sum.materialValue ?? ZERO).times(accepted).dividedBy(units)
    : ZERO;
  return material.plus(sum.processCharge ?? ZERO);
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
  /** Cross-item, like the two above — `perItem` is the truth on a multi-item step. */
  writtenOffQty: Prisma.Decimal;
  writtenOffValue: Prisma.Decimal;
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
 * 🔴 UNPOSTED DOCUMENTS ARE EXCLUDED FROM EVERY SUM — `POSTED_DOC_STATUS`, which
 * is two statuses and not one.
 *
 * A CANCELLED issue has already had its ledger rows reversed, so counting its
 * lines would make the step look like it is holding stock at a processor that
 * came back weeks ago. A DRAFT never posted anything in the first place: its
 * lines and its `total_*` columns are a typed intention, and counting them would
 * report material at a processor that is still sitting in the godown.
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
      status: POSTED_DOC_STATUS,
    },
    select: { id: true },
  });

  const receipts = await tx.jobReceipt.findMany({
    where: {
      organizationId,
      jobOrderStepId,
      isDeleted: false,
      status: POSTED_DOC_STATUS,
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
    jobOrderStepId,
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
    writtenOffQty: perItem.reduce((acc, row) => acc.plus(row.writtenOffQty), ZERO),
    writtenOffValue: perItem.reduce((acc, row) => acc.plus(row.writtenOffValue), ZERO),
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
  // Per receipt row as well as per item — the landed value is a ratio per row.
  const rows = await tx.jobReceiptOutput.groupBy({
    by: ['itemId', 'jobReceiptId'],
    where: { organizationId, jobReceiptId: { in: [...receiptIds] }, isDeleted: false },
    _sum: {
      receivedQty: true,
      acceptedQty: true,
      reworkQty: true,
      scrapQty: true,
      returnedQty: true,
      materialValue: true,
      processCharge: true,
    },
  });
  const flows = new Map<string, OutputFlow>();
  for (const row of rows) {
    const flow = flows.get(row.itemId) ?? {
      itemId: row.itemId,
      receivedQty: ZERO,
      acceptedQty: ZERO,
      reworkQty: ZERO,
      scrapQty: ZERO,
      returnedQty: ZERO,
      landedValue: ZERO,
    };
    flow.receivedQty = flow.receivedQty.plus(row._sum.receivedQty ?? ZERO);
    flow.acceptedQty = flow.acceptedQty.plus(row._sum.acceptedQty ?? ZERO);
    flow.reworkQty = flow.reworkQty.plus(row._sum.reworkQty ?? ZERO);
    flow.scrapQty = flow.scrapQty.plus(row._sum.scrapQty ?? ZERO);
    flow.returnedQty = flow.returnedQty.plus(row._sum.returnedQty ?? ZERO);
    flow.landedValue = flow.landedValue.plus(acceptedLandedValue(row._sum));
    flows.set(row.itemId, flow);
  }
  return [...flows.values()];
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
  jobOrderStepId: string,
  issueIds: readonly string[],
  receiptIds: readonly string[],
): Promise<ItemFlow[]> {
  const flows = new Map<string, ItemFlow>();
  const of = (itemId: string) => {
    const existing = flows.get(itemId);
    if (existing) return existing;
    const created = emptyFlow(itemId);
    flows.set(itemId, created);
    return created;
  };

  // Nothing is ever written off a step with no challans, so this read waits on one.
  if (issueIds.length > 0) {
    const writtenOff = await tx.stockLedgerEntry.groupBy({
      by: ['itemId'],
      where: {
        organizationId,
        sourceDocType: SOURCE_DOC_TYPES.jobOrderStep,
        sourceDocId: jobOrderStepId,
      },
      _sum: { qtyOut: true, qtyIn: true, valueOut: true, valueIn: true },
    });
    for (const row of writtenOff) {
      const flow = of(row.itemId);
      flow.writtenOffQty = (row._sum.qtyOut ?? ZERO).minus(row._sum.qtyIn ?? ZERO);
      flow.writtenOffValue = (row._sum.valueOut ?? ZERO).minus(row._sum.valueIn ?? ZERO);
    }
  }

  if (issueIds.length > 0) {
    const lines = await tx.jobIssueLine.findMany({
      where: { organizationId, jobIssueId: { in: [...issueIds] }, isDeleted: false },
      select: { qty: true, itemId: true, jobIssueId: true },
    });
    const closed = await closedIssueIds(tx, organizationId, receiptIds);
    for (const line of lines) {
      const flow = of(line.itemId);
      flow.issuedQty = flow.issuedQty.plus(line.qty);
      if (closed.has(line.jobIssueId)) flow.closedQty = flow.closedQty.plus(line.qty);
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
 * 🔴 `completed` IS NOT COMPUTED — it is `is_completed`, a flag a human sets from
 * the step's screen (2026-08-24, `4f70306`). Arithmetic decides everything below
 * it and nothing above: a step whose paperwork balances is still only
 * `partially_received`, because "every metre is accounted for" and "we are
 * finished with this operation" are different claims, and a processor may yet
 * send more against the same challan. `manuallyCompleteStep` is the one way in,
 * and `STICKY_STEP_STATUSES` is what stops this function walking it back.
 *
 * 🔴 PER ITEM, AND ON THE INPUT SIDE (§6.5) — which still governs the rest.
 *
 * **Per item.** `pending` and `issued` are judged over every item the step has
 * moved. Three items in three units cannot collapse into one pair of totals, and
 * a step whose panels are back but whose thread is still at the stitcher has not
 * gone quiet — summing them would say it had.
 *
 * **On the input side** — consumed against issued, never received against
 * issued. Both are in the input's own unit, so the comparison means something for
 * every step. Judging by `receivedQty` would work for dyeing (metres in, metres
 * out) and be nonsense for cutting (metres in, pieces out), where 2,850 pieces
 * against 4,800 metres reads as a shortfall that is not there.
 *
 * "Consumed" counts EVERY disposition, scrap and gate-returns included: the
 * question is whether anything is still sitting at the processor, and a scrapped
 * metre is not sitting anywhere.
 */
export function stepStatusFrom(totals: StepTotals, isCompleted: boolean): JobOrderStepStatus {
  if (isCompleted) return 'completed';
  const moved = totals.perItem.filter((row) => row.issuedQty.greaterThan(0));
  if (moved.length === 0) return 'pending';
  if (moved.every((row) => row.consumedQty.lessThanOrEqualTo(0))) return 'issued';
  return 'partially_received';
}

/** One input a step would draw from existing stock, because the earlier step that
 * produces it has returned none yet. */
export interface ChainWarning {
  itemId: string;
  message: string;
}

/**
 * 🔴 THE CHAIN IS A WARNING, NOT A BLOCK (2026-09-24). It refuses nothing.
 *
 * It used to refuse any step from issuing until the step directly above had
 * returned something — by position, whatever the items. That held up steps that
 * share no material with the step above (embroidery on bought-in patches waiting
 * on the dyer), which ERPs run in parallel. And its original reason is gone: it
 * stopped the old no-stock scaffold inventing work in progress, and the issue
 * save now refuses any quantity the ledger does not hold (`resolveLines`).
 *
 * So the only thing still worth saying is the case where it matters: this step
 * consumes an item an earlier step PRODUCES, and none of it has come back yet.
 * Issuing is still allowed — the stock on hand is real, e.g. dyed fabric left
 * from a closed order — but it is that older stock, and its FIFO cost, that goes
 * out. The Issue screen shows this per item; the save does not read it.
 *
 * By ITEM, against every earlier step producing it, not just the one directly
 * above: stitching that takes dyed fabric AND embroidered patches waits on both.
 * An input no earlier step produces is drawn from stock and never warns. A
 * producer closed short is finished by decision, so nobody waits on it.
 *
 * "Come back" is `receivedQty > 0` of that item on a POSTED receipt — rework
 * included (it came back), a draft receipt not (paperwork is not goods).
 */
export async function getChainWarnings(
  tx: TenantClient,
  organizationId: string,
  jobOrderId: string,
): Promise<Map<string, ChainWarning[]>> {
  const result = new Map<string, ChainWarning[]>();
  const steps = await tx.jobOrderStep.findMany({
    where: { organizationId, jobOrderId, isDeleted: false },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      seq: true,
      processNameSnapshot: true,
      status: true,
      inputs: { where: { isDeleted: false }, select: { itemId: true } },
      outputs: { where: { isDeleted: false }, select: { itemId: true } },
    },
  });
  if (steps.length < 2) return result;

  // Everything that has come back, per (step, item), in one read.
  const returnedRows = await tx.jobReceiptOutput.findMany({
    where: {
      organizationId,
      receivedQty: { gt: 0 },
      jobReceipt: {
        jobOrderStepId: { in: steps.map((s) => s.id) },
        isDeleted: false,
        status: POSTED_DOC_STATUS,
      },
    },
    select: { itemId: true, jobReceipt: { select: { jobOrderStepId: true } } },
  });
  const returned = new Set(returnedRows.map((r) => `${r.jobReceipt.jobOrderStepId}#${r.itemId}`));

  const pending = new Map<string, { itemId: string; producers: typeof steps }[]>();
  for (const step of steps) {
    for (const { itemId } of step.inputs) {
      const producers = steps.filter(
        (p) =>
          p.seq < step.seq &&
          p.status !== 'short_closed' &&
          p.outputs.some((o) => o.itemId === itemId),
      );
      if (producers.length === 0) continue;
      if (producers.some((p) => returned.has(`${p.id}#${itemId}`))) continue;
      pending.set(step.id, [...(pending.get(step.id) ?? []), { itemId, producers }]);
    }
  }
  if (pending.size === 0) return result;

  const itemIds = [...new Set([...pending.values()].flat().map((row) => row.itemId))];
  const names = new Map(
    (
      await tx.item.findMany({
        where: { organizationId, id: { in: itemIds } },
        select: { id: true, name: true },
      })
    ).map((item) => [item.id, item.name]),
  );

  for (const [stepId, rows] of pending) {
    result.set(
      stepId,
      rows.map(({ itemId, producers }) => {
        const from = producers.map((p) => `step ${p.seq} (${p.processNameSnapshot})`).join(', ');
        return {
          itemId,
          message: `No ${names.get(itemId) ?? 'material'} has come back from ${from} yet — issuing now uses stock already on hand.`,
        };
      }),
    );
  }
  return result;
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
      status: POSTED_DOC_STATUS,
    },
    select: { id: true, jobOrderStepId: true },
  });

  const allReceipts = await tx.jobReceipt.findMany({
    where: {
      organizationId,
      jobOrderStepId: { in: stepIds },
      isDeleted: false,
      status: POSTED_DOC_STATUS,
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

  const allLines =
    issueIds.length > 0
      ? await tx.jobIssueLine.findMany({
          where: { organizationId, jobIssueId: { in: issueIds }, isDeleted: false },
          select: { qty: true, itemId: true, jobIssueId: true },
        })
      : [];

  const allConsumed =
    receiptIds.length > 0
      ? await tx.stockLedgerEntry.groupBy({
          by: ['itemId', 'sourceDocId'],
          where: {
            organizationId,
            sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
            sourceDocId: { in: receiptIds },
            movementType: 'consume',
          },
          _sum: { qtyOut: true },
        })
      : [];

  // Every step's write-off in one read (landed-cost R8), keyed back by `sourceDocId`.
  const allWrittenOff =
    issueIds.length > 0
      ? await tx.stockLedgerEntry.groupBy({
          by: ['itemId', 'sourceDocId'],
          where: {
            organizationId,
            sourceDocType: SOURCE_DOC_TYPES.jobOrderStep,
            sourceDocId: { in: stepIds },
          },
          _sum: { qtyOut: true, qtyIn: true, valueOut: true, valueIn: true },
        })
      : [];

  const allOutputs =
    receiptIds.length > 0
      ? await tx.jobReceiptOutput.groupBy({
          by: ['itemId', 'jobReceiptId'],
          where: { organizationId, jobReceiptId: { in: receiptIds }, isDeleted: false },
          _sum: {
            receivedQty: true,
            acceptedQty: true,
            reworkQty: true,
            scrapQty: true,
            returnedQty: true,
            materialValue: true,
            processCharge: true,
          },
        })
      : [];

  const allClosed = await closedIssueIds(tx, organizationId, receiptIds);

  const sum = (rows: { [k: string]: unknown }[], key: string) =>
    rows.reduce((acc, row) => acc.plus(new Prisma.Decimal(String(row[key] ?? 0))), ZERO);

  for (const stepId of stepIds) {
    const stepIssues = allIssues.filter((i) => i.jobOrderStepId === stepId);
    const stepReceipts = allReceipts.filter((r) => r.jobOrderStepId === stepId);
    const stepIssueIds = new Set(stepIssues.map((i) => i.id));
    const stepReceiptIds = new Set(stepReceipts.map((r) => r.id));

    const stepLines = allLines.filter((l) => l.jobIssueId && stepIssueIds.has(l.jobIssueId));
    const stepConsumed = allConsumed.filter(
      (c) => c.sourceDocId && stepReceiptIds.has(c.sourceDocId),
    );
    const stepOutputs = allOutputs.filter((o) => stepReceiptIds.has(o.jobReceiptId));

    const flows = new Map<string, ItemFlow>();
    const of = (itemId: string) => {
      const existing = flows.get(itemId);
      if (existing) return existing;
      const created = emptyFlow(itemId);
      flows.set(itemId, created);
      return created;
    };
    for (const line of stepLines) {
      const flow = of(line.itemId);
      flow.issuedQty = flow.issuedQty.plus(line.qty);
      if (allClosed.has(line.jobIssueId)) flow.closedQty = flow.closedQty.plus(line.qty);
    }
    for (const row of stepConsumed) {
      const flow = of(row.itemId);
      flow.consumedQty = flow.consumedQty.plus(row._sum.qtyOut ?? ZERO);
    }
    for (const row of allWrittenOff) {
      if (row.sourceDocId !== stepId) continue;
      const flow = of(row.itemId);
      flow.writtenOffQty = flow.writtenOffQty
        .plus(row._sum.qtyOut ?? ZERO)
        .minus(row._sum.qtyIn ?? ZERO);
      flow.writtenOffValue = flow.writtenOffValue
        .plus(row._sum.valueOut ?? ZERO)
        .minus(row._sum.valueIn ?? ZERO);
    }
    const perItem = [...flows.values()];

    const outFlows = new Map<string, OutputFlow>();
    const outOf = (itemId: string) => {
      const existing = outFlows.get(itemId);
      if (existing) return existing;
      const created = {
        itemId,
        receivedQty: ZERO,
        acceptedQty: ZERO,
        reworkQty: ZERO,
        scrapQty: ZERO,
        returnedQty: ZERO,
        landedValue: ZERO,
      };
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
      flow.landedValue = flow.landedValue.plus(acceptedLandedValue(row._sum));
    }
    const perOutput = [...outFlows.values()];

    result.set(stepId, {
      issuedQty: perItem.reduce((acc, row) => acc.plus(row.issuedQty), ZERO),
      consumedQty: perItem.reduce((acc, row) => acc.plus(row.consumedQty), ZERO),
      writtenOffQty: perItem.reduce((acc, row) => acc.plus(row.writtenOffQty), ZERO),
      writtenOffValue: perItem.reduce((acc, row) => acc.plus(row.writtenOffValue), ZERO),
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
