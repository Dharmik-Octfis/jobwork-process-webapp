import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  getAvailableBatches,
  getBalance,
  type Ownership,
} from '../stock-ledger/stockLedger.service.ts';

/**
 * Batches — READ ONLY, and that is the whole design.
 *
 * 🔴 There is no create, no update, no delete here and there must not be. A batch
 * is born in exactly one place, `stockLedger.service.ts.createBatch`, called by
 * the documents that physically bring material in (Material In today; Purchase
 * Received later). A batch someone typed into a form is a quantity that exists in
 * the system and nowhere on the floor.
 *
 * What this module exists for is the Issue dialog's picker, and one property of
 * that picker matters more than everything else in this file:
 *
 * 🔴 IT READS THE LEDGER, NOT THE `batches` TABLE. A batch row exists from the moment
 * it is created and goes on existing after the last metre of it has been issued.
 * "Does this batch exist" and "is there any of it here" are different questions,
 * and answering the second with the first is how a picker offers material that
 * has been at the dyer's for a fortnight (field-sources §10).
 */

const SEARCH_COLUMNS = ['batchNumber', 'supplierBatchRef'] as const;

function batchListWhere(organizationId: string, opts: ListQuery): Prisma.BatchWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.BatchWhereInput>('batch', opts.filter),
    ...searchWhere<Prisma.BatchWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

const BATCH_INCLUDE = {
  item: { select: { id: true, name: true, sku: true, inventoryTracking: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
} satisfies Prisma.BatchInclude;

export async function getBatchesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.batch.findMany({
      where: batchListWhere(organizationId, opts),
      // Oldest first — the same FIFO order the picker suggests, so a batch looked
      // up here sits where the picker put it.
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: BATCH_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countBatches(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.batch.count({ where: batchListWhere(organizationId, opts) }),
  );
}

/** One batch, with its packages and its DERIVED balance. */
export async function getBatchById(organizationId: string, id: string) {
  return runAsTenant(organizationId, async (tx) => {
    const batch = await tx.batch.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: BATCH_INCLUDE,
    });
    if (!batch) return null;

    const balance = await getBalance(tx, { organizationId, batchId: id });
    return {
      ...batch,
      availableQty: balance.qty.toString(),
      accumulatedValue: balance.value.toString(),
    };
  });
}

export interface AvailabilityQuery {
  itemId: string;
  locationId?: string;
  /**
   * 🔴 NOT OPTIONAL IN PRACTICE. The Issue dialog always passes the job order's
   * ownership, because without it one customer's goods can be issued into
   * another customer's job order — you would be processing A's material on B's
   * order and both stock reports would be wrong. Same class of failure as a
   * missing tenant filter (§5.2).
   */
  ownership?: Ownership;
  /** Include each batch's takas. Only worth asking for when the item is tracked
   * that way; otherwise it is a query per batch returning nothing. */
  withPackages?: boolean;
}

/**
 * What can actually be issued: the picker's grid.
 *
 * The picker shows the batch, what is left of it and what that is worth — nothing
 * else. Batch age and the supplier's own reference were dropped from this payload
 * on 2026-08-10: both were display-only columns nobody read off the dialog. If a
 * FIFO suggestion or the 180-day GST clock ever needs age, compute it HERE and
 * not on the client — the two must agree.
 */
export async function getAvailableStock(organizationId: string, query: AvailabilityQuery) {
  return runAsTenant(organizationId, async (tx) => {
    const batches = await getAvailableBatches(tx, {
      organizationId,
      itemId: query.itemId,
      locationId: query.locationId,
      ownership: query.ownership,
    });
    if (batches.length === 0) return [];

    const rows = await tx.batch.findMany({
      where: { id: { in: batches.map((l) => l.batchId) }, organizationId, isDeleted: false },
      select: { id: true, state: true, item: { select: { inventoryTracking: true } } },
    });
    const metaById = new Map(rows.map((r) => [r.id, r]));

    const out = [];
    for (const batch of batches) {
      const meta = metaById.get(batch.batchId);
      const balance = await getBalance(tx, {
        organizationId,
        batchId: batch.batchId,
        locationId: query.locationId,
      });

      out.push({
        batchId: batch.batchId,
        batchNumber: batch.batchNumber,
        itemId: batch.itemId,
        uomId: batch.uomId,
        ownership: batch.ownership,
        ownerPartyId: batch.ownerPartyId,
        availableQty: batch.availableQty.toString(),
        accumulatedValue: balance.value.toString(),
        // Cost per unit of what is LEFT, not of what was received. Derived every
        // time; there is no stored cost column (plan §3, decision 1).
        costPerUnit: batch.availableQty.greaterThan(0)
          ? balance.value.dividedBy(batch.availableQty).toDecimalPlaces(4).toString()
          : null,
        inventoryTracking: meta?.item.inventoryTracking ?? 'none',
      });
    }
    return out;
  });
}

/**
 * Which locations actually hold this item, with their balances.
 *
 * 🔴 A LEDGER QUERY, NOT A LOCATION LIST (§5.1). Offering every godown in the
 * org and letting the user discover which one has stock by picking wrong is how
 * people get stuck on this screen — and the one that does have it is usually the
 * only sensible answer, which is why the dialog auto-selects when there is one.
 */
export async function getSourceLocations(
  organizationId: string,
  query: { itemId: string; ownership?: Ownership },
) {
  return runAsTenant(organizationId, async (tx) => {
    const grouped = await tx.stockLedgerEntry.groupBy({
      by: ['locationId'],
      where: {
        organizationId,
        itemId: query.itemId,
        ...(query.ownership ? { ownership: query.ownership } : {}),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });

    const zero = new Prisma.Decimal(0);
    const positive = grouped
      .map((row) => ({
        locationId: row.locationId,
        qty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
      }))
      .filter((row) => row.qty.greaterThan(0));

    if (positive.length === 0) return [];

    const locations = await tx.location.findMany({
      where: {
        id: { in: positive.map((r) => r.locationId) },
        organizationId,
        isDeleted: false,
      },
      /**
       * 🔴 `vendorId` is returned so the caller can tell a PROCESSOR's location
       * apart from a godown.
       *
       * Goods at a processor are our stock at their location (§5.4), so a
       * processor's location legitimately shows up here the moment anything has
       * been sent there — and processor-to-processor really is a valid move, so
       * this query does not filter them out. What is never valid is issuing from
       * a location to the party who is already holding it, and the Issue dialog
       * uses this field to drop exactly that one option.
       */
      select: { id: true, name: true, type: true, vendorId: true },
    });
    const byId = new Map(locations.map((l) => [l.id, l]));

    return positive
      .flatMap((row) => {
        const location = byId.get(row.locationId);
        return location ? [{ ...location, availableQty: row.qty.toString() }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
