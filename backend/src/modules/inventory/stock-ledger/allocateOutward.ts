import type { TenantClient } from '../../../db/prisma.js';
import { ApiError } from '../../../lib/apiError.js';
import { Prisma } from '../../../../generated/prisma/client.ts';
import {
  getAvailableBatches,
  getAvailableBatchUnits,
  type Ownership,
} from './stockLedger.service.js';

/** The columns' own precision, so `3 × 33.3333` is not rejected for being a
 * billionth off — the same tolerance every quantity comparison here uses. */
const QTY_EPSILON = new Prisma.Decimal('0.00005');

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

/** One package of one batch, and what is left of it here. */
type AvailableUnit = Awaited<ReturnType<typeof getAvailableBatchUnits>>[number];

/** One quantity of one item that has to leave a location. */
export interface OutwardRequest {
  itemId: string;
  /** What the item is called in a refusal. */
  name: string;
  required: Prisma.Decimal;
  /** The batches the user picked. Empty or omitted means "oldest first". */
  picks?: readonly {
    batchId: string;
    batchUnitId?: string | null;
    qty: Prisma.Decimal | number | string;
  }[];
}

/** One request resolved to a real batch (and package), ready to be posted. */
export interface OutwardAllocation {
  /** Index into `requests` — one request usually yields several allocations. */
  requestIndex: number;
  itemId: string;
  uomId: string | null;
  batchId: string;
  /** Null is the batch's untagged remainder. */
  batchUnitId: string | null;
  qty: Prisma.Decimal;
}

/**
 * 🔴 WHICH BATCHES EACH QUANTITY ACTUALLY COMES OUT OF.
 *
 * Lifted out of `assemblies.service` on 2026-10-02 when stock adjustments needed
 * the same answer — a second copy of "which is oldest" is how two documents come
 * to disagree about it.
 *
 * Two paths, and which one a request takes is the CLIENT's answer, not a setting:
 *
 *   · the request NAMES batches — the picker was used. The picks must add up to
 *     what is required, exactly. The user chose batches, and the quantity is not
 *     theirs to disagree with; a mismatch means the form and the server are
 *     describing different documents.
 *   · the request names none — the server allocates FIFO out of what is at THIS
 *     location, oldest first. The same fallback job issues use for an item with
 *     no picker, and for the same reason: somebody has to choose, and
 *     oldest-first is the only defensible default.
 *
 * 🔴 ONE availability query for every request, never one per line. A twenty-row
 * recipe asked item by item is twenty round trips on the single connection this
 * transaction holds.
 *
 * A shortfall is REFUSED BY NAME and nothing is posted.
 */
export async function allocateOutward(
  tx: TenantClient,
  args: {
    organizationId: string;
    locationId: string;
    requests: readonly OutwardRequest[];
    /** Restrict to one ownership. Omitted, every batch here is on offer. */
    ownership?: Ownership;
    /** How a refusal describes what is happening to the stock. */
    taking?: string;
    /** The `details` key a refusal is filed under. */
    detailKey?: string;
  },
): Promise<OutwardAllocation[]> {
  const { organizationId, locationId, requests } = args;
  const taking = args.taking ?? 'consumed';
  const detailKey = args.detailKey ?? 'lines';
  if (requests.length === 0) return [];

  const available = await getAvailableBatches(tx, {
    organizationId,
    itemIds: [...new Set(requests.map((row) => row.itemId))],
    locationId,
    ...(args.ownership ? { ownership: args.ownership } : {}),
  });

  /**
   * 🔴 THE FIFO QUEUE, BUILT HERE — `getAvailableBatches` does NOT return rows in
   * age order and must not be assumed to.
   *
   * Its rows are driven by the balance `groupBy`, whose order is whatever
   * Postgres felt like; the `orderBy` on the batch read only decides which rows
   * survive a `limit`. Trusting it consumed the NEWEST stock first and passed
   * every test that did not check which batch moved.
   *
   * The key is the earliest INWARD ledger entry, not `batch.createdAt` — a
   * receipt entered on Friday for goods that arrived on Monday creates its batch
   * on Friday, and ordering by that queues genuinely older stock behind it, which
   * is the one thing FIFO exists to prevent. `createdAt` is the tie-break, for a
   * batch with no inward row yet. Same rule and same reasoning as
   * `jobIssues.resolveLines`, so both paths answer "which is oldest" identically.
   */
  const byBatchId = new Map(available.map((row) => [row.batchId, row]));
  const inward = await tx.stockLedgerEntry.groupBy({
    by: ['batchId'],
    where: {
      organizationId,
      batchId: { in: [...byBatchId.keys()] },
      qtyIn: { gt: 0 },
    },
    _min: { postedAt: true },
  });
  const firstInward = new Map(inward.map((row) => [row.batchId, row._min.postedAt]));

  /**
   * 🔴 THE PACKAGES INSIDE THOSE BATCHES, and what is UNTAGGED in each.
   *
   * Both figures are needed and they answer different questions. A named package
   * has its own ceiling; an allocation naming none may take only what no package
   * holds, or `postMovement`'s invariant refuses it deep inside the post — quoting
   * a rule the user never saw at a form that already accepted their entry.
   *
   * One grouped query for every batch on the document, never one per batch.
   */
  const unitsByBatch = new Map<string, Map<string, AvailableUnit>>();
  const taggedByBatch = new Map<string, Prisma.Decimal>();
  for (const unit of await getAvailableBatchUnits(tx, {
    organizationId,
    batchIds: [...byBatchId.keys()],
    locationId,
  })) {
    const forBatch = unitsByBatch.get(unit.batchId) ?? new Map<string, AvailableUnit>();
    forBatch.set(unit.batchUnitId, unit);
    unitsByBatch.set(unit.batchId, forBatch);
    taggedByBatch.set(
      unit.batchId,
      (taggedByBatch.get(unit.batchId) ?? decimal(0)).plus(unit.availableQty),
    );
  }

  const queueByItem = new Map<string, typeof available>();
  for (const row of available) {
    queueByItem.set(row.itemId, [...(queueByItem.get(row.itemId) ?? []), row]);
  }
  for (const queue of queueByItem.values()) {
    queue.sort(
      (a, b) =>
        (firstInward.get(a.batchId) ?? a.createdAt).getTime() -
        (firstInward.get(b.batchId) ?? b.createdAt).getTime(),
    );
  }

  /**
   * How much this document has already spoken for, per POOL — and a batch has one
   * pool per package plus one for its untagged remainder, because those cannot be
   * drawn from interchangeably.
   *
   * Two requests cannot both take the same 300 metres, and two requests for one
   * item draw on one queue.
   */
  const taken = new Map<string, Prisma.Decimal>();
  const poolKey = (batchId: string, batchUnitId: string | null) =>
    `${batchId}#${batchUnitId ?? ''}`;

  /** What one package still holds here, less what this document has taken. */
  const spareUnit = (batchId: string, batchUnitId: string) => {
    const unit = unitsByBatch.get(batchId)?.get(batchUnitId);
    return (unit?.availableQty ?? decimal(0)).minus(
      taken.get(poolKey(batchId, batchUnitId)) ?? decimal(0),
    );
  };

  /** 🔴 What may be taken from a batch WITHOUT naming a package: its balance less
   * everything its packages hold. Equal to the whole balance for a batch with
   * none, which is every batch in an org that never turned the level on. */
  const spareUntagged = (batchId: string) =>
    (byBatchId.get(batchId)?.availableQty ?? decimal(0))
      .minus(taggedByBatch.get(batchId) ?? decimal(0))
      .minus(taken.get(poolKey(batchId, null)) ?? decimal(0));

  const spare = (batchId: string, batchUnitId: string | null) =>
    batchUnitId ? spareUnit(batchId, batchUnitId) : spareUntagged(batchId);

  const take = (batchId: string, batchUnitId: string | null, qty: Prisma.Decimal) => {
    const key = poolKey(batchId, batchUnitId);
    taken.set(key, (taken.get(key) ?? decimal(0)).plus(qty));
  };

  const allocations: OutwardAllocation[] = [];

  for (const [requestIndex, row] of requests.entries()) {
    const picked = row.picks ?? [];

    if (picked.length > 0) {
      const total = picked.reduce((sum, one) => sum.plus(one.qty), decimal(0));
      if (total.minus(row.required).abs().greaterThan(QTY_EPSILON)) {
        throw ApiError.badRequest(
          `${row.name}: the batches picked add up to ${total.toString()}, but ` +
            `${row.required.toString()} is needed.`,
          { [detailKey]: `${row.name}: batches must add up to ${row.required.toString()}.` },
        );
      }

      for (const one of picked) {
        const batch = byBatchId.get(one.batchId);
        if (!batch || batch.itemId !== row.itemId) {
          throw ApiError.badRequest(
            `${row.name}: one of the batches picked has no stock here, or belongs to another item.`,
          );
        }
        const batchUnitId = one.batchUnitId ?? null;
        if (batchUnitId && !unitsByBatch.get(one.batchId)?.has(batchUnitId)) {
          throw ApiError.badRequest(
            `${row.name}: one of the units picked is not in that batch here, or none of it is left.`,
          );
        }
        const qty = decimal(one.qty);
        const free = spare(one.batchId, batchUnitId);
        if (qty.greaterThan(free)) {
          const what = batchUnitId
            ? (unitsByBatch.get(one.batchId)?.get(batchUnitId)?.label ?? 'That unit')
            : `Batch ${batch.supplierBatchRef ?? 'selected'}`;
          throw ApiError.badRequest(
            `${what} has ${free.toString()} available here, but ${qty.toString()} is being ${taking}.`,
          );
        }
        take(one.batchId, batchUnitId, qty);
        allocations.push({
          requestIndex,
          itemId: row.itemId,
          uomId: batch.uomId,
          batchId: one.batchId,
          batchUnitId,
          qty,
        });
      }
      continue;
    }

    /**
     * FIFO, and it has to be PACKAGE-AWARE.
     *
     * 🔴 A batch whose packages hold all of it has nothing untagged, so drawing
     * on the batch generally would be refused by `postMovement`'s invariant — the
     * packages would claim more than the batch holds. So each batch is drained
     * untagged-first and then package by package in `seq` order, which is the
     * only order a roll has.
     *
     * Untagged first because that material belongs to no roll: taking it leaves
     * every package intact, where taking a roll's material first would break one
     * open for no reason.
     */
    let remaining = row.required;
    for (const batch of queueByItem.get(row.itemId) ?? []) {
      if (remaining.lessThanOrEqualTo(0)) break;

      const pools: (string | null)[] = [
        null,
        ...[...(unitsByBatch.get(batch.batchId)?.values() ?? [])]
          .sort((a, b) => a.seq - b.seq)
          .map((unit) => unit.batchUnitId),
      ];

      for (const batchUnitId of pools) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const free = spare(batch.batchId, batchUnitId);
        if (free.lessThanOrEqualTo(0)) continue;
        const amount = remaining.lessThan(free) ? remaining : free;
        take(batch.batchId, batchUnitId, amount);
        allocations.push({
          requestIndex,
          itemId: row.itemId,
          uomId: batch.uomId,
          batchId: batch.batchId,
          batchUnitId,
          qty: amount,
        });
        remaining = remaining.minus(amount);
      }
    }

    if (remaining.greaterThan(0)) {
      const onHand = (queueByItem.get(row.itemId) ?? []).reduce(
        (sum, batch) => sum.plus(batch.availableQty),
        decimal(0),
      );
      throw ApiError.badRequest(
        `${row.name} has ${onHand.toString()} available at this location, but ` +
          `${row.required.toString()} is needed. Move the stock here, or add it first.`,
        { [detailKey]: `${row.name}: only ${onHand.toString()} available here.` },
      );
    }
  }

  return allocations;
}
