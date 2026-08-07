import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  getAvailableLots,
  getAvailablePackages,
  getBalance,
  type Ownership,
} from '../stock-ledger/stockLedger.service.ts';

/**
 * Lots — READ ONLY, and that is the whole design.
 *
 * 🔴 There is no create, no update, no delete here and there must not be. A lot
 * is born in exactly one place, `stockLedger.service.ts.createLot`, called by
 * the documents that physically bring material in (Material In today; Purchase
 * Received later). A lot someone typed into a form is a quantity that exists in
 * the system and nowhere on the floor.
 *
 * What this module exists for is the Issue dialog's picker, and one property of
 * that picker matters more than everything else in this file:
 *
 * 🔴 IT READS THE LEDGER, NOT THE `lots` TABLE. A lot row exists from the moment
 * it is created and goes on existing after the last metre of it has been issued.
 * "Does this lot exist" and "is there any of it here" are different questions,
 * and answering the second with the first is how a picker offers material that
 * has been at the dyer's for a fortnight (field-sources §10).
 */

const SEARCH_COLUMNS = ['lotNumber', 'supplierLotRef'] as const;

function lotListWhere(organizationId: string, opts: ListQuery): Prisma.LotWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.LotWhereInput>('lot', opts.filter),
    ...searchWhere<Prisma.LotWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

const LOT_INCLUDE = {
  item: { select: { id: true, name: true, sku: true, lotTracking: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
  packages: {
    where: { isDeleted: false },
    orderBy: { packageNumber: 'asc' },
    select: { id: true, packageNumber: true, label: true, qty: true, state: true },
  },
} satisfies Prisma.LotInclude;

export async function getLotsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.lot.findMany({
      where: lotListWhere(organizationId, opts),
      // Oldest first — the same FIFO order the picker suggests, so a lot looked
      // up here sits where the picker put it.
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: LOT_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countLots(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.lot.count({ where: lotListWhere(organizationId, opts) }),
  );
}

/** One lot, with its packages and its DERIVED balance. */
export async function getLotById(organizationId: string, id: string) {
  return runAsTenant(organizationId, async (tx) => {
    const lot = await tx.lot.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: LOT_INCLUDE,
    });
    if (!lot) return null;

    const balance = await getBalance(tx, { organizationId, lotId: id });
    return {
      ...lot,
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
  /** Include each lot's takas. Only worth asking for when the item is tracked
   * that way; otherwise it is a query per lot returning nothing. */
  withPackages?: boolean;
}

/**
 * What can actually be issued: the picker's grid.
 *
 * Age is computed here rather than on the client because it drives two different
 * things that must agree — the FIFO suggestion, and the GST clock that reverses
 * input credit if jobwork goods are not back within 180 days. Two implementations
 * of "how old is this" is one too many.
 */
export async function getAvailableStock(organizationId: string, query: AvailabilityQuery) {
  return runAsTenant(organizationId, async (tx) => {
    const lots = await getAvailableLots(tx, {
      organizationId,
      itemId: query.itemId,
      locationId: query.locationId,
      ownership: query.ownership,
    });
    if (lots.length === 0) return [];

    const rows = await tx.lot.findMany({
      where: { id: { in: lots.map((l) => l.lotId) }, organizationId, isDeleted: false },
      select: { id: true, createdAt: true, state: true, item: { select: { lotTracking: true } } },
    });
    const metaById = new Map(rows.map((r) => [r.id, r]));

    const now = Date.now();
    const out = [];
    for (const lot of lots) {
      const meta = metaById.get(lot.lotId);
      const balance = await getBalance(tx, {
        organizationId,
        lotId: lot.lotId,
        locationId: query.locationId,
      });

      out.push({
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        supplierLotRef: lot.supplierLotRef,
        itemId: lot.itemId,
        uomId: lot.uomId,
        ownership: lot.ownership,
        ownerPartyId: lot.ownerPartyId,
        availableQty: lot.availableQty.toString(),
        accumulatedValue: balance.value.toString(),
        // Cost per unit of what is LEFT, not of what was received. Derived every
        // time; there is no stored cost column (plan §3, decision 1).
        costPerUnit: lot.availableQty.greaterThan(0)
          ? balance.value.dividedBy(lot.availableQty).toDecimalPlaces(4).toString()
          : null,
        ageDays: meta ? Math.floor((now - meta.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : null,
        lotTracking: meta?.item.lotTracking ?? 'none',
        packages:
          query.withPackages && meta?.item.lotTracking === 'lot_and_package'
            ? (
                await getAvailablePackages(tx, {
                  organizationId,
                  lotId: lot.lotId,
                  locationId: query.locationId,
                })
              ).map((pkg) => ({
                ...pkg,
                qty: pkg.qty.toString(),
                availableQty: pkg.availableQty.toString(),
              }))
            : [],
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
