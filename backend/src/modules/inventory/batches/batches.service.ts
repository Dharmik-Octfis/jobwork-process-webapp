import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  getAvailableBatches,
  getAvailableBatchUnits,
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
  itemId?: string;
  /**
   * 🔴 THE STEP'S WHOLE CONSUMES LIST IN ONE REQUEST (2026-09-01), which is what
   * the Issue dialog opens with. It used to ask once per item, and each of those
   * asks paid a membership read, a transaction and a pooled connection of its own
   * — a five-item step held five connections to answer one dialog.
   *
   * `limit` stays PER ITEM here, so one item with hundreds of live batches cannot
   * starve the rest (`getAvailableBatches`).
   */
  itemIds?: readonly string[];
  locationId?: string;
  /**
   * 🔴 NOT OPTIONAL IN PRACTICE. The Issue dialog always passes the job order's
   * ownership, because without it one customer's goods can be issued into
   * another customer's job order — you would be processing A's material on B's
   * order and both stock reports would be wrong. Same class of failure as a
   * missing tenant filter (§5.2).
   */
  ownership?: Ownership;
  /**
   * Include each batch's PACKAGES — the takas, rolls or bales inside it — and its
   * untagged remainder.
   *
   * Off by default and asked for only by the pickers that can render the level,
   * because it costs one extra grouped query. Was a dead `withPackages` flag left
   * behind by the package tracking removed on 2026-08-12; it accepted a value and
   * did nothing. Renamed with the level that gives it meaning again, so nothing
   * reads as the old feature come back.
   */
  withUnits?: boolean;
  /** What the user typed into the picker's batch box — matched against the batch
   * number and the supplier's own reference. Each item has its own search box, so
   * a searching caller asks about that ONE item; the multi-item form above is the
   * dialog's opening load, before anyone has typed. */
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
  const itemIds = query.itemIds?.length ? [...query.itemIds] : query.itemId ? [query.itemId] : [];
  if (itemIds.length === 0) return [];

  return runAsTenant(organizationId, async (tx) => {
    /**
     * 🔴 EXACTLY THE GODOWN ASKED FOR (2026-08-19) — this replaced the
     * dispatch-site expansion of 2026-08-14, which resolved the location to the
     * root of its `parentId` chain and offered every godown sharing it.
     *
     * That expansion offered SIBLINGS the caller never named: ask about Godown A
     * and Godown B's rolls came back. An issue now goes out of one location and
     * one only, so the picker must show that location's stock and nothing else —
     * otherwise it offers rows the save will refuse.
     *
     * Rows still come back per (batch, location) and carry `locationId`, because
     * that pair is what the ledger posts against.
     */
    const batches = await getAvailableBatches(tx, {
      organizationId,
      // A single-element `itemIds` still collapses to one item downstream: the
      // database-side `take` stays, and the `in` is an equality to Postgres.
      itemIds,
      // No location asked for means no location filter — an org-wide question,
      // which the job-order planner asks and the issue picker never does.
      locationId: query.locationId,
      ownership: query.ownership,
      search: query.search,
      limit: query.limit,
    });
    if (batches.length === 0) return [];

    // Named so the picker can label each row. Keyed off the rows actually
    // returned, so it stays one read however many locations answered.
    const locations = await tx.location.findMany({
      where: {
        organizationId,
        id: { in: [...new Set(batches.map((row) => row.locationId))] },
        isDeleted: false,
      },
      select: { id: true, name: true },
    });
    const locationNameById = new Map(locations.map((row) => [row.id, row.name]));

    // One read for every item asked about — not one per item, and never one per
    // batch.
    const items = await tx.item.findMany({
      where: { id: { in: itemIds }, organizationId, isDeleted: false },
      select: { id: true, inventoryTracking: true },
    });
    const trackingByItem = new Map(items.map((row) => [row.id, row.inventoryTracking]));

    /**
     * 🔴 EVERY PACKAGE OF EVERY RETURNED BATCH IN ONE GROUPED QUERY, never one per
     * batch. A picker showing a dozen batches each holding several rolls is fifty
     * round trips asked row by row — invisible at three and the whole response
     * time at three hundred, which is the same trap `getAvailableBatches`
     * documents one level up.
     *
     * Keyed by (batch, location) because that pair is what a row here IS: one
     * batch can hold packages in two racks, and the challan takes them out of
     * exactly one.
     */
    const unitsByBatchLocation = new Map<
      string,
      { batchUnitId: string; seq: number; label: string; availableQty: string }[]
    >();
    if (query.withUnits) {
      const units = await getAvailableBatchUnits(tx, {
        organizationId,
        batchIds: [...new Set(batches.map((row) => row.batchId))],
        locationId: query.locationId,
        ownership: query.ownership,
      });
      for (const unit of units) {
        const key = `${unit.batchId}@${unit.locationId}`;
        unitsByBatchLocation.set(key, [
          ...(unitsByBatchLocation.get(key) ?? []),
          {
            batchUnitId: unit.batchUnitId,
            seq: unit.seq,
            label: unit.label,
            availableQty: unit.availableQty.toString(),
          },
        ]);
      }
    }

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
      inventoryTracking: trackingByItem.get(batch.itemId) ?? 'none',

      /**
       * The packages inside this batch AT THIS LOCATION, and what is left of each.
       * Empty when the org runs no package level, when the caller did not ask, and
       * when the batch simply has none — all three are the same answer to the
       * picker: show the batch as it always was.
       */
      units: unitsByBatchLocation.get(`${batch.batchId}@${batch.locationId}`) ?? [],
      /**
       * 🔴 WHAT MAY LEAVE WITHOUT NAMING A PACKAGE — the batch's balance less
       * everything its packages hold.
       *
       * Sent because the picker cannot compute it: it must not subtract the
       * packages it can SEE from the batch total, since a limit or a search could
       * have trimmed the list. And it is the exact figure `postMovement`'s
       * invariant measures against, so a row offering more than this is a row the
       * save would refuse.
       */
      untaggedQty: batch.availableQty
        .minus(
          (unitsByBatchLocation.get(`${batch.batchId}@${batch.locationId}`) ?? []).reduce(
            (sum, unit) => sum.plus(unit.availableQty),
            new Prisma.Decimal(0),
          ),
        )
        .toString(),
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
  query: { itemIds: readonly string[]; ownership?: Ownership },
) {
  return runAsTenant(organizationId, async (tx) => {
    /**
     * 🔴 GROUPED BY LOCATION **AND ITEM** (2026-08-19), because one challan goes
     * out of one location and carries several items.
     *
     * A single-item version of this could only answer "where is the fabric",
     * which is what the Issue dialog used to ask — it then applied that answer to
     * the thread and the buttons as well, so an item stocked somewhere else got a
     * picker that was silently empty.
     *
     * The per-item breakdown is what lets the dialog say all three things it now
     * has to: how many of the step's items a location covers, which ones it does
     * not, and — the part that turns a dead end into a decision — where those
     * ones actually are.
     */
    const grouped = await tx.stockLedgerEntry.groupBy({
      by: ['locationId', 'itemId'],
      where: {
        organizationId,
        itemId: { in: [...query.itemIds] },
        ...(query.ownership ? { ownership: query.ownership } : {}),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });

    const zero = new Prisma.Decimal(0);
    const positive = grouped
      .map((row) => ({
        locationId: row.locationId,
        itemId: row.itemId,
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

    // One row per location, carrying every item it holds. `availableQty` is kept
    // as the total across those items ONLY so a caller with a single item reads
    // exactly as it did before; anything comparing items must use `items`, since
    // 100 PCS + 5 CONE is 105 of nothing (§6.5).
    const byLocation = new Map<
      string,
      { items: { itemId: string; availableQty: string }[]; total: Prisma.Decimal }
    >();
    for (const row of positive) {
      const entry = byLocation.get(row.locationId) ?? { items: [], total: zero };
      entry.items.push({ itemId: row.itemId, availableQty: row.qty.toString() });
      byLocation.set(row.locationId, { items: entry.items, total: entry.total.plus(row.qty) });
    }

    return [...byLocation.entries()]
      .flatMap(([locationId, entry]) => {
        const location = byId.get(locationId);
        return location
          ? [{ ...location, items: entry.items, availableQty: entry.total.toString() }]
          : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
