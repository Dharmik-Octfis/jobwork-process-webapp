import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { resolveDispatchSite } from '../../settings/configuration/locations/locationSites.ts';
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

/**
 * 🔴 `batchNumber` IS NOT SEARCHABLE, and that is deliberate (2026-08-14).
 *
 * Searchability follows visibility. The number is an internal key that is never
 * rendered and never printed — this system's equivalent of Zoho's hidden record
 * id — so nobody can be typing it, and matching on it only pollutes results: a
 * search for `42` would hit internal numbers that have nothing to do with the
 * batch the user is looking for.
 *
 * What people DO type is what is on the physical tag, which is one of these two.
 */
const SEARCH_COLUMNS = ['supplierBatchRef', 'manufacturerBatch'] as const;

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
  /** What the user typed into the picker's batch box — matched against the batch
   * number and the supplier's own reference. */
  search?: string;
  /** A ceiling on rows, so an item with hundreds of live batches still answers. */
  limit?: number;
}

/**
 * What can actually be issued: the picker's grid.
 *
 * The picker shows the batch, what is left of it and what that is worth. Batch age
 * was dropped from this payload on 2026-08-10 and stays gone — if a FIFO
 * suggestion or the 180-day GST clock ever needs it, compute it HERE and not on
 * the client, so the two agree. `supplierBatchRef` came BACK on 2026-08-13: the
 * picker is searchable now, and a batch you can match on but cannot see is a row
 * the user has no way to identify.
 *
 * 🔴 One query for the balances, not one per batch. `getAvailableBatches` sums
 * value in the same pass as quantity precisely so this loop stays a loop over
 * memory — the `getBalance` that used to sit inside it was a database round trip
 * per row, which is nothing at three batches and is the entire response at three
 * hundred.
 */
export async function getAvailableStock(organizationId: string, query: AvailabilityQuery) {
  return runAsTenant(organizationId, async (tx) => {
    /**
     * 🔴 THE WHOLE DISPATCH SITE, not the one godown asked for (2026-08-14).
     *
     * One challan may draw from every godown under a site, so offering only the
     * location the user happened to land on is what made the picker look like it
     * was hiding stock. Crossing to another site is refused at save — that is a
     * second address, and a Rule 55 challan carries one.
     *
     * Rows come back per (batch, location) and carry `locationId`, so the picker
     * can say which godown each one is in.
     */
    const site = query.locationId
      ? await resolveDispatchSite(tx, organizationId, query.locationId)
      : null;

    const batches = await getAvailableBatches(tx, {
      organizationId,
      itemId: query.itemId,
      // No location asked for means no location filter — an org-wide question,
      // which some reports ask and the picker never does.
      locationIds: site?.locationIds,
      ownership: query.ownership,
      search: query.search,
      limit: query.limit,
    });
    if (batches.length === 0) return [];

    // Named so the picker can label each row. Keyed off the rows actually
    // returned, so it is one read whether the site has two godowns or twenty.
    const locations = await tx.location.findMany({
      where: {
        organizationId,
        id: { in: [...new Set(batches.map((row) => row.locationId))] },
        isDeleted: false,
      },
      select: { id: true, name: true },
    });
    const locationNameById = new Map(locations.map((row) => [row.id, row.name]));

    // Every row here is the same item, so its tracking mode is one read, not one
    // per batch.
    const item = await tx.item.findFirst({
      where: { id: query.itemId, organizationId, isDeleted: false },
      select: { inventoryTracking: true },
    });

    return batches.map((batch) => ({
      batchId: batch.batchId,
      /* 🔴 Sent back on the line. A row is a batch AT A GODOWN, and the challan
         records which one — within a site there may be several. */
      locationId: batch.locationId,
      locationName: locationNameById.get(batch.locationId) ?? null,
      // 🔴 No `batchNumber` (2026-08-14). `batchId` is the handle the client sends
      // back; the number is internal and a field in the payload is a field
      // somebody eventually renders.
      supplierBatchRef: batch.supplierBatchRef,
      /* 🔴 The picker's identifying line since 2026-08-14. `supplierBatchRef` is
         the label but it is deliberately NOT unique — two live rows can both read
         `jv2` — and `batchNumber` is never rendered, so these three are what
         actually separate them on screen. */
      manufacturerBatch: batch.manufacturerBatch,
      createdAt: batch.createdAt.toISOString(),
      /* Read-only on the Add Batches grid — the issue screen shows what the chosen
         batch already says and never edits it. Date-only columns (`@db.Date`) come
         back as UTC midnight, so they are sliced rather than sent as timestamps:
         an ISO instant renders a day early anywhere behind UTC. */
      manufacturedDate: batch.manufacturedDate
        ? batch.manufacturedDate.toISOString().slice(0, 10)
        : null,
      expiryDate: batch.expiryDate ? batch.expiryDate.toISOString().slice(0, 10) : null,
      mrp: batch.mrp !== null ? batch.mrp.toString() : null,
      sellingPrice: batch.sellingPrice !== null ? batch.sellingPrice.toString() : null,
      itemId: batch.itemId,
      uomId: batch.uomId,
      ownership: batch.ownership,
      ownerPartyId: batch.ownerPartyId,
      availableQty: batch.availableQty.toString(),
      accumulatedValue: batch.value.toString(),
      // Cost per unit of what is LEFT, not of what was received. Derived every
      // time; there is no stored cost column (plan §3, decision 1).
      costPerUnit: batch.availableQty.greaterThan(0)
        ? batch.value.dividedBy(batch.availableQty).toDecimalPlaces(4).toString()
        : null,
      inventoryTracking: item?.inventoryTracking ?? 'none',
    }));
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
