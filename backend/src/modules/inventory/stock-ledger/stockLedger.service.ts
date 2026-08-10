import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { allocateNumber } from '../../../lib/numberSequence.ts';

/**
 * 🔴 THE ONLY WRITER OF `stock_ledger`, AND THE ONLY CREATOR OF LOTS.
 *
 * Not a module: no controller, no routes, no list page, no sidebar entry. Every
 * module that moves stock — job order material-in (Sprint 2), job issue (3), job
 * receipt (4), and later Purchase Received, transfers, adjustments — calls
 * `postMovement` and
 * nothing else. Not a seed, not a script, not a "quick fix".
 *
 * The rule is worth the inconvenience because of what it protects. A wrong
 * *number* can be recomputed from history; a wrong *history* cannot be recovered
 * from anything. This is the same class of rule as "`authenticate` never touches
 * the database" — cheap to hold from day one, unrecoverable once broken.
 *
 * WHY EVERY FUNCTION TAKES `tx` INSTEAD OF AN orgId
 *
 * The ledger row and the document that caused it must land in the SAME
 * transaction. A challan that saved but whose stock did not move is a physically
 * impossible state that someone has to unpick by hand. So the caller owns
 * `runAsTenant(...)` and hands the transaction client down; this file never opens
 * one. That also means RLS is already scoped when these run — `app.current_tenant`
 * is set on that transaction's connection.
 *
 * WHAT IS DERIVED AND WHAT IS STORED
 *
 * Balances and lot values are DERIVED, always (domain doc §5.6). There is no
 * `stock_balance` table and no `lots.value` column, and adding either is how the
 * two copies start disagreeing. A correction is a REVERSING ENTRY; cancelling a
 * posted document posts the opposite rows and flips the document's status. The
 * row is never edited and never deleted.
 */

/** Every kind of movement the ledger records. */
export const MOVEMENT_TYPES = [
  /** Stock that existed before the system did. */
  'opening',
  /** Goods arriving from outside: Purchase Received, or a job order's Material In. */
  'receipt',
  /** Material leaving for a processor or a work centre. */
  'issue',
  'transfer_in',
  'transfer_out',
  /** The input side of a process — old stock destroyed. */
  'consume',
  /** The output side of a process — new stock created, as a new lot. */
  'produce',
  /** A write-off. The cost stays absorbed in the job order so the surviving good
   * pieces carry the true cost of the failures (§5.5). */
  'scrap',
  'adjustment',
  /** The opposite of an earlier row. The ONLY way to undo anything here. */
  'reversal',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const STOCK_EFFECTS = ['both', 'physical', 'accounting'] as const;
export type StockEffect = (typeof STOCK_EFFECTS)[number];

/** own | customer — §5.3. Customer-owned stock is always ZERO value. */
export const OWNERSHIPS = ['own', 'customer'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export interface PostMovementInput {
  organizationId: string;
  lotId: string;
  locationId: string;
  /** Set only for package-granular movements (`lotTracking = 'lot_and_package'`). */
  lotPackageId?: string | null;
  movementType: MovementType;
  stockEffect?: StockEffect;
  /** Exactly one of these is positive; the other stays 0. */
  qtyIn?: Prisma.Decimal | number | string;
  qtyOut?: Prisma.Decimal | number | string;
  valueIn?: Prisma.Decimal | number | string;
  valueOut?: Prisma.Decimal | number | string;
  /** The document that caused the movement, e.g. `job_issue`. */
  sourceDocType: string;
  sourceDocId?: string | null;
  sourceDocLineId?: string | null;
  remarks?: string | null;
  /** When it HAPPENED. Defaults to now; a back-dated challan passes its own date. */
  postedAt?: Date;
  userId?: string | null;
}

function toDecimal(value: Prisma.Decimal | number | string | undefined): Prisma.Decimal {
  if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

/**
 * 🔴 Post one movement.
 *
 * The lot is re-read here rather than trusted from the caller, and `itemId`,
 * `uomId`, `ownership` and `ownerPartyId` are copied off it. A ledger row that
 * claims a different item or a different owner from its own lot is not a number
 * that can be corrected later — it is a row no report can interpret. Making the
 * lot the single source for those four fields means a caller cannot get them
 * wrong, only the lot can, and the lot is written in exactly one place
 * (`createLot`).
 */
export async function postMovement(tx: TenantClient, input: PostMovementInput) {
  const qtyIn = toDecimal(input.qtyIn);
  const qtyOut = toDecimal(input.qtyOut);
  let valueIn = toDecimal(input.valueIn);
  let valueOut = toDecimal(input.valueOut);
  const stockEffect = input.stockEffect ?? 'both';

  if (qtyIn.isNegative() || qtyOut.isNegative() || valueIn.isNegative() || valueOut.isNegative()) {
    throw ApiError.badRequest('A ledger movement cannot carry a negative quantity or value.');
  }

  if (stockEffect === 'physical' && (!valueIn.isZero() || !valueOut.isZero())) {
    throw ApiError.badRequest('A purely physical movement must have zero value.');
  }

  // One direction per row, never a signed quantity. Two columns are what make
  // "how much came in" and "how much went out" separate SUMs rather than two
  // filtered ones — and they make a sign error impossible to write.
  if (qtyIn.isZero() === qtyOut.isZero()) {
    throw ApiError.badRequest(
      'A ledger movement must be either an in or an out: set exactly one of qtyIn / qtyOut.',
    );
  }
  if ((qtyIn.isZero() && !valueIn.isZero()) || (qtyOut.isZero() && !valueOut.isZero())) {
    throw ApiError.badRequest('Value must move in the same direction as quantity.');
  }

  const lot = await tx.lot.findFirst({
    where: { id: input.lotId, organizationId: input.organizationId, isDeleted: false },
    select: { id: true, itemId: true, uomId: true, ownership: true, ownerPartyId: true },
  });
  if (!lot) throw ApiError.notFound('Lot not found.');

  // §5.3: customer-owned stock appears in quantity reports and NEVER in
  // valuation. Zeroing here rather than trusting the caller means the rule lives
  // in one place — the alternative is every module remembering it, and one
  // forgetting is a customer's goods showing up as our assets.
  if (lot.ownership === 'customer') {
    valueIn = new Prisma.Decimal(0);
    valueOut = new Prisma.Decimal(0);
  }

  if (input.lotPackageId) {
    const pkg = await tx.lotPackage.findFirst({
      where: {
        id: input.lotPackageId,
        lotId: lot.id,
        organizationId: input.organizationId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!pkg) throw ApiError.badRequest('That package does not belong to this lot.');
  }

  return tx.stockLedgerEntry.create({
    data: {
      organizationId: input.organizationId,
      itemId: lot.itemId,
      lotId: lot.id,
      lotPackageId: input.lotPackageId ?? null,
      locationId: input.locationId,
      ownership: lot.ownership,
      ownerPartyId: lot.ownerPartyId,
      uomId: lot.uomId,
      qtyIn,
      qtyOut,
      valueIn,
      valueOut,
      movementType: input.movementType,
      stockEffect,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId ?? null,
      sourceDocLineId: input.sourceDocLineId ?? null,
      remarks: input.remarks ?? null,
      postedAt: input.postedAt ?? new Date(),
      createdBy: input.userId ?? null,
    },
  });
}

/**
 * Post several movements in order. A thin loop, not a `createMany`: every row
 * still goes through `postMovement`'s validation and lot read, so a batch cannot
 * smuggle past the checks a single post has to satisfy. Issuing 50 takas is 50
 * rows; if that ever becomes a measured problem, the fix is caching the lot reads
 * inside this function, not bypassing them.
 */
export async function postMovements(tx: TenantClient, inputs: readonly PostMovementInput[]) {
  const rows = [];
  for (const input of inputs) rows.push(await postMovement(tx, input));
  return rows;
}

export interface BalanceFilter {
  organizationId: string;
  itemId?: string;
  lotId?: string;
  lotPackageId?: string;
  locationId?: string;
  ownership?: Ownership;
  /** Balance as it stood at a moment in time, by `postedAt`. */
  asOf?: Date;
  /**
   * The axis to query. Defaults to 'accounting'.
   * 'accounting': Includes 'both' + 'accounting' rows.
   * 'physical': Includes 'both' + 'physical' rows.
   * 'both': Only includes 'both' rows (rarely queried alone).
   */
  axis?: StockEffect;
}

function balanceWhere(filter: BalanceFilter): Prisma.StockLedgerEntryWhereInput {
  const axis = filter.axis ?? 'accounting';
  return {
    // The `where` is what the query means; RLS is the net under it. Both stay.
    organizationId: filter.organizationId,
    ...(filter.itemId ? { itemId: filter.itemId } : {}),
    ...(filter.lotId ? { lotId: filter.lotId } : {}),
    ...(filter.lotPackageId ? { lotPackageId: filter.lotPackageId } : {}),
    ...(filter.locationId ? { locationId: filter.locationId } : {}),
    ...(filter.ownership ? { ownership: filter.ownership } : {}),
    ...(filter.asOf ? { postedAt: { lte: filter.asOf } } : {}),
    stockEffect: { in: [axis, 'both'] },
  };
}

/**
 * `SUM(qtyIn − qtyOut)` and `SUM(valueIn − valueOut)` over whatever the filter
 * narrows to. Derived every time, never a stored column (§5.6).
 *
 * Note what "value" means here: it is the same SUM shape as quantity, which is
 * the whole reason plan §3 decision 1 chose derived-over-stored. A lot's value is
 * this function with `lotId` set — there is nothing else to keep in step.
 *
 * 🔴 A valuation query must pass `ownership: 'own'`. A quantity query must not:
 * customer-owned goods are physically in the godown and belong in stock counts,
 * they are simply never our asset.
 */
export async function getBalance(
  tx: TenantClient,
  filter: BalanceFilter,
): Promise<{ qty: Prisma.Decimal; value: Prisma.Decimal }> {
  const sums = await tx.stockLedgerEntry.aggregate({
    where: balanceWhere(filter),
    _sum: { qtyIn: true, qtyOut: true, valueIn: true, valueOut: true },
  });

  const zero = new Prisma.Decimal(0);
  return {
    qty: (sums._sum.qtyIn ?? zero).minus(sums._sum.qtyOut ?? zero),
    value: (sums._sum.valueIn ?? zero).minus(sums._sum.valueOut ?? zero),
  };
}

export interface MultiAxisBalance {
  physicalQty: Prisma.Decimal;
  accountingQty: Prisma.Decimal;
  value: Prisma.Decimal;
}

/**
 * Executes a single raw SQL query to compute both physical and accounting
 * balances (and the value) in one pass, without two aggregate calls.
 */
export async function getBalances(tx: TenantClient, filter: BalanceFilter): Promise<MultiAxisBalance> {
  const orgId = filter.organizationId;
  let q = Prisma.sql`SELECT
    COALESCE(SUM(qty_in - qty_out) FILTER (WHERE stock_effect IN ('both', 'physical')), 0) AS "physicalQty",
    COALESCE(SUM(qty_in - qty_out) FILTER (WHERE stock_effect IN ('both', 'accounting')), 0) AS "accountingQty",
    COALESCE(SUM(value_in - value_out) FILTER (WHERE stock_effect IN ('both', 'accounting')), 0) AS value
    FROM stock_ledger
    WHERE organization_id = ${orgId}::uuid`;

  if (filter.itemId) q = Prisma.sql`${q} AND item_id = ${filter.itemId}::uuid`;
  if (filter.lotId) q = Prisma.sql`${q} AND lot_id = ${filter.lotId}::uuid`;
  if (filter.lotPackageId) q = Prisma.sql`${q} AND lot_package_id = ${filter.lotPackageId}::uuid`;
  if (filter.locationId) q = Prisma.sql`${q} AND location_id = ${filter.locationId}::uuid`;
  if (filter.ownership) q = Prisma.sql`${q} AND ownership = ${filter.ownership}`;
  if (filter.asOf) q = Prisma.sql`${q} AND posted_at <= ${filter.asOf}::timestamptz`;

  const rows = await tx.$queryRaw<{ physicalQty: Prisma.Decimal; accountingQty: Prisma.Decimal; value: Prisma.Decimal }[]>`${q}`;

  const row = rows[0];
  return {
    physicalQty: toDecimal(row?.physicalQty),
    accountingQty: toDecimal(row?.accountingQty),
    value: toDecimal(row?.value),
  };
}

export interface AvailableLot {
  lotId: string;
  lotNumber: string;
  supplierLotRef: string | null;
  itemId: string;
  uomId: string | null;
  ownership: string;
  ownerPartyId: string | null;
  availableQty: Prisma.Decimal;
}

/**
 * What is actually available to issue, at one location, for one item.
 *
 * 🔴 This reads the LEDGER, not the `lots` table. A lot row exists from the
 * moment it is created and goes on existing after every last metre of it has been
 * issued — "does a lot exist" and "is there any of it here" are different
 * questions, and answering the second with the first is how a picker offers
 * material that is already at the dyer's.
 *
 * `ownership` is a filter, not a display column: our own stock and a customer's
 * must never be offered in the same picker, because issuing one against the other
 * silently converts an asset into a liability.
 *
 * The positive-balance test happens in JS rather than SQL because Prisma's
 * `groupBy` cannot express `HAVING SUM(a) - SUM(b) > 0`. The grouped set is one
 * row per lot for one item at one location, which is small; if a real query ever
 * proves otherwise the fix is a raw `HAVING`, not a stored balance (§5.6).
 */
export async function getAvailableLots(
  tx: TenantClient,
  filter: {
    organizationId: string;
    itemId: string;
    locationId?: string;
    ownership?: Ownership;
    asOf?: Date;
  },
): Promise<AvailableLot[]> {
  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['lotId'],
    where: balanceWhere(filter),
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  const positive = grouped
    .map((row) => ({
      lotId: row.lotId,
      availableQty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
    }))
    .filter((row) => row.availableQty.greaterThan(0));

  if (positive.length === 0) return [];

  const lots = await tx.lot.findMany({
    where: {
      id: { in: positive.map((row) => row.lotId) },
      organizationId: filter.organizationId,
      isDeleted: false,
    },
    select: {
      id: true,
      lotNumber: true,
      supplierLotRef: true,
      itemId: true,
      uomId: true,
      ownership: true,
      ownerPartyId: true,
    },
  });

  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  return positive
    .flatMap((row) => {
      const lot = byId.get(row.lotId);
      return lot ? [{ ...lot, lotId: lot.id, availableQty: row.availableQty }] : [];
    })
    .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber));
}

export interface AvailablePackage {
  lotPackageId: string;
  packageNumber: number;
  label: string | null;
  /** The MEASURED quantity on the tag — what ticking the box takes (§5.3). */
  qty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
}

/**
 * The takas of one lot that are still here.
 *
 * 🔴 The LEDGER decides, not `lot_packages.state`. The state column is a label
 * that something has to remember to update; the ledger is the movement itself.
 * When the two disagree — and they will, the first time a document is cancelled
 * — the ledger is right, so it is the only thing this asks.
 *
 * Ticking a package takes its whole measured quantity (§5.3), which is why the
 * balance is used as a filter and `qty` is what the caller issues: a half-issued
 * taka is not a thing that happens on a shop floor.
 */
export async function getAvailablePackages(
  tx: TenantClient,
  filter: { organizationId: string; lotId: string; locationId?: string; asOf?: Date },
): Promise<AvailablePackage[]> {
  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['lotPackageId'],
    where: { ...balanceWhere(filter), lotPackageId: { not: null } },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  const positive = grouped
    .map((row) => ({
      lotPackageId: row.lotPackageId as string,
      availableQty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
    }))
    .filter((row) => row.availableQty.greaterThan(0));

  if (positive.length === 0) return [];

  const packages = await tx.lotPackage.findMany({
    where: {
      id: { in: positive.map((row) => row.lotPackageId) },
      organizationId: filter.organizationId,
      isDeleted: false,
    },
    select: { id: true, packageNumber: true, label: true, qty: true },
    orderBy: { packageNumber: 'asc' },
  });

  const balanceById = new Map(positive.map((row) => [row.lotPackageId, row.availableQty]));
  return packages.map((pkg) => ({
    lotPackageId: pkg.id,
    packageNumber: pkg.packageNumber,
    label: pkg.label,
    qty: pkg.qty,
    availableQty: balanceById.get(pkg.id) ?? zero,
  }));
}

export interface CreateLotInput {
  organizationId: string;
  itemId: string;
  uomId?: string | null;
  /** Manual entry is allowed — mills carry the supplier's number on a physical
   * tag. Omit it and the org's `lot` sequence supplies one. */
  lotNumber?: string;
  supplierLotRef?: string | null;
  ownership?: Ownership;
  ownerPartyId?: string | null;
  /** Zero, one, or MANY — grey from two POs dyed together comes back as one lot. */
  parentLotIds?: readonly string[];
  sourceDocType: string;
  sourceDocId?: string | null;
  customFields?: Prisma.InputJsonValue;
  userId?: string | null;
}

/**
 * Create a lot. The ONLY place a lot is born.
 *
 * A lot is mandatory internally and optional in the UI (§5.2.1): every ledger row
 * references one, but whether the user ever sees a lot number is per item
 * (`Item.lotTracking`). With `none` the system quietly creates one lot per
 * receipt and no lot field appears on screen — costing and the ledger still work.
 *
 * 🔴 `parentLotIds` is written here or never. Genealogy cannot be reconstructed
 * from history that was never recorded, and a lot created without its parents is
 * permanently untraceable (§11.3).
 */
export async function createLot(tx: TenantClient, input: CreateLotInput) {
  const ownership: Ownership = input.ownership ?? 'own';

  // The one pair that makes inward jobwork work, so the pair is validated rather
  // than assumed. `customer` with no owner is a zero-value lot nobody can bill
  // for; `own` with an owner reads as someone else's goods in every report.
  if (ownership === 'customer' && !input.ownerPartyId) {
    throw ApiError.badRequest('Customer-owned stock needs the customer it belongs to.');
  }
  if (ownership === 'own' && input.ownerPartyId) {
    throw ApiError.badRequest('Only customer-owned stock may name an owning party.');
  }

  const item = await tx.item.findFirst({
    where: { id: input.itemId, organizationId: input.organizationId, isDeleted: false },
    select: { id: true, stockingUomId: true },
  });
  if (!item) throw ApiError.notFound('Item not found.');

  const manualNumber = input.lotNumber?.trim();
  const lotNumber = manualNumber || (await allocateNumber(tx, input.organizationId, 'lot'));

  const data: LotWriteData = {
    organizationId: input.organizationId,
    lotNumber,
    supplierLotRef: input.supplierLotRef ?? null,
    itemId: item.id,
    // The lot's unit is the item's stocking unit — one item, one stocking
    // unit (§5.1). Passing it explicitly is only for the rare case where the
    // item's own is not yet set.
    uomId: input.uomId ?? item.stockingUomId,
    ownership,
    ownerPartyId: input.ownerPartyId ?? null,
    parentLotIds: input.parentLotIds ? [...input.parentLotIds] : [],
    sourceDocType: input.sourceDocType,
    sourceDocId: input.sourceDocId ?? null,
    customFields: input.customFields ?? {},
  };

  if (manualNumber) {
    const recycled = await recycleDeletedLot(tx, data, input.userId ?? null);
    if (recycled) return recycled;
  }

  return withUniqueViolation('Lot number already exists in this organization.', () =>
    tx.lot.create({
      data: { ...data, createdBy: input.userId ?? null, updatedBy: input.userId ?? null },
    }),
  );
}

/** Every scalar a lot is born with — shared by the create and the recycle below. */
interface LotWriteData {
  organizationId: string;
  lotNumber: string;
  supplierLotRef: string | null;
  itemId: string;
  uomId: string | null;
  ownership: Ownership;
  ownerPartyId: string | null;
  parentLotIds: string[];
  sourceDocType: string;
  sourceDocId: string | null;
  customFields: Prisma.InputJsonValue;
}

/**
 * Take over the row a soft-deleted lot left behind, when a hand-typed number
 * collides with it. Returns null when there is nothing to take over.
 *
 * A soft-deleted lot still occupies its number: `@@unique([organizationId,
 * lotNumber])` is a FULL index, and deliberately so — Prisma cannot express
 * `WHERE is_deleted = false`, so a partial one would read as permanent drift
 * (the same call as `migrations/20260725140000_membership_is_owner_.../
 * migration.sql:55`). Without this the number a mis-entry once held would be
 * refused forever, and a lot number is printed on a tag stuck to a roll.
 *
 * 🔴 Only for a HAND-TYPED number. An allocated one landing on a dead lot means
 * the sequence caught up with something a user typed earlier; adopting an
 * unrelated row there would be a silent data bug, not a convenience.
 *
 * 🔴 Only when the dead lot never moved stock. `getBalance` sums by `lotId` and
 * a ledger row is never deleted, so recycling a lot that has entries would hand
 * the new lot the old one's balance. That number stays occupied — permanently.
 */
async function recycleDeletedLot(tx: TenantClient, data: LotWriteData, userId: string | null) {
  const dead = await tx.lot.findFirst({
    where: {
      organizationId: data.organizationId,
      lotNumber: data.lotNumber,
      isDeleted: true,
    },
    select: { id: true },
  });
  if (!dead) return null;

  const movements = await tx.stockLedgerEntry.count({ where: { lotId: dead.id } });
  if (movements > 0) {
    throw ApiError.conflict(
      'That lot number belongs to a deleted lot that has already moved stock, so it cannot be reused.',
    );
  }

  // The one legitimate hard delete in this file. These packages describe a lot
  // that never physically existed, and nothing can reference them — the count
  // above just proved the lot never moved. Soft-deleting them instead would
  // leave `createPackages` continuing from the old maximum, so the first taka of
  // a brand-new lot would be numbered /41.
  await tx.lotPackage.deleteMany({ where: { lotId: dead.id } });

  // Compare-and-swap on `isDeleted`, not a plain update: two saves racing on the
  // same typed number would otherwise both "win" and quietly become one lot. The
  // loser falls through to the create below and gets its 409.
  const claimed = await tx.lot.updateMany({
    where: { id: dead.id, organizationId: data.organizationId, isDeleted: true },
    // A recycled row is a NEW lot, so `createdBy` is whoever is entering it now.
    // Keeping the original would attribute this lot to someone who never saw it.
    data: { ...data, state: 'open', isDeleted: false, createdBy: userId, updatedBy: userId },
  });
  if (claimed.count === 0) return null;

  return tx.lot.findFirstOrThrow({ where: { id: dead.id } });
}

export interface CreatePackageInput {
  /** The MEASURED quantity of this package — the reason the table exists. */
  qty: Prisma.Decimal | number | string;
  /** What is printed on the tag. Defaults to `<lotNumber>/<n>`. */
  label?: string | null;
  /** Set only when the process preserves packaging (§5.2.3). */
  parentPackageId?: string | null;
  customFields?: Prisma.InputJsonValue;
}

/**
 * Add packages (takas) to a lot.
 *
 * 🔴 `packageNumber` RESTARTS AT 1 INSIDE EACH LOT — `LOT-00088/1 … /40`. Scoped
 * numbering is correct here and almost nowhere else: a package has exactly one
 * parent lot, can never merge across lots, and cannot exist without one (§5.2.2).
 *
 * The next number continues from the lot's current highest rather than from the
 * count, so adding packages to a lot that already has some — a re-measure, a
 * split — never reuses a number that is already printed on a tag.
 */
export async function createPackages(
  tx: TenantClient,
  input: {
    organizationId: string;
    lotId: string;
    packages: readonly CreatePackageInput[];
    userId?: string | null;
  },
) {
  if (input.packages.length === 0) return [];

  const lot = await tx.lot.findFirst({
    where: { id: input.lotId, organizationId: input.organizationId, isDeleted: false },
    select: { id: true, lotNumber: true },
  });
  if (!lot) throw ApiError.notFound('Lot not found.');

  // Highest so far, INCLUDING soft-deleted rows: a deleted taka's number is still
  // on a physical tag somewhere, and the unique index still holds it.
  const highest = await tx.lotPackage.aggregate({
    where: { lotId: lot.id },
    _max: { packageNumber: true },
  });
  let next = (highest._max.packageNumber ?? 0) + 1;

  const created = [];
  for (const pkg of input.packages) {
    const qty = toDecimal(pkg.qty);
    if (qty.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('Every package needs a measured quantity greater than zero.');
    }
    const packageNumber = next++;
    created.push(
      await tx.lotPackage.create({
        data: {
          organizationId: input.organizationId,
          lotId: lot.id,
          packageNumber,
          label: pkg.label?.trim() || `${lot.lotNumber}/${packageNumber}`,
          qty,
          parentPackageId: pkg.parentPackageId ?? null,
          customFields: pkg.customFields ?? {},
          createdBy: input.userId ?? null,
          updatedBy: input.userId ?? null,
        },
      }),
    );
  }

  return created;
}
