import { runAsTenant, type TenantClient } from '../../../db/prisma.js';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.js';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.js';
import { allocateNumber } from '../../../lib/numberSequence.js';
import { splitByQty } from '../../../lib/splitByQty.js';
import type { ListQuery } from '../../../lib/pagination.js';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.js';
import {
  asResolvedBatch,
  createBatch,
  createBatchUnits,
  getBalancesByBatchUnit,
  postMovement,
  resolveBatchesForPosting,
  resolveExistingBatchUnits,
  reverseMovement,
  type ResolvedBatches,
} from '../stock-ledger/stockLedger.service.js';
import { allocateOutward } from '../stock-ledger/allocateOutward.js';
import { approvalExecutionService } from '../../automation/approval-processes/approvalExecution.service.ts';
import { ensureApprovalTables } from '../../automation/approval-processes/approvalTables.migration.ts';
import { registerApprovalOutcomeHandler } from '../../automation/approval-processes/approvalOutcome.registry.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  AdjustmentBatchDto,
  AdjustmentLineDto,
  SaveAdjustmentDto,
} from './adjustments.schemas.js';

/**
 * Stock adjustment — docs/STOCK_ADJUSTMENT_PLAN.md and STOCK_ADJUSTMENT_ROUND2_PLAN.md.
 *
 * A header and one line per item. A draft holds no stock; ADJUST posts every
 * line in one transaction — or, when an approval process applies, waits as
 * `pending_approval` and posts when the last approver approves. An increase
 * posts inward `adjustment` rows at the cost the user states; a decrease posts
 * outward ones and FIFO decides what they cost. Once adjusted it is never
 * edited: cancel reverses the rows.
 */

/** Already the FIFO cost-lot report's key for these rows. */
const ADJUSTMENT_DOC_TYPE = 'inventory_adjustment';

/** What the approval engine knows this module as — its table name, which is
 * also what the `STOCK_ADJUSTMENTS` app module resolves to. */
export const ADJUSTMENT_APPROVAL_MODULE = 'stock_adjustments';

/** Same figures and reasoning as `DOCUMENT_TX` in `jobwork.types.ts`; duplicated
 * because inventory must not import from jobwork. */
const DOCUMENT_TX = { maxWait: 15_000, timeout: 120_000 } as const;

function runAsDocument<T>(orgId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  return runAsTenant(orgId, fn, DOCUMENT_TX);
}

const QTY_EPSILON = new Prisma.Decimal('0.00005');
const ZERO = new Prisma.Decimal(0);
const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

/** Stock here is somebody else's to account for: a job worker's shrinkage belongs
 * to challan closure, where it enters the cost of what comes back. */
const REFUSED_LOCATION_TYPES = ['processor', 'in_transit', 'customer_site'];

/** Saved, holding no stock, and not waiting on anybody. */
const EDITABLE_STATUSES = ['draft', 'rejected', 'approved'];

interface PostContext {
  organizationId: string;
  userId: string | null;
  adjustmentId: string;
  lineId: string;
  locationId: string;
  postedAt: Date;
}

interface LineItem {
  id: string;
  name: string;
  itemType: string;
  trackInventory: boolean;
  inventoryTracking: string | null;
}

/** A line as posting needs it — the same whether it came off the form a moment
 * ago or out of a draft saved last week. */
interface PostableLine {
  id: string;
  item: LineItem;
  quantityAdjusted: Prisma.Decimal;
  costPrice: Prisma.Decimal | null;
  batches: AdjustmentBatchDto[];
}

const isTracked = (item: LineItem) => (item.inventoryTracking ?? 'none') !== 'none';

/**
 * 🔴 WHAT MUST BE TRUE OF A LINE BEFORE IT CAN POST, that needs no stock to
 * check. Run when a draft is submitted as well as when it posts, so an approver
 * is never asked to approve a document that could not post in any case.
 */
function assertLineComplete(line: PostableLine): void {
  const { item } = line;
  const increase = line.quantityAdjusted.greaterThan(0);
  const magnitude = line.quantityAdjusted.abs();

  if (increase && line.costPrice === null) {
    throw ApiError.badRequest(`${item.name}: stock being added needs a cost price.`, {
      lines: `${item.name}: enter the cost price.`,
    });
  }
  if (!isTracked(item)) return;

  if (line.batches.length === 0) {
    throw ApiError.badRequest(`${item.name} is batch-tracked, so the batches must be named.`, {
      lines: `${item.name}: ${increase ? 'add' : 'select'} the batches.`,
    });
  }
  const total = line.batches.reduce((sum, row) => sum.plus(row.quantity), ZERO);
  if (total.minus(magnitude).abs().greaterThan(QTY_EPSILON)) {
    throw ApiError.badRequest(
      `${item.name}: the batches add up to ${total.toString()}, but ${magnitude.toString()} ` +
        'is being adjusted.',
      { lines: `${item.name}: batches must add up to ${magnitude.toString()}.` },
    );
  }
  if (!increase && line.batches.some((row) => !row.batchId)) {
    throw ApiError.badRequest(`${item.name}: select the batch each quantity comes out of.`, {
      lines: `${item.name}: select a batch on every row.`,
    });
  }
}

/** Write one document row and post its movement, tagged with the row's id. */
async function postRow(
  tx: TenantClient,
  ctx: PostContext,
  row: {
    batchId: string;
    batchUnitId: string | null;
    qty: Prisma.Decimal;
    /** Set on an increase. Absent means outward, costed by FIFO. */
    valueIn?: Prisma.Decimal;
  },
  batches?: ResolvedBatches,
) {
  const line = await tx.stockAdjustmentBatch.create({
    data: {
      organizationId: ctx.organizationId,
      adjustmentId: ctx.adjustmentId,
      lineId: ctx.lineId,
      batchId: row.batchId,
      batchUnitId: row.batchUnitId,
      qty: row.qty,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    },
    select: { id: true },
  });
  return postMovement(
    tx,
    {
      organizationId: ctx.organizationId,
      batchId: row.batchId,
      batchUnitId: row.batchUnitId,
      locationId: ctx.locationId,
      movementType: 'adjustment',
      ...(row.valueIn ? { qtyIn: row.qty, valueIn: row.valueIn } : { qtyOut: row.qty }),
      sourceDocType: ADJUSTMENT_DOC_TYPE,
      sourceDocId: ctx.adjustmentId,
      sourceDocLineId: line.id,
      postedAt: ctx.postedAt,
      userId: ctx.userId,
    },
    batches,
  );
}

/**
 * Receive one batch row of an increase: create or resolve the batch and its
 * packages, then post one row per package plus one for what is untagged — the
 * same grain, and the same package rules, as a bill (`receiveBillBatch`).
 */
async function receiveBatch(
  tx: TenantClient,
  ctx: PostContext,
  args: {
    itemId: string;
    value: Prisma.Decimal;
    batch: AdjustmentBatchDto;
    /** The batches the document named, read once for all of it. */
    existing: ResolvedBatches;
  },
): Promise<Prisma.Decimal> {
  const { batch } = args;
  const quantity = decimal(batch.quantity);
  const label = batch.supplierBatchRef || 'this batch';

  let batchId = batch.batchId;
  let resolved: ResolvedBatches | undefined;
  let uomId: string | null = null;
  if (batchId) {
    const found = args.existing.get(batchId);
    // `postMovement` copies the item off the BATCH, so a batch of another item
    // here would quietly adjust that other item's stock.
    if (!found || found.itemId !== args.itemId || found.ownership !== 'own') {
      throw ApiError.badRequest('One of the batches picked does not belong to this item.', {
        lines: 'Pick a batch of this item.',
      });
    }
  } else {
    const created = await createBatch(tx, {
      organizationId: ctx.organizationId,
      itemId: args.itemId,
      supplierBatchRef: batch.supplierBatchRef,
      manufacturerBatch: batch.manufacturerBatch,
      manufacturedDate: batch.manufacturedDate,
      expiryDate: batch.expiryDate,
      mrp: batch.mrp,
      sellingPrice: batch.sellingPrice,
      sourceDocType: ADJUSTMENT_DOC_TYPE,
      sourceDocId: ctx.adjustmentId,
      userId: ctx.userId,
    });
    batchId = created.id;
    uomId = created.uomId;
    resolved = asResolvedBatch(created);
  }

  const units = batch.units ?? [];
  const unitTotal = units.reduce((sum, unit) => sum.plus(unit.quantity), ZERO);
  // Naming any package commits to naming them all — the bill's rule.
  if (units.length > 0 && unitTotal.minus(quantity).abs().greaterThan(QTY_EPSILON)) {
    throw ApiError.badRequest(
      `The units named inside ${label} add up to ${unitTotal.toString()}, not the ` +
        `${quantity.toString()} being added to it.`,
      { lines: `${label}: its units must account for the whole quantity, or name none at all.` },
    );
  }

  const newUnits = units.filter((unit) => !unit.batchUnitId);
  const topUps = units.filter((unit) => unit.batchUnitId);
  if (topUps.length && !batch.batchId) {
    throw ApiError.badRequest('A batch being created has no existing units to add to.', {
      lines: 'Pick an existing batch before adding to one of its units.',
    });
  }

  const postableUnits = [
    ...(newUnits.length
      ? await createBatchUnits(tx, {
          organizationId: ctx.organizationId,
          batchId,
          units: newUnits.map((unit) => ({ label: unit.label ?? '', qty: unit.quantity })),
          uomId,
          sourceDocType: ADJUSTMENT_DOC_TYPE,
          sourceDocId: ctx.adjustmentId,
          userId: ctx.userId,
        })
      : []),
    ...(topUps.length
      ? await resolveExistingBatchUnits(tx, {
          organizationId: ctx.organizationId,
          batchId,
          units: topUps.map((unit) => ({ batchUnitId: unit.batchUnitId!, qty: unit.quantity })),
        })
      : []),
  ];

  const loose = quantity.minus(unitTotal);
  const hasLoose = loose.greaterThan(QTY_EPSILON);
  const shares = splitByQty(args.value, [
    ...postableUnits.map((unit) => unit.qty),
    ...(hasLoose ? [loose] : []),
  ]);

  // A batch born here has no packages until the ones above; say so, so the
  // untagged row below is still checked against them.
  const postable = resolved
    ? asResolvedBatch([...resolved.values()][0]!, postableUnits.length)
    : args.existing;

  let posted = ZERO;
  for (const [index, unit] of postableUnits.entries()) {
    const entry = await postRow(
      tx,
      ctx,
      { batchId, batchUnitId: unit.id, qty: unit.qty, valueIn: shares[index] ?? ZERO },
      postable,
    );
    posted = posted.plus(entry.valueIn);
  }
  if (hasLoose) {
    const entry = await postRow(
      tx,
      ctx,
      { batchId, batchUnitId: null, qty: loose, valueIn: shares[shares.length - 1] ?? ZERO },
      postable,
    );
    posted = posted.plus(entry.valueIn);
  }
  return posted;
}

const LINE_ITEM_SELECT = {
  id: true,
  name: true,
  sku: true,
  unit: true,
  itemType: true,
  trackInventory: true,
  inventoryTracking: true,
  costPrice: true,
  sellingPrice: true,
  stockingUom: { select: { symbol: true } },
} as const;

const DETAIL_INCLUDE = {
  location: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, fullName: true } },
  lines: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    select: {
      id: true,
      seq: true,
      itemId: true,
      quantityAdjusted: true,
      quantityBefore: true,
      costPrice: true,
      value: true,
      draftBatches: true,
      item: { select: LINE_ITEM_SELECT },
      batches: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          batchId: true,
          batchUnitId: true,
          qty: true,
          batch: { select: { supplierBatchRef: true, manufacturerBatch: true, expiryDate: true } },
          batchUnit: { select: { label: true } },
        },
      },
    },
  },
} as const satisfies Prisma.StockAdjustmentInclude;

/** The shared list query, plus one item — the item page's Transactions tab. */
export type AdjustmentListQuery = ListQuery & { itemId?: string };

function draftBatchesOf(value: Prisma.JsonValue | null): AdjustmentBatchDto[] {
  return Array.isArray(value) ? (value as unknown as AdjustmentBatchDto[]) : [];
}

/** Is an approval request still open for this adjustment? */
async function hasLiveApprovalRequest(
  tx: TenantClient,
  organizationId: string,
  adjustmentId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "approval_requests"
    WHERE "organization_id" = ${organizationId}::uuid
      AND "record_id" = ${adjustmentId}
      AND "status" IN ('PENDING', 'IN_PROGRESS')
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * The adjustment, if it may still be changed.
 *
 * `pending_approval` normally may not — somebody is deciding on exactly what is
 * there. But the engine does not tell the record when a request is withdrawn, so
 * "pending with no live request" is nobody's to decide and is treated as a draft.
 */
async function loadEditable(tx: TenantClient, organizationId: string, id: string) {
  const existing = await tx.stockAdjustment.findFirst({
    where: { id, organizationId, isDeleted: false },
    select: { id: true, status: true, adjustmentNumber: true },
  });
  if (!existing) throw ApiError.notFound('Stock adjustment not found.');
  if (EDITABLE_STATUSES.includes(existing.status)) return existing;
  if (existing.status === 'pending_approval') {
    if (!(await hasLiveApprovalRequest(tx, organizationId, id))) return existing;
    throw ApiError.conflict(
      `${existing.adjustmentNumber} is waiting for approval and cannot be changed until that is decided.`,
    );
  }
  throw ApiError.conflict(
    existing.status === 'cancelled'
      ? `${existing.adjustmentNumber} is cancelled.`
      : `${existing.adjustmentNumber} has already adjusted the stock. Cancel it and enter a new one instead.`,
  );
}

/**
 * Validate what a draft must already get right, and write the header and lines.
 * Posts nothing.
 */
async function writeDocument(
  tx: TenantClient,
  organizationId: string,
  userId: string | null,
  data: SaveAdjustmentDto,
  existingId?: string,
): Promise<string> {
  const location = await tx.location.findFirst({
    where: { id: data.locationId, organizationId, isDeleted: false },
    select: { id: true, type: true },
  });
  if (!location) throw ApiError.notFound('Location not found.');
  if (REFUSED_LOCATION_TYPES.includes(location.type)) {
    throw ApiError.badRequest('Stock can only be adjusted at your own locations.', {
      locationId: 'Select one of your own locations.',
    });
  }

  const adjustmentDate = new Date(data.adjustmentDate);
  if (Number.isNaN(adjustmentDate.getTime())) {
    throw ApiError.badRequest('Enter a valid date.', { adjustmentDate: 'Enter a valid date.' });
  }
  await assertOnOrAfterMigration(tx, {
    organizationId,
    date: adjustmentDate,
    field: 'adjustmentDate',
    label: 'stock adjustment',
  });

  // One read for every item on the document.
  const itemIds = data.lines.map((line) => line.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw ApiError.badRequest('The same item is on this adjustment twice.', {
      lines: 'Each item can appear once — combine the quantities.',
    });
  }
  const items = await tx.item.findMany({
    where: { id: { in: itemIds }, organizationId, isDeleted: false },
    select: { id: true, name: true, itemType: true, trackInventory: true },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const line of data.lines) {
    const item = itemById.get(line.itemId);
    if (!item) throw ApiError.notFound('Item not found.');
    if (item.itemType === 'service' || !item.trackInventory) {
      throw ApiError.badRequest(
        `${item.name} does not keep stock, so there is nothing to adjust.`,
        { lines: `${item.name} does not keep stock.` },
      );
    }
  }

  const header = {
    adjustmentDate,
    locationId: location.id,
    reason: data.reason,
    referenceNumber: data.referenceNumber || null,
    description: data.description || null,
    // An edit is a different document from the one that was approved or rejected.
    status: 'draft',
    updatedBy: userId,
  };

  let adjustmentId: string;
  if (existingId) {
    await tx.stockAdjustment.updateMany({
      where: { id: existingId, organizationId },
      data: header,
    });
    // The old lines are replaced wholesale: an unposted line owns no batch or
    // ledger row, so there is nothing under it to reconcile.
    await tx.stockAdjustmentLine.updateMany({
      where: { adjustmentId: existingId, organizationId, isDeleted: false },
      data: { isDeleted: true, updatedBy: userId },
    });
    adjustmentId = existingId;
  } else {
    const adjustmentNumber = await allocateNumber(tx, organizationId, 'stock_adjustment');
    const created = await withUniqueViolation(
      'Adjustment number already exists in this organization.',
      () =>
        tx.stockAdjustment.create({
          data: { ...header, organizationId, adjustmentNumber, createdBy: userId },
          select: { id: true },
        }),
    );
    adjustmentId = created.id;
  }

  await tx.stockAdjustmentLine.createMany({
    data: data.lines.map((line: AdjustmentLineDto, seq) => ({
      organizationId,
      adjustmentId,
      seq,
      itemId: line.itemId,
      quantityAdjusted: decimal(line.quantityAdjusted),
      costPrice:
        line.quantityAdjusted > 0 && line.costPrice !== null && line.costPrice !== undefined
          ? decimal(line.costPrice)
          : null,
      draftBatches: (line.batches ?? []) as unknown as Prisma.InputJsonValue,
      createdBy: userId,
      updatedBy: userId,
    })),
  });
  return adjustmentId;
}

/** The header and its live lines, in the shape posting works on. */
async function loadForPosting(tx: TenantClient, organizationId: string, id: string) {
  const adjustment = await tx.stockAdjustment.findFirst({
    where: { id, organizationId, isDeleted: false },
    select: {
      id: true,
      status: true,
      adjustmentNumber: true,
      adjustmentDate: true,
      locationId: true,
      reason: true,
      referenceNumber: true,
      description: true,
      createdBy: true,
      lines: {
        where: { isDeleted: false },
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          quantityAdjusted: true,
          costPrice: true,
          draftBatches: true,
          item: {
            select: {
              id: true,
              name: true,
              itemType: true,
              trackInventory: true,
              inventoryTracking: true,
            },
          },
        },
      },
    },
  });
  if (!adjustment) throw ApiError.notFound('Stock adjustment not found.');
  const lines: PostableLine[] = adjustment.lines.map((line) => ({
    id: line.id,
    item: line.item,
    quantityAdjusted: line.quantityAdjusted,
    costPrice: line.costPrice,
    // An untracked item's batches are plumbing the user never names.
    batches: isTracked(line.item) ? draftBatchesOf(line.draftBatches) : [],
  }));
  return { adjustment, lines };
}

/**
 * 🔴 POST EVERY LINE, in the caller's transaction — all of it or none of it.
 *
 * `from` is which statuses may post, and the first statement is a
 * compare-and-swap on it: two Adjust clicks, or an approval landing while
 * somebody else posts, cannot both get past it.
 */
async function postAdjustment(
  tx: TenantClient,
  organizationId: string,
  id: string,
  userId: string | null,
  from: readonly string[],
): Promise<void> {
  const claimed = await tx.stockAdjustment.updateMany({
    where: { id, organizationId, isDeleted: false, status: { in: [...from] } },
    data: { status: 'adjusted', updatedBy: userId },
  });
  if (claimed.count !== 1) {
    throw ApiError.conflict('This adjustment has already been adjusted or changed. Refresh it.');
  }

  const { adjustment, lines } = await loadForPosting(tx, organizationId, id);
  if (lines.length === 0) throw ApiError.badRequest('This adjustment has no items.');
  for (const line of lines) assertLineComplete(line);

  // The live balances, never the form's figures — stock may have moved since the
  // document was written. One grouped read for every item on it.
  const balances = await tx.stockLedgerEntry.groupBy({
    by: ['itemId'],
    where: {
      organizationId,
      itemId: { in: lines.map((line) => line.item.id) },
      locationId: adjustment.locationId,
      ownership: 'own',
      stockEffect: { in: ['accounting', 'both'] },
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const balanceOf = new Map(
    balances.map((row) => [row.itemId, (row._sum.qtyIn ?? ZERO).minus(row._sum.qtyOut ?? ZERO)]),
  );

  const decreases = lines.filter((line) => line.quantityAdjusted.lessThan(0));
  for (const line of decreases) {
    const here = balanceOf.get(line.item.id) ?? ZERO;
    if (line.quantityAdjusted.abs().greaterThan(here)) {
      throw ApiError.badRequest(
        `${line.item.name} has ${here.toString()} at this location, so ` +
          `${line.quantityAdjusted.abs().toString()} cannot be removed.`,
        { lines: `${line.item.name}: only ${here.toString()} is available here.` },
      );
    }
  }

  // Which batches every decrease comes out of — picked, or oldest first — in one
  // availability read for the whole document.
  const allocations = await allocateOutward(tx, {
    organizationId,
    locationId: adjustment.locationId,
    ownership: 'own',
    taking: 'removed',
    detailKey: 'lines',
    requests: decreases.map((line) => ({
      itemId: line.item.id,
      name: line.item.name,
      required: line.quantityAdjusted.abs(),
      picks: line.batches.map((row) => ({
        batchId: row.batchId!,
        batchUnitId: row.batchUnitId,
        qty: row.quantity,
      })),
    })),
  });

  const named = await resolveBatchesForPosting(tx, organizationId, [
    ...lines.flatMap((line) => line.batches.flatMap((row) => (row.batchId ? [row.batchId] : []))),
    ...allocations.map((row) => row.batchId),
  ]);

  let total = ZERO;
  for (const line of lines) {
    const ctx: PostContext = {
      organizationId,
      userId,
      adjustmentId: id,
      lineId: line.id,
      locationId: adjustment.locationId,
      postedAt: adjustment.adjustmentDate,
    };
    const magnitude = line.quantityAdjusted.abs();
    let value = ZERO;

    if (line.quantityAdjusted.greaterThan(0)) {
      const lineValue = magnitude.times(line.costPrice!).toDecimalPlaces(4);
      if (isTracked(line.item)) {
        const shares = splitByQty(
          lineValue,
          line.batches.map((row) => decimal(row.quantity)),
        );
        for (const [index, batch] of line.batches.entries()) {
          value = value.plus(
            await receiveBatch(tx, ctx, {
              itemId: line.item.id,
              value: shares[index] ?? ZERO,
              batch,
              existing: named,
            }),
          );
        }
      } else {
        // Never shown to the user — one silent batch, as a bill makes.
        const batch = await createBatch(tx, {
          organizationId,
          itemId: line.item.id,
          sourceDocType: ADJUSTMENT_DOC_TYPE,
          sourceDocId: id,
          userId,
        });
        const entry = await postRow(
          tx,
          ctx,
          { batchId: batch.id, batchUnitId: null, qty: magnitude, valueIn: lineValue },
          asResolvedBatch(batch),
        );
        value = entry.valueIn;
      }
    } else {
      const request = decreases.indexOf(line);
      for (const allocation of allocations.filter((row) => row.requestIndex === request)) {
        const entry = await postRow(
          tx,
          ctx,
          { batchId: allocation.batchId, batchUnitId: allocation.batchUnitId, qty: allocation.qty },
          named,
        );
        // Read off the row WRITTEN — `postMovement` decides what stock leaving costs.
        value = value.plus(entry.valueOut);
      }
    }

    await tx.stockAdjustmentLine.updateMany({
      where: { id: line.id, organizationId },
      data: {
        quantityBefore: balanceOf.get(line.item.id) ?? ZERO,
        value,
        // The real rows exist now; the form's copy has done its job.
        draftBatches: Prisma.DbNull,
        updatedBy: userId,
      },
    });
    total = total.plus(value);
  }

  await tx.stockAdjustment.updateMany({ where: { id, organizationId }, data: { value: total } });
}

/**
 * 🔴 ADJUST — post now, or wait for approval.
 *
 * The approval engine is asked FIRST and its answer is awaited, because here the
 * approval is a gate: every other module calls it fire-and-forget after saving,
 * and swallows its errors, which would let an adjustment post unapproved the
 * moment the engine hiccupped. An error here fails the Adjust instead.
 */
async function adjust(organizationId: string, id: string, userId: string | null): Promise<void> {
  const state = await runAsTenant(organizationId, async (tx) => {
    const editable = await loadEditable(tx, organizationId, id);
    const { adjustment, lines } = await loadForPosting(tx, organizationId, id);
    if (lines.length === 0) throw ApiError.badRequest('Add at least one item.');
    for (const line of lines) assertLineComplete(line);
    return { status: editable.status, adjustment, lineCount: lines.length };
  });

  // Already approved — its posting failed last time. No second approval.
  if (state.status !== 'approved') {
    await ensureApprovalTables();
    const { adjustment } = state;
    const outcome = await approvalExecutionService.evaluateAndTriggerApproval(
      organizationId,
      ADJUSTMENT_APPROVAL_MODULE,
      id,
      `Stock Adjustment #${adjustment.adjustmentNumber}`,
      'CREATE',
      {
        id,
        adjustmentNumber: adjustment.adjustmentNumber,
        adjustmentDate: adjustment.adjustmentDate,
        locationId: adjustment.locationId,
        reason: adjustment.reason,
        referenceNumber: adjustment.referenceNumber,
        description: adjustment.description,
        status: state.status,
        createdBy: adjustment.createdBy,
        lineCount: state.lineCount,
      },
      userId ?? undefined,
    );
    if (outcome.triggered || outcome.requestId) {
      // The engine's own status write is best-effort; the gate must not be.
      await runAsTenant(organizationId, (tx) =>
        tx.stockAdjustment.updateMany({
          where: { id, organizationId, status: { in: ['draft', 'rejected'] } },
          data: { status: 'pending_approval', updatedBy: userId },
        }),
      );
      return;
    }
  }

  await runAsDocument(organizationId, (tx) =>
    postAdjustment(tx, organizationId, id, userId, [...EDITABLE_STATUSES, 'pending_approval']),
  );
}

/**
 * What each approval outcome does to an adjustment — registered with the engine
 * in place of its raw status write (approvalOutcome.registry.ts).
 */
registerApprovalOutcomeHandler(ADJUSTMENT_APPROVAL_MODULE, async (outcome) => {
  const { organizationId, recordId: id } = outcome;
  const move = (from: readonly string[], to: string) =>
    runAsTenant(organizationId, (tx) =>
      tx.stockAdjustment.updateMany({
        where: { id, organizationId, isDeleted: false, status: { in: [...from] } },
        data: { status: to },
      }),
    );

  if (outcome.status === 'Pending Approval') {
    await move(['draft', 'rejected'], 'pending_approval');
    return;
  }
  if (outcome.status === 'Rejected') {
    await move(['pending_approval'], 'rejected');
    return;
  }
  if (outcome.status !== 'Approved') return;

  // Only something that was WAITING posts on approval. The engine also says
  // "Approved" for a process admin's own record, before any request exists —
  // that one is still a draft here, and `adjust` posts it itself.
  const approved = await move(['pending_approval'], 'approved');
  if (approved.count !== 1) return;

  const requester = await runAsTenant(organizationId, (tx) =>
    tx.stockAdjustment.findFirst({ where: { id, organizationId }, select: { createdBy: true } }),
  );
  try {
    await runAsDocument(organizationId, (tx) =>
      postAdjustment(tx, organizationId, id, requester?.createdBy ?? null, ['approved']),
    );
  } catch (error) {
    // Left as `approved`: the approval stands, and pressing Adjust shows the
    // person why it could not post (usually the stock is no longer there).
    console.error(`[stock-adjustment] ${id} was approved but could not post:`, error);
  }
});

/** Reverse every row a posted adjustment wrote, and leave it listed as cancelled. */
async function cancelPosted(
  tx: TenantClient,
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<void> {
  const existing = await tx.stockAdjustment.findFirst({
    where: { id, organizationId, isDeleted: false },
    select: {
      locationId: true,
      lines: {
        where: { isDeleted: false },
        select: {
          quantityAdjusted: true,
          item: { select: { name: true } },
          batches: {
            where: { isDeleted: false },
            select: {
              batchId: true,
              batchUnitId: true,
              qty: true,
              batch: { select: { supplierBatchRef: true } },
            },
          },
        },
      },
    },
  });
  if (!existing) throw ApiError.notFound('Stock adjustment not found.');

  /**
   * 🔴 CANCELLING AN INCREASE TAKES THE STOCK BACK, so it must still be where
   * this document put it. `reverseMovement` refuses once the COST has been
   * drawn on, but FIFO costs by item, not by batch: the batch can be
   * physically gone while its layer is untouched because older layers paid
   * for the issue. Nothing below would stop that going negative.
   *
   * One grouped read for every batch on the document.
   */
  const added = existing.lines.filter((line) => line.quantityAdjusted.greaterThan(0));
  const onHand = await getBalancesByBatchUnit(tx, {
    organizationId,
    batchIds: [...new Set(added.flatMap((line) => line.batches.map((row) => row.batchId)))],
    locationId: existing.locationId,
  });
  for (const line of added) {
    for (const row of line.batches) {
      const here = onHand.get(row.batchId)?.get(row.batchUnitId) ?? ZERO;
      if (row.qty.greaterThan(here)) {
        const label = row.batch.supplierBatchRef || line.item.name;
        throw ApiError.conflict(
          `${label} has only ${here.toString()} left of the ${row.qty.toString()} this ` +
            'adjustment added, so it cannot be cancelled. Reverse the document that used it first.',
        );
      }
    }
  }

  const posted = await tx.stockLedgerEntry.findMany({
    where: {
      organizationId,
      sourceDocType: ADJUSTMENT_DOC_TYPE,
      sourceDocId: id,
      movementType: { not: 'reversal' },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, batchId: true, sourceDocLineId: true },
  });
  const batches = await resolveBatchesForPosting(
    tx,
    organizationId,
    posted.map((row) => row.batchId),
  );
  const now = new Date();
  for (const row of posted) {
    await reverseMovement(
      tx,
      organizationId,
      row.id,
      {
        sourceDocType: ADJUSTMENT_DOC_TYPE,
        sourceDocId: id,
        sourceDocLineId: row.sourceDocLineId,
        remarks: 'Cancelled.',
        postedAt: now,
        userId,
      },
      batches,
    );
  }

  await tx.stockAdjustment.updateMany({
    where: { id, organizationId },
    data: { status: 'cancelled', updatedBy: userId },
  });
}

/** The detail, plus what the batches a draft names are CALLED — a draft stores
 * ids, and an id is not something a person can read. */
async function readDetail(tx: TenantClient, organizationId: string, id: string) {
  const adjustment = await tx.stockAdjustment.findFirst({
    where: { id, organizationId, isDeleted: false },
    include: DETAIL_INCLUDE,
  });
  if (!adjustment) throw ApiError.notFound('Stock adjustment not found.');

  const drafts = adjustment.lines.flatMap((line) => draftBatchesOf(line.draftBatches));
  const batchIds = [...new Set(drafts.flatMap((row) => (row.batchId ? [row.batchId] : [])))];
  const unitIds = [
    ...new Set(
      drafts.flatMap((row) => [
        ...(row.batchUnitId ? [row.batchUnitId] : []),
        ...(row.units ?? []).flatMap((unit) => (unit.batchUnitId ? [unit.batchUnitId] : [])),
      ]),
    ),
  ];
  const batches = batchIds.length
    ? await tx.batch.findMany({
        where: { id: { in: batchIds }, organizationId },
        select: { id: true, supplierBatchRef: true },
      })
    : [];
  const units = unitIds.length
    ? await tx.batchUnit.findMany({
        where: { id: { in: unitIds }, organizationId },
        select: { id: true, label: true },
      })
    : [];

  return {
    ...adjustment,
    draftLabels: {
      batches: Object.fromEntries(batches.map((row) => [row.id, row.supplierBatchRef ?? ''])),
      units: Object.fromEntries(units.map((row) => [row.id, row.label])),
    },
  };
}

export const adjustmentsService = {
  listWhere: (
    organizationId: string,
    opts: AdjustmentListQuery,
  ): Prisma.StockAdjustmentWhereInput => ({
    organizationId,
    isDeleted: false,
    ...(opts.itemId ? { lines: { some: { itemId: opts.itemId, isDeleted: false } } } : {}),
    ...searchWhere<Prisma.StockAdjustmentWhereInput>(opts.search, [
      'adjustmentNumber',
      'referenceNumber',
    ]),
  }),

  findManyAdjustments: (orgId: string, opts: AdjustmentListQuery) =>
    runAsTenant(orgId, async (tx) => {
      const records = await tx.stockAdjustment.findMany({
        where: adjustmentsService.listWhere(orgId, opts),
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.perPage,
        take: takeForPage(opts.perPage),
        include: {
          location: { select: { id: true, name: true } },
          lines: {
            where: { isDeleted: false },
            orderBy: { seq: 'asc' },
            select: {
              id: true,
              itemId: true,
              quantityAdjusted: true,
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });
      return pageSlice(records, opts.page, opts.perPage);
    }),

  countAdjustments: (orgId: string, opts: AdjustmentListQuery) =>
    runAsTenant(orgId, (tx) =>
      tx.stockAdjustment.count({ where: adjustmentsService.listWhere(orgId, opts) }),
    ),

  getAdjustment: (orgId: string, id: string) =>
    runAsTenant(orgId, (tx) => readDetail(tx, orgId, id)),

  /** Create, as a draft or adjusted in the same request. */
  createAdjustment: async (orgId: string, userId: string | null, data: SaveAdjustmentDto) => {
    const id = await runAsDocument(orgId, (tx) => writeDocument(tx, orgId, userId, data));
    if (data.saveAs === 'adjust') {
      try {
        await adjust(orgId, id, userId);
      } catch (error) {
        // The caller asked for an adjustment and got a refusal. Leaving the
        // document behind as a draft would give them a second one on retry.
        await runAsTenant(orgId, async (tx) => {
          await tx.stockAdjustmentLine.updateMany({
            where: { adjustmentId: id, organizationId: orgId },
            data: { isDeleted: true },
          });
          await tx.stockAdjustment.updateMany({
            where: { id, organizationId: orgId },
            data: { isDeleted: true },
          });
        });
        throw error;
      }
    }
    return adjustmentsService.getAdjustment(orgId, id);
  },

  /** Replace an adjustment that has not posted. It goes back to being a draft. */
  updateAdjustment: async (
    orgId: string,
    id: string,
    userId: string | null,
    data: SaveAdjustmentDto,
  ) => {
    await runAsDocument(orgId, async (tx) => {
      await loadEditable(tx, orgId, id);
      await writeDocument(tx, orgId, userId, data, id);
    });
    if (data.saveAs === 'adjust') await adjust(orgId, id, userId);
    return adjustmentsService.getAdjustment(orgId, id);
  },

  /** Adjust an unposted adjustment as it stands. */
  adjustAdjustment: async (orgId: string, id: string, userId: string | null) => {
    await adjust(orgId, id, userId);
    return adjustmentsService.getAdjustment(orgId, id);
  },

  /**
   * Cancel a posted adjustment (its rows are reversed and it stays listed), or
   * throw away one that never posted.
   */
  removeAdjustment: (orgId: string, id: string, userId: string | null) =>
    runAsDocument(orgId, async (tx) => {
      const existing = await tx.stockAdjustment.findFirst({
        where: { id, organizationId: orgId, isDeleted: false },
        select: { status: true },
      });
      if (!existing) throw ApiError.notFound('Stock adjustment not found.');
      if (existing.status === 'cancelled') {
        throw ApiError.conflict('This adjustment is already cancelled.');
      }

      if (existing.status === 'adjusted') {
        await cancelPosted(tx, orgId, id, userId);
        return { ...(await readDetail(tx, orgId, id)), deleted: false };
      }

      await loadEditable(tx, orgId, id);
      const detail = await readDetail(tx, orgId, id);
      await tx.stockAdjustmentLine.updateMany({
        where: { adjustmentId: id, organizationId: orgId },
        data: { isDeleted: true, updatedBy: userId },
      });
      await tx.stockAdjustment.updateMany({
        where: { id, organizationId: orgId },
        data: { isDeleted: true, updatedBy: userId },
      });
      return { ...detail, deleted: true };
    }),
};
