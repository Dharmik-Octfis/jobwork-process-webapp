import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { allocateNumber } from '../../../lib/numberSequence.ts';
import { searchWhere } from '../../../lib/pagination.ts';

/**
 * 🔴 THE ONLY WRITER OF `stock_ledger`, AND THE ONLY CREATOR OF BATCHES.
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
 * Balances and batch values are DERIVED, always (domain doc §5.6). There is no
 * `stock_balance` table and no `batches.value` column, and adding either is how the
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
  /** The output side of a process — new stock created, as a new batch. */
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
  batchId: string;
  locationId: string;
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

/** Empty string is what an untouched date input posts 2014 it is "not stated", not an
 * invalid date, so it must not reach `new Date()`. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return value instanceof Date ? value : new Date(value);
}

function toDecimalOrNull(
  value: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  return new Prisma.Decimal(value);
}

function toDecimal(value: Prisma.Decimal | number | string | undefined): Prisma.Decimal {
  if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

/**
 * 🔴 Post one movement.
 *
 * The batch is re-read here rather than trusted from the caller, and `itemId`,
 * `uomId`, `ownership` and `ownerPartyId` are copied off it. A ledger row that
 * claims a different item or a different owner from its own batch is not a number
 * that can be corrected later — it is a row no report can interpret. Making the
 * batch the single source for those four fields means a caller cannot get them
 * wrong, only the batch can, and the batch is written in exactly one place
 * (`createBatch`).
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

  const batch = await tx.batch.findFirst({
    where: { id: input.batchId, organizationId: input.organizationId, isDeleted: false },
    select: { id: true, itemId: true, uomId: true, ownership: true, ownerPartyId: true },
  });
  if (!batch) throw ApiError.notFound('Batch not found.');

  // §5.3: customer-owned stock appears in quantity reports and NEVER in
  // valuation. Zeroing here rather than trusting the caller means the rule lives
  // in one place — the alternative is every module remembering it, and one
  // forgetting is a customer's goods showing up as our assets.
  if (batch.ownership === 'customer') {
    valueIn = new Prisma.Decimal(0);
    valueOut = new Prisma.Decimal(0);
  }

  return tx.stockLedgerEntry.create({
    data: {
      organizationId: input.organizationId,
      itemId: batch.itemId,
      batchId: batch.id,
      locationId: input.locationId,
      ownership: batch.ownership,
      ownerPartyId: batch.ownerPartyId,
      uomId: batch.uomId,
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
 * still goes through `postMovement`'s validation and batch read, so a batch cannot
 * smuggle past the checks a single post has to satisfy. Issuing 50 takas is 50
 * rows; if that ever becomes a measured problem, the fix is caching the batch reads
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
  batchId?: string;
  locationId?: string;
  /**
   * Several locations at once — a whole DISPATCH SITE (2026-08-14). One challan
   * may draw from every godown under one site, so the picker and the FIFO queue
   * are scoped to the set rather than to the one location the user picked.
   *
   * Ignored when `locationId` is set; a caller that names one location means it.
   */
  locationIds?: readonly string[];
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
    ...(filter.batchId ? { batchId: filter.batchId } : {}),
    ...(filter.locationId
      ? { locationId: filter.locationId }
      : filter.locationIds
        ? { locationId: { in: [...filter.locationIds] } }
        : {}),
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
 * the whole reason plan §3 decision 1 chose derived-over-stored. A batch's value is
 * this function with `batchId` set — there is nothing else to keep in step.
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
export async function getBalances(
  tx: TenantClient,
  filter: BalanceFilter,
): Promise<MultiAxisBalance> {
  const orgId = filter.organizationId;
  let q = Prisma.sql`SELECT
    COALESCE(SUM(qty_in - qty_out) FILTER (WHERE stock_effect IN ('both', 'physical')), 0) AS "physicalQty",
    COALESCE(SUM(qty_in - qty_out) FILTER (WHERE stock_effect IN ('both', 'accounting')), 0) AS "accountingQty",
    COALESCE(SUM(value_in - value_out) FILTER (WHERE stock_effect IN ('both', 'accounting')), 0) AS value
    FROM stock_ledger
    WHERE organization_id = ${orgId}::uuid`;

  if (filter.itemId) q = Prisma.sql`${q} AND item_id = ${filter.itemId}::uuid`;
  if (filter.batchId) q = Prisma.sql`${q} AND batch_id = ${filter.batchId}::uuid`;
  if (filter.locationId) q = Prisma.sql`${q} AND location_id = ${filter.locationId}::uuid`;
  if (filter.ownership) q = Prisma.sql`${q} AND ownership = ${filter.ownership}`;
  if (filter.asOf) q = Prisma.sql`${q} AND posted_at <= ${filter.asOf}::timestamptz`;

  const rows = await tx.$queryRaw<
    { physicalQty: Prisma.Decimal; accountingQty: Prisma.Decimal; value: Prisma.Decimal }[]
  >`${q}`;

  const row = rows[0];
  return {
    physicalQty: toDecimal(row?.physicalQty),
    accountingQty: toDecimal(row?.accountingQty),
    value: toDecimal(row?.value),
  };
}

export interface AvailableBatch {
  batchId: string;
  /**
   * 🔴 WHICH GODOWN this quantity is in. A row is a batch AT A LOCATION, because a
   * challan may draw from a whole dispatch site and one batch can sit in two of
   * its racks. The challan line records this, and the ledger takes the stock out
   * of exactly here.
   */
  locationId: string;
  batchNumber: string;
  supplierBatchRef: string | null;
  manufacturerBatch: string | null;
  manufacturedDate: Date | null;
  expiryDate: Date | null;
  mrp: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  itemId: string;
  uomId: string | null;
  ownership: string;
  ownerPartyId: string | null;
  availableQty: Prisma.Decimal;
  /** What is LEFT is worth, summed in the same pass as the quantity. Present so a
   * caller showing cost per unit does not issue a `getBalance` per batch — that
   * was one query per row, which is invisible at three batches and is the whole
   * response time at three hundred. */
  value: Prisma.Decimal;
  /**
   * When this batch came onto the books. Load-bearing for DISPLAY since
   * 2026-08-14: references are deliberately not unique (Zoho allows duplicates
   * and so do we), so two live rows can both read `jv2` and the date is one of
   * the few things that tells them apart. `batchNumber` cannot — it is never
   * rendered.
   *
   * ⚠️ A proxy, not the goods-inward date: it is the row's creation time, not the
   * first inward ledger entry's `postedAt`. Close enough to identify a row, NOT
   * close enough for FIFO — allocate on the ledger date, or a backdated receipt
   * queues in the wrong place.
   */
  createdAt: Date;
}

/**
 * What is actually available to issue, at one location, for one item.
 *
 * 🔴 This reads the LEDGER, not the `batches` table. A batch row exists from the
 * moment it is created and goes on existing after every last metre of it has been
 * issued — "does a batch exist" and "is there any of it here" are different
 * questions, and answering the second with the first is how a picker offers
 * material that is already at the dyer's.
 *
 * `ownership` is a filter, not a display column: our own stock and a customer's
 * must never be offered in the same picker, because issuing one against the other
 * silently converts an asset into a liability.
 *
 * The positive-balance test happens in JS rather than SQL because Prisma's
 * `groupBy` cannot express `HAVING SUM(a) - SUM(b) > 0`. The grouped set is one
 * row per batch for one item at one location, which is small; if a real query ever
 * proves otherwise the fix is a raw `HAVING`, not a stored balance (§5.6).
 *
 * `search` and `limit` narrow what comes BACK, never what is counted: the balance
 * groupBy runs over everything, and the two only bound the batch rows hydrated for
 * a picker. So a limited result is a limited view of a complete answer, and no
 * total anywhere shifts because someone typed in a search box.
 */
export async function getAvailableBatches(
  tx: TenantClient,
  filter: {
    organizationId: string;
    itemId: string;
    locationId?: string;
    /** A whole dispatch site — every godown one challan may draw from. Rows come
     * back per (batch, location), so the caller knows where each balance is. */
    locationIds?: readonly string[];
    ownership?: Ownership;
    asOf?: Date;
    /** Batch number or the supplier's own reference — the two things printed on
     * the tag, and the only two a user can read off the goods. */
    search?: string;
    /** A ceiling on rows returned, for a picker that cannot render hundreds. */
    limit?: number;
  },
): Promise<AvailableBatch[]> {
  /**
   * 🔴 GROUPED BY (batch, LOCATION), not by batch (2026-08-14).
   *
   * A challan may now draw from every godown in a dispatch site, and one batch can
   * hold stock in two of them. Summing across the site would offer a single row
   * whose quantity exists in two places at once — the user would pick it, and the
   * ledger would take material out of a rack the vehicle never visited.
   *
   * One row per batch PER LOCATION is the honest unit, and it is also what the
   * challan line records.
   */
  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchId', 'locationId'],
    where: balanceWhere(filter),
    _sum: { qtyIn: true, qtyOut: true, valueIn: true, valueOut: true },
  });

  const zero = new Prisma.Decimal(0);
  const positive = grouped
    .map((row) => ({
      batchId: row.batchId,
      locationId: row.locationId,
      availableQty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
      value: (row._sum.valueIn ?? zero).minus(row._sum.valueOut ?? zero),
    }))
    .filter((row) => row.availableQty.greaterThan(0));

  if (positive.length === 0) return [];

  const batches = await tx.batch.findMany({
    where: {
      id: { in: positive.map((row) => row.batchId) },
      organizationId: filter.organizationId,
      isDeleted: false,
      // The picker's own search. Matches what is on the physical tag and nothing
      // else — `batchNumber` is never rendered, so it is never typed either
      // (2026-08-14). Same two columns as `batches.service.SEARCH_COLUMNS`.
      ...searchWhere<Prisma.BatchWhereInput>(filter.search, [
        'supplierBatchRef',
        'manufacturerBatch',
      ]),
    },
    // Ordered and capped HERE rather than after hydration, so a limit actually
    // bounds the rows the database builds.
    //
    // 🔴 Oldest first, NOT by `batchNumber` (2026-08-14). The number is invisible
    // now, so ordering by it produced a sequence nobody on screen could explain —
    // and, worse, the `take` then kept the LOWEST-numbered rows rather than the
    // oldest, so a capped list dropped exactly the stock FIFO wants issued first.
    orderBy: { createdAt: 'asc' },
    ...(filter.limit ? { take: filter.limit } : {}),
    select: {
      id: true,
      batchNumber: true,
      createdAt: true,
      supplierBatchRef: true,
      manufacturerBatch: true,
      manufacturedDate: true,
      expiryDate: true,
      mrp: true,
      sellingPrice: true,
      itemId: true,
      uomId: true,
      ownership: true,
      ownerPartyId: true,
    },
  });

  // Driven by the BALANCE rows, not the batch rows: a batch with stock in two
  // godowns of one site is two offers, and iterating batches would collapse it
  // back to one.
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  return positive.flatMap((balance) => {
    const batch = batchById.get(balance.batchId);
    return batch
      ? [
          {
            ...batch,
            batchId: batch.id,
            locationId: balance.locationId,
            availableQty: balance.availableQty,
            value: balance.value,
          },
        ]
      : [];
  });
}

export interface CreateBatchInput {
  organizationId: string;
  itemId: string;
  uomId?: string | null;
  /** Manual entry is allowed — mills carry the supplier's number on a physical
   * tag. Omit it and the org's `batch` sequence supplies one. */
  batchNumber?: string;
  /** 🔴 REQUIRED when the item is batch-tracked — it is the only label the user
   * ever sees for this batch. See the note in `createBatch`. */
  supplierBatchRef?: string | null;
  /** Real columns since 2026-08-13, not `customFields` 2014 fixed attributes every
   * org gets, and `expiryDate` is indexed because the expiry report is the reason
   * anyone records one. */
  manufacturerBatch?: string | null;
  manufacturedDate?: string | Date | null;
  expiryDate?: string | Date | null;
  mrp?: Prisma.Decimal | number | string | null;
  sellingPrice?: Prisma.Decimal | number | string | null;
  ownership?: Ownership;
  ownerPartyId?: string | null;
  /** Zero, one, or MANY — grey from two POs dyed together comes back as one batch. */
  parentBatchIds?: readonly string[];
  sourceDocType: string;
  sourceDocId?: string | null;
  customFields?: Prisma.InputJsonValue;
  userId?: string | null;
}

/**
 * Create a batch. The ONLY place a batch is born.
 *
 * A batch is mandatory internally and optional in the UI (§5.2.1): every ledger row
 * references one, but whether the user ever sees a batch number is per item
 * (`Item.inventoryTracking`). With `none` the system quietly creates one batch per
 * receipt and no batch field appears on screen — costing and the ledger still work.
 *
 * 🔴 `parentBatchIds` is written here or never. Genealogy cannot be reconstructed
 * from history that was never recorded, and a batch created without its parents is
 * permanently untraceable (§11.3).
 */
export async function createBatch(tx: TenantClient, input: CreateBatchInput) {
  const ownership: Ownership = input.ownership ?? 'own';

  // The one pair that makes inward jobwork work, so the pair is validated rather
  // than assumed. `customer` with no owner is a zero-value batch nobody can bill
  // for; `own` with an owner reads as someone else's goods in every report.
  if (ownership === 'customer' && !input.ownerPartyId) {
    throw ApiError.badRequest('Customer-owned stock needs the customer it belongs to.');
  }
  if (ownership === 'own' && input.ownerPartyId) {
    throw ApiError.badRequest('Only customer-owned stock may name an owning party.');
  }

  const item = await tx.item.findFirst({
    where: { id: input.itemId, organizationId: input.organizationId, isDeleted: false },
    select: { id: true, stockingUomId: true, inventoryTracking: true },
  });
  if (!item) throw ApiError.notFound('Item not found.');

  const manualNumber = input.batchNumber?.trim();
  const batchNumber = manualNumber || (await allocateNumber(tx, input.organizationId, 'batch'));

  /**
   * 🔴 A BATCH THE USER WILL SEE MUST CARRY A REFERENCE THEY SUPPLIED.
   *
   * `batchNumber` is an internal key and is deliberately never rendered, printed
   * or searched (2026-08-14) — it is this system's equivalent of Zoho's hidden
   * record id. That only works if every batch a user can SEE has a label of its
   * own, or the picker renders a blank row nobody can identify. So the reference
   * is required exactly where a batch is visible: `inventoryTracking = 'batch'`.
   *
   * An untracked item's batches are pure ledger plumbing — never listed, never
   * picked, consumed by FIFO — so demanding a human label for them would be
   * friction with nobody there to supply it (`items.service` creates them with no
   * user in the room). Zoho draws the line in exactly the same place: the
   * reference field appears only once batch tracking is on.
   *
   * NOT a database `NOT NULL`, because whether it is required depends on a column
   * on ANOTHER table. This function is the only place a batch is born, so it is
   * the only place the rule can live.
   */
  const supplierBatchRef = input.supplierBatchRef?.trim() || null;
  if (item.inventoryTracking === 'batch' && !supplierBatchRef) {
    throw ApiError.badRequest('This item is batch-tracked, so the batch needs a reference.', {
      supplierBatchRef: 'Enter the batch reference.',
    });
  }

  const data: BatchWriteData = {
    organizationId: input.organizationId,
    batchNumber,
    supplierBatchRef,
    manufacturerBatch: input.manufacturerBatch ?? null,
    manufacturedDate: toDate(input.manufacturedDate),
    expiryDate: toDate(input.expiryDate),
    mrp: toDecimalOrNull(input.mrp),
    sellingPrice: toDecimalOrNull(input.sellingPrice),
    itemId: item.id,
    // The batch's unit is the item's stocking unit — one item, one stocking
    // unit (§5.1). Passing it explicitly is only for the rare case where the
    // item's own is not yet set.
    uomId: input.uomId ?? item.stockingUomId,
    ownership,
    ownerPartyId: input.ownerPartyId ?? null,
    parentBatchIds: input.parentBatchIds ? [...input.parentBatchIds] : [],
    sourceDocType: input.sourceDocType,
    sourceDocId: input.sourceDocId ?? null,
    customFields: input.customFields ?? {},
  };

  if (manualNumber) {
    const recycled = await recycleDeletedBatch(tx, data, input.userId ?? null);
    if (recycled) return recycled;
  }

  return withUniqueViolation('Batch number already exists in this organization.', () =>
    tx.batch.create({
      data: { ...data, createdBy: input.userId ?? null, updatedBy: input.userId ?? null },
    }),
  );
}

/** Every scalar a batch is born with — shared by the create and the recycle below. */
interface BatchWriteData {
  organizationId: string;
  batchNumber: string;
  supplierBatchRef: string | null;
  manufacturerBatch: string | null;
  manufacturedDate: Date | null;
  expiryDate: Date | null;
  mrp: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  itemId: string;
  uomId: string | null;
  ownership: Ownership;
  ownerPartyId: string | null;
  parentBatchIds: string[];
  sourceDocType: string;
  sourceDocId: string | null;
  customFields: Prisma.InputJsonValue;
}

/**
 * Take over the row a soft-deleted batch left behind, when a hand-typed number
 * collides with it. Returns null when there is nothing to take over.
 *
 * A soft-deleted batch still occupies its number: `@@unique([organizationId,
 * batchNumber])` is a FULL index, and deliberately so — Prisma cannot express
 * `WHERE is_deleted = false`, so a partial one would read as permanent drift
 * (the same call as `migrations/20260725140000_membership_is_owner_.../
 * migration.sql:55`). Without this the number a mis-entry once held would be
 * refused forever, and a batch number is printed on a tag stuck to a roll.
 *
 * 🔴 Only for a HAND-TYPED number. An allocated one landing on a dead batch means
 * the sequence caught up with something a user typed earlier; adopting an
 * unrelated row there would be a silent data bug, not a convenience.
 *
 * 🔴 Only when the dead batch never moved stock. `getBalance` sums by `batchId` and
 * a ledger row is never deleted, so recycling a batch that has entries would hand
 * the new batch the old one's balance. That number stays occupied — permanently.
 */
async function recycleDeletedBatch(tx: TenantClient, data: BatchWriteData, userId: string | null) {
  const dead = await tx.batch.findFirst({
    where: {
      organizationId: data.organizationId,
      batchNumber: data.batchNumber,
      isDeleted: true,
    },
    select: { id: true },
  });
  if (!dead) return null;

  const movements = await tx.stockLedgerEntry.count({ where: { batchId: dead.id } });
  if (movements > 0) {
    throw ApiError.conflict(
      'That batch number belongs to a deleted batch that has already moved stock, so it cannot be reused.',
    );
  }

  // Compare-and-swap on `isDeleted`, not a plain update: two saves racing on the
  // same typed number would otherwise both "win" and quietly become one batch. The
  // loser falls through to the create below and gets its 409.
  const claimed = await tx.batch.updateMany({
    where: { id: dead.id, organizationId: data.organizationId, isDeleted: true },
    // A recycled row is a NEW batch, so `createdBy` is whoever is entering it now.
    // Keeping the original would attribute this batch to someone who never saw it.
    data: { ...data, state: 'open', isDeleted: false, createdBy: userId, updatedBy: userId },
  });
  if (claimed.count === 0) return null;

  return tx.batch.findFirstOrThrow({ where: { id: dead.id } });
}
