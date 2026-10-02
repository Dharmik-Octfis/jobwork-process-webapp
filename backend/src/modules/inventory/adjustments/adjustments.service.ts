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
  getBalance,
  getBalancesByBatchUnit,
  postMovement,
  resolveBatchesForPosting,
  resolveExistingBatchUnits,
  reverseMovement,
  type ResolvedBatches,
} from '../stock-ledger/stockLedger.service.js';
import { allocateOutward } from '../stock-ledger/allocateOutward.js';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type { AdjustmentBatchDto, CreateAdjustmentDto } from './adjustments.schemas.js';

/**
 * Stock adjustment — docs/STOCK_ADJUSTMENT_PLAN.md. Quantity only.
 *
 * One item, one location, one direction. An increase posts inward `adjustment`
 * rows at the cost the user states; a decrease posts outward ones and FIFO
 * decides what they cost. Never edited: cancel reverses the rows.
 */

/** Already the FIFO cost-lot report's key for these rows. */
const ADJUSTMENT_DOC_TYPE = 'inventory_adjustment';

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

interface PostContext {
  organizationId: string;
  userId: string | null;
  adjustmentId: string;
  locationId: string;
  postedAt: Date;
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
    /** The batches the payload named, read once for the whole document. */
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
        batches: 'Pick a batch of this item.',
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
      { batches: `${label}: its units must account for the whole quantity, or name none at all.` },
    );
  }

  const newUnits = units.filter((unit) => !unit.batchUnitId);
  const topUps = units.filter((unit) => unit.batchUnitId);
  if (topUps.length && !batch.batchId) {
    throw ApiError.badRequest('A batch being created has no existing units to add to.', {
      batches: 'Pick an existing batch before adding to one of its units.',
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

const DETAIL_INCLUDE = {
  item: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  location: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, fullName: true } },
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
} as const satisfies Prisma.StockAdjustmentInclude;

/** The shared list query, plus one item — the item page's Transactions tab. */
export type AdjustmentListQuery = ListQuery & { itemId?: string };

export const adjustmentsService = {
  listWhere: (
    organizationId: string,
    opts: AdjustmentListQuery,
  ): Prisma.StockAdjustmentWhereInput => ({
    organizationId,
    isDeleted: false,
    ...(opts.itemId ? { itemId: opts.itemId } : {}),
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
          item: { select: { id: true, name: true, sku: true } },
          location: { select: { id: true, name: true } },
        },
      });
      return pageSlice(records, opts.page, opts.perPage);
    }),

  countAdjustments: (orgId: string, opts: AdjustmentListQuery) =>
    runAsTenant(orgId, (tx) =>
      tx.stockAdjustment.count({ where: adjustmentsService.listWhere(orgId, opts) }),
    ),

  getAdjustment: (orgId: string, id: string) =>
    runAsTenant(orgId, async (tx) => {
      const adjustment = await tx.stockAdjustment.findFirst({
        where: { id, organizationId: orgId, isDeleted: false },
        include: DETAIL_INCLUDE,
      });
      if (!adjustment) throw ApiError.notFound('Stock adjustment not found.');
      return adjustment;
    }),

  createAdjustment: (orgId: string, userId: string | null, data: CreateAdjustmentDto) =>
    runAsDocument(orgId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: data.itemId, organizationId: orgId, isDeleted: false },
        select: {
          id: true,
          name: true,
          itemType: true,
          trackInventory: true,
          inventoryTracking: true,
        },
      });
      if (!item) throw ApiError.notFound('Item not found.');
      if (item.itemType === 'service' || !item.trackInventory) {
        throw ApiError.badRequest(
          `${item.name} does not keep stock, so there is nothing to adjust.`,
        );
      }

      const location = await tx.location.findFirst({
        where: { id: data.locationId, organizationId: orgId, isDeleted: false },
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
        organizationId: orgId,
        date: adjustmentDate,
        field: 'adjustmentDate',
        label: 'stock adjustment',
      });

      const quantityAdjusted = decimal(data.quantityAdjusted);
      if (quantityAdjusted.isZero()) {
        throw ApiError.badRequest('Enter a quantity to adjust.', {
          quantityAdjusted: 'Enter a quantity to adjust.',
        });
      }
      const increase = quantityAdjusted.greaterThan(0);
      const magnitude = quantityAdjusted.abs();
      const tracked = item.inventoryTracking !== 'none';
      const rows = tracked ? (data.batches ?? []) : [];

      if (tracked) {
        if (rows.length === 0) {
          throw ApiError.badRequest(
            `${item.name} is batch-tracked, so the batches must be named.`,
            {
              batches: increase ? 'Add the batches.' : 'Select the batches.',
            },
          );
        }
        const total = rows.reduce((sum, row) => sum.plus(row.quantity), ZERO);
        if (total.minus(magnitude).abs().greaterThan(QTY_EPSILON)) {
          throw ApiError.badRequest(
            `The batches add up to ${total.toString()}, but ${magnitude.toString()} is being adjusted.`,
            { batches: `Batches must add up to ${magnitude.toString()}.` },
          );
        }
      }

      const costPrice = increase ? data.costPrice : null;
      if (increase && (costPrice === null || costPrice === undefined)) {
        throw ApiError.badRequest('Stock being added needs a cost price.', {
          costPrice: 'Enter the cost price.',
        });
      }

      // The live balance, never the form's figure — stock may have moved since
      // the form opened.
      const before = await getBalance(tx, {
        organizationId: orgId,
        itemId: item.id,
        locationId: location.id,
        ownership: 'own',
      });
      if (!increase && magnitude.greaterThan(before.qty)) {
        throw ApiError.badRequest(
          `${item.name} has ${before.qty.toString()} at this location, so ` +
            `${magnitude.toString()} cannot be removed.`,
          { quantityAdjusted: `Only ${before.qty.toString()} is available here.` },
        );
      }

      const adjustmentNumber = await allocateNumber(tx, orgId, 'stock_adjustment');
      // The header first: every batch, package and ledger row below names it.
      const header = await withUniqueViolation(
        'Adjustment number already exists in this organization.',
        () =>
          tx.stockAdjustment.create({
            data: {
              organizationId: orgId,
              adjustmentNumber,
              adjustmentDate,
              itemId: item.id,
              locationId: location.id,
              quantityAdjusted,
              quantityBefore: before.qty,
              costPrice: increase ? decimal(costPrice!) : null,
              reason: data.reason,
              referenceNumber: data.referenceNumber || null,
              description: data.description || null,
              createdBy: userId,
              updatedBy: userId,
            },
            select: { id: true },
          }),
      );

      const ctx: PostContext = {
        organizationId: orgId,
        userId,
        adjustmentId: header.id,
        locationId: location.id,
        postedAt: adjustmentDate,
      };

      let value = ZERO;
      if (increase) {
        const totalValue = magnitude.times(decimal(costPrice!)).toDecimalPlaces(4);
        if (tracked) {
          const existing = await resolveBatchesForPosting(
            tx,
            orgId,
            rows.flatMap((row) => (row.batchId ? [row.batchId] : [])),
          );
          const shares = splitByQty(
            totalValue,
            rows.map((row) => decimal(row.quantity)),
          );
          for (const [index, batch] of rows.entries()) {
            value = value.plus(
              await receiveBatch(tx, ctx, {
                itemId: item.id,
                value: shares[index] ?? ZERO,
                batch,
                existing,
              }),
            );
          }
        } else {
          // Never shown to the user — one silent batch, as a bill makes.
          const batch = await createBatch(tx, {
            organizationId: orgId,
            itemId: item.id,
            sourceDocType: ADJUSTMENT_DOC_TYPE,
            sourceDocId: header.id,
            userId,
          });
          const entry = await postRow(
            tx,
            ctx,
            { batchId: batch.id, batchUnitId: null, qty: magnitude, valueIn: totalValue },
            asResolvedBatch(batch),
          );
          value = entry.valueIn;
        }
      } else {
        const allocations = await allocateOutward(tx, {
          organizationId: orgId,
          locationId: location.id,
          ownership: 'own',
          taking: 'removed',
          detailKey: 'batches',
          requests: [
            {
              itemId: item.id,
              name: item.name,
              required: magnitude,
              picks: rows.map((row) => {
                if (!row.batchId) {
                  throw ApiError.badRequest('Select the batch each quantity comes out of.', {
                    batches: 'Select a batch on every row.',
                  });
                }
                return { batchId: row.batchId, batchUnitId: row.batchUnitId, qty: row.quantity };
              }),
            },
          ],
        });
        const batches = await resolveBatchesForPosting(
          tx,
          orgId,
          allocations.map((row) => row.batchId),
        );
        for (const allocation of allocations) {
          const entry = await postRow(
            tx,
            ctx,
            {
              batchId: allocation.batchId,
              batchUnitId: allocation.batchUnitId,
              qty: allocation.qty,
            },
            batches,
          );
          // Read off the row WRITTEN — `postMovement` decides what stock leaving costs.
          value = value.plus(entry.valueOut);
        }
      }

      return tx.stockAdjustment.update({
        where: { id: header.id },
        data: { value },
        include: DETAIL_INCLUDE,
      });
    }),

  /**
   * Cancel: every row this document posted gets its opposite, and the document
   * stays listed as `cancelled`.
   */
  cancelAdjustment: (orgId: string, id: string, userId: string | null) =>
    runAsDocument(orgId, async (tx) => {
      const existing = await tx.stockAdjustment.findFirst({
        where: { id, organizationId: orgId, isDeleted: false },
        include: {
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
      });
      if (!existing) throw ApiError.notFound('Stock adjustment not found.');
      if (existing.status === 'cancelled') {
        throw ApiError.conflict('This adjustment is already cancelled.');
      }

      /**
       * 🔴 CANCELLING AN INCREASE TAKES THE STOCK BACK, so it must still be where
       * this document put it. `reverseMovement` refuses once the COST has been
       * drawn on, but FIFO costs by item, not by batch: the batch can be
       * physically gone while its layer is untouched because older layers paid
       * for the issue. Nothing below would stop that going negative.
       *
       * One grouped read for every batch on the document.
       */
      if (existing.quantityAdjusted.greaterThan(0)) {
        const onHand = await getBalancesByBatchUnit(tx, {
          organizationId: orgId,
          batchIds: [...new Set(existing.batches.map((row) => row.batchId))],
          locationId: existing.locationId,
        });
        for (const row of existing.batches) {
          const here = onHand.get(row.batchId)?.get(row.batchUnitId) ?? ZERO;
          if (row.qty.greaterThan(here)) {
            const label = row.batch.supplierBatchRef || existing.item.name;
            throw ApiError.conflict(
              `${label} has only ${here.toString()} left of the ${row.qty.toString()} this ` +
                'adjustment added, so it cannot be cancelled. Reverse the document that used it first.',
            );
          }
        }
      }

      const posted = await tx.stockLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          sourceDocType: ADJUSTMENT_DOC_TYPE,
          sourceDocId: id,
          movementType: { not: 'reversal' },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, batchId: true, sourceDocLineId: true },
      });
      const batches = await resolveBatchesForPosting(
        tx,
        orgId,
        posted.map((row) => row.batchId),
      );
      const now = new Date();
      for (const row of posted) {
        await reverseMovement(
          tx,
          orgId,
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

      return tx.stockAdjustment.update({
        where: { id },
        data: { status: 'cancelled', updatedBy: userId },
        include: DETAIL_INCLUDE,
      });
    }),
};
