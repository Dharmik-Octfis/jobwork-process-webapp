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
  /**
   * WHICH PACKAGE inside the batch moved — a taka, roll, bale. Optional, and the
   * absence is meaningful: an org with no unit level, an item that shows no batch
   * field, and the untagged remainder of a batch that DOES have units all leave
   * it null. See the invariant `assertUnitsFitBatch` holds below.
   */
  batchUnitId?: string | null;
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

/** The five fields a ledger row copies off its batch. */
interface BatchForPosting {
  id: string;
  itemId: string;
  uomId: string | null;
  ownership: string;
  ownerPartyId: string | null;
}

interface PostableBatch extends BatchForPosting {
  /**
   * How many `batch_units` hang off this batch — soft-deleted ones included, on
   * purpose. A deleted unit still owns whatever the ledger posted against it, so
   * it still counts toward `SUM(units)`; and the only cost of an over-count is
   * running a check that then passes.
   *
   * 🔴 This is what keeps the unit invariant free for every org that never turns
   * the level on. Zero here and an untagged outward row skips the aggregate
   * entirely — which is every ledger row written before this feature existed.
   *
   * `undefined` means NOT KNOWN, not zero: a caller that hoisted its batches
   * before this field existed hands rows without it, and `postMovement` then
   * counts for itself rather than assuming the safe-looking answer. Fails toward
   * one extra query, never toward skipping the check.
   */
  unitCount?: number;
}

/** What a batch read has to select for a row to be postable against it. */
const POSTABLE_BATCH_SELECT = {
  id: true,
  itemId: true,
  uomId: true,
  ownership: true,
  ownerPartyId: true,
  _count: { select: { batchUnits: true } },
} as const;

function toPostableBatch(row: BatchForPosting & { _count: { batchUnits: number } }): PostableBatch {
  const { _count, ...rest } = row;
  return { ...rest, unitCount: _count.batchUnits };
}

/**
 * Batches already read, for a caller about to post a run of movements.
 *
 * 🔴 THIS IS A READ THE CALLER HOISTED, NOT VALUES THE CALLER SUPPLIED. It can
 * only be built by `resolveBatchesForPosting` or from a row `createBatch` just
 * returned, so the four copied fields still come from the batch itself — which is
 * the whole invariant `postMovement` exists to hold.
 */
export type ResolvedBatches = ReadonlyMap<string, PostableBatch>;

/**
 * The batches a run of movements will post against, in ONE query.
 *
 * 🔴 `postMovement` reads its batch on every call, so posting 50 takas was 50
 * reads of a handful of rows on the transaction's single connection — the N+1
 * `postMovements` warned about in its own comment (2026-09-01). Hoist the read
 * with this and hand the result to each post.
 *
 * ⚠️ Resolve IMMEDIATELY BEFORE the run and never across a batch mutation. A
 * batch soft-deleted after it was resolved is still in the map, and posting
 * against it would walk straight past the `isDeleted` guard below —
 * `items.service` really does soft-delete a batch mid-transaction. A batch the
 * query does not find is simply absent, and the post falls back to reading it.
 */
export async function resolveBatchesForPosting(
  tx: TenantClient,
  organizationId: string,
  batchIds: readonly string[],
): Promise<ResolvedBatches> {
  const ids = [...new Set(batchIds)];
  if (ids.length === 0) return new Map();

  const rows = await tx.batch.findMany({
    where: { id: { in: ids }, organizationId, isDeleted: false },
    select: POSTABLE_BATCH_SELECT,
  });
  return new Map(rows.map((row) => [row.id, toPostableBatch(row)]));
}

/**
 * One batch just returned by `createBatch`, as a map for a single post — the
 * common shape, where a batch is created and immediately posted into.
 *
 * `unitCount` defaults to 0 because a batch `createBatch` has just minted holds
 * no units yet. A caller that then adds some passes the count back in, so the
 * untagged remainder posted against the same batch is still checked.
 */
export function asResolvedBatch(batch: BatchForPosting, unitCount = 0): ResolvedBatches {
  const { id, itemId, uomId, ownership, ownerPartyId } = batch;
  return new Map([[id, { id, itemId, uomId, ownership, ownerPartyId, unitCount }]]);
}

/**
 * 🔴 Post one movement.
 *
 * `itemId`, `uomId`, `ownership` and `ownerPartyId` are copied off the BATCH, never
 * taken from the caller. A ledger row that claims a different item or a different
 * owner from its own batch is not a number that can be corrected later — it is a
 * row no report can interpret. Making the batch the single source for those four
 * means a caller cannot get them wrong, only the batch can, and the batch is
 * written in exactly one place (`createBatch`).
 *
 * `batches` only changes WHERE that row was read, never that it was read: a
 * caller with a run of movements resolves them once (`resolveBatchesForPosting`)
 * instead of paying a query per post. A miss falls through to the read, so an
 * incomplete map costs a query and cannot produce a wrong row.
 */
export async function postMovement(
  tx: TenantClient,
  input: PostMovementInput,
  batches?: ResolvedBatches,
) {
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

  const batch =
    batches?.get(input.batchId) ??
    (await tx.batch
      .findFirst({
        where: { id: input.batchId, organizationId: input.organizationId, isDeleted: false },
        select: POSTABLE_BATCH_SELECT,
      })
      .then((row) => (row ? toPostableBatch(row) : null)));
  if (!batch) throw ApiError.notFound('Batch not found.');

  const batchUnitId = input.batchUnitId ?? null;
  if (batchUnitId) {
    // Re-read for exactly the reason the batch itself is re-read: a unit that
    // belongs to another batch — or another ORGANIZATION — is not a number that
    // can be corrected later, it is a row no report can interpret.
    const unit = await tx.batchUnit.findFirst({
      where: {
        id: batchUnitId,
        batchId: batch.id,
        organizationId: input.organizationId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!unit) throw ApiError.notFound('Batch unit not found on this batch.');
  } else if (!qtyOut.isZero()) {
    const unitCount =
      batch.unitCount ?? (await tx.batchUnit.count({ where: { batchId: batch.id } }));
    if (unitCount > 0) {
      await assertUnitsFitBatch(tx, {
        organizationId: input.organizationId,
        batchId: batch.id,
        locationId: input.locationId,
        leaving: qtyOut,
      });
    }
  }

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
      batchUnitId,
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
 * 🔴 THE INVARIANT THAT MAKES AN OPTIONAL UNIT LEVEL SAFE.
 *
 * Units are optional, so someone can issue from a batch WITHOUT naming one. If
 * B-1 holds 5000 across T-1/T-2/T-3 and an untagged issue takes 4000, the units
 * would go on claiming 5000 while the batch holds 1000 — and nothing anywhere
 * would say so, because both figures are derived from rows that are each
 * individually correct.
 *
 * So, for one batch at one location:
 *
 *     SUM(unit in − unit out)  ≤  SUM(batch in − batch out)
 *
 * An untagged movement that would break it is refused BY NAME, in the same shape
 * as the existing "Batch X has N available, but M is being issued."
 *
 * ⚠️ Only untagged OUTWARD rows can break it, which is why this runs nowhere
 * else. A tagged movement moves both sides of the inequality by the same amount,
 * and an inward row only ever raises the right-hand side.
 *
 * Corollary, and it is not a defect: this is an INEQUALITY. A batch of 5000 whose
 * units total 3000 has 2000 loose, which is physically real — every picker
 * renders it as an explicit unallocated row so nobody thinks the system lost it.
 *
 * One grouped query, never one per unit: the rows come back keyed by unit and are
 * summed here, over the `(organization_id, batch_id, batch_unit_id, location_id)`
 * index added with the feature.
 */
async function assertUnitsFitBatch(
  tx: TenantClient,
  args: {
    organizationId: string;
    batchId: string;
    locationId: string;
    leaving: Prisma.Decimal;
  },
) {
  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchUnitId'],
    where: {
      organizationId: args.organizationId,
      batchId: args.batchId,
      locationId: args.locationId,
    },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  let batchQty = zero;
  let unitQty = zero;
  for (const row of grouped) {
    const qty = (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero);
    batchQty = batchQty.plus(qty);
    if (row.batchUnitId !== null) unitQty = unitQty.plus(qty);
  }

  const untagged = batchQty.minus(unitQty);
  if (args.leaving.greaterThan(untagged)) {
    const batch = await tx.batch.findUnique({
      where: { id: args.batchId },
      select: { supplierBatchRef: true },
    });
    // The reference, not the internal number — the number is never rendered, so
    // it is not something the user can find on their own screen.
    const label = batch?.supplierBatchRef ?? 'this batch';
    throw ApiError.badRequest(
      `Batch ${label} holds ${batchQty.toString()} here, of which ${unitQty.toString()} is ` +
        `already assigned to individual units. Only ${untagged.toString()} can leave without ` +
        `naming a unit, but ${args.leaving.toString()} is being taken. Pick the units to send, ` +
        'or free some up first.',
      { batches: `${label}: only ${untagged.toString()} is unassigned.` },
    );
  }
}

/**
 * Post several movements in order. Still a loop, not a `createMany`: every row goes
 * through `postMovement`'s validation, so a batch cannot smuggle past the checks a
 * single post has to satisfy. What is no longer per-row is the BATCH READ —
 * resolved once here (2026-09-01), which is the caching this comment used to say
 * was the fix if 50 takas ever became a measured problem.
 */
export async function postMovements(tx: TenantClient, inputs: readonly PostMovementInput[]) {
  if (inputs.length === 0) return [];

  // One tenant per transaction, so one resolve covers the run. If a caller ever
  // mixed organizations, the odd one out simply misses the map and reads itself.
  const batches = await resolveBatchesForPosting(
    tx,
    inputs[0]!.organizationId,
    inputs.map((input) => input.batchId),
  );

  const rows = [];
  for (const input of inputs) rows.push(await postMovement(tx, input, batches));
  return rows;
}

export interface BalanceFilter {
  organizationId: string;
  itemId?: string;
  /**
   * Several items at once — one step's whole CONSUMES list (2026-09-01). The Issue
   * dialog asks about every input item together rather than once per item, which
   * turned N transactions and N pooled connections into one.
   *
   * Ignored when `itemId` is set; a caller that names one item means it.
   */
  itemIds?: readonly string[];
  batchId?: string;
  /**
   * ONE PACKAGE inside the batch — and the three states are three different
   * questions, so the tri-state is deliberate:
   *
   *   `undefined` — every row, tagged or not. The batch's own balance.
   *   `'<id>'`    — that package alone.
   *   `null`      — the UNTAGGED remainder alone, which is a real balance a
   *                 caller has to be able to ask about: it is what may leave
   *                 without naming a package, and what opening stock settles
   *                 when the user edits a batch's total rather than its packages.
   */
  batchUnitId?: string | null;
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
    ...(filter.itemId
      ? { itemId: filter.itemId }
      : filter.itemIds
        ? { itemId: { in: [...filter.itemIds] } }
        : {}),
    ...(filter.batchId ? { batchId: filter.batchId } : {}),
    // `!== undefined`, never a truthiness test: `null` here means "the untagged
    // rows", which is a narrower question than "all rows" and not the same answer.
    ...(filter.batchUnitId !== undefined ? { batchUnitId: filter.batchUnitId } : {}),
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

/**
 * WHERE this item is, in one query — keyed by location.
 *
 * 🔴 A "stock by location" view has to START from the ledger. The Item page used to
 * build its location list from the opening-stock document and then ask
 * `getBalance` about each one, which meant it could only ever show the places some
 * other document happened to mention: 5,000 metres sitting at a dyer on a job
 * issue rendered as a zero, because no opening stock had ever been declared there
 * (2026-08-17). Balances were right; the set of locations was not.
 *
 * Also one grouped query instead of one aggregate per location.
 *
 * Locations with a zero net balance are still returned — the caller decides
 * whether "declared here, none left" is worth a row. Negative balances are
 * returned too, deliberately: that is a data problem someone needs to SEE.
 */
export async function getBalanceByLocation(
  tx: TenantClient,
  filter: Omit<BalanceFilter, 'locationId' | 'locationIds'>,
): Promise<Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>> {
  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['locationId'],
    where: balanceWhere(filter),
    _sum: { qtyIn: true, qtyOut: true, valueIn: true, valueOut: true },
  });

  const zero = new Prisma.Decimal(0);
  return new Map(
    grouped.map((row) => [
      row.locationId,
      {
        qty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
        value: (row._sum.valueIn ?? zero).minus(row._sum.valueOut ?? zero),
      },
    ]),
  );
}

/**
 * WHERE EACH OF SEVERAL BATCHES IS, in ONE query — keyed `batchId` → `locationId`.
 *
 * 🔴 One grouped query, never `getBalance` per batch. The picker this feeds shows
 * a dozen batches each sitting in a handful of places; asked row by row that is
 * fifty round trips, which is nothing at three batches and is the entire response
 * at three hundred — the same trap `getAvailableStock` documents.
 *
 * Locations with a zero net balance still come back, and that is the point here:
 * a batch that was received into a godown and then wholly issued onward is
 * exactly the batch a second delivery wants to continue. Filtering it out is how
 * the right answer disappears the moment the stock moves.
 */
export async function getBalancesByBatchAndLocation(
  tx: TenantClient,
  filter: Omit<BalanceFilter, 'batchId' | 'locationId' | 'locationIds'> & {
    batchIds: readonly string[];
  },
): Promise<Map<string, Map<string, Prisma.Decimal>>> {
  if (filter.batchIds.length === 0) return new Map();

  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchId', 'locationId'],
    where: { ...balanceWhere(filter), batchId: { in: [...filter.batchIds] } },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  const byBatch = new Map<string, Map<string, Prisma.Decimal>>();
  for (const row of grouped) {
    const qty = (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero);
    const byLocation = byBatch.get(row.batchId) ?? new Map<string, Prisma.Decimal>();
    byLocation.set(row.locationId, qty);
    byBatch.set(row.batchId, byLocation);
  }
  return byBatch;
}

/**
 * The balance of each of several batches AT ONE LOCATION — quantity AND value, in
 * one query, keyed by `batchId`.
 *
 * 🔴 The value is what separates this from `getBalancesByBatchAndLocation` above,
 * which sums quantity alone. A caller that prices what it consumes needs both, and
 * getting them with a `getBalance` per batch is one round trip per row on a
 * transaction's single connection — `jobReceipts.createJobReceipt` was doing
 * exactly that (2026-09-01).
 *
 * A batch the ledger has never touched at this location is simply absent; the
 * caller reads that as a zero balance, which is what `getBalance` returned for it.
 */
export async function getBalancesByBatch(
  tx: TenantClient,
  filter: Omit<BalanceFilter, 'batchId'> & { batchIds: readonly string[] },
): Promise<Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>> {
  if (filter.batchIds.length === 0) return new Map();

  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchId'],
    where: { ...balanceWhere(filter), batchId: { in: [...filter.batchIds] } },
    _sum: { qtyIn: true, qtyOut: true, valueIn: true, valueOut: true },
  });

  const zero = new Prisma.Decimal(0);
  return new Map(
    grouped.map((row) => [
      row.batchId,
      {
        qty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
        value: (row._sum.valueIn ?? zero).minus(row._sum.valueOut ?? zero),
      },
    ]),
  );
}

export interface MultiAxisBalance {
  physicalQty: Prisma.Decimal;
  accountingQty: Prisma.Decimal;
  value: Prisma.Decimal;
}

/**
 * Both axes and the value in ONE pass, where `getBalance` would need two calls.
 *
 * ⚠️ Raw SQL, so the column names are the DATABASE's, not Prisma's. Three of them
 * were camelCase here until 2026-09-01 — `organizationId`, `itemId`,
 * `locationId` — which meant this function threw `column does not exist` the
 * first time anything called it. Nothing ever did, which is the only reason it
 * survived; it was found while planning the unit level, whose reporting queries
 * are exactly what would have adopted it.
 */
export async function getBalances(
  tx: TenantClient,
  filter: BalanceFilter & { batchUnitId?: string },
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
  if (filter.batchUnitId) q = Prisma.sql`${q} AND batch_unit_id = ${filter.batchUnitId}::uuid`;
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
 * What is actually available to issue, at one location, for one item — or, since
 * 2026-09-01, for SEVERAL items in one round trip.
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
 *
 * 🔴 `limit` IS PER ITEM, which is what forces the two capping paths below. A
 * single `take` across several items would let one item with three hundred live
 * batches eat the whole ceiling and hand the rest an empty picker.
 */
export async function getAvailableBatches(
  tx: TenantClient,
  filter: {
    organizationId: string;
    itemId?: string;
    /** Several items in one query. Ignored when `itemId` is set. */
    itemIds?: readonly string[];
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

  // One item asked about means the cap can go into the database, where a ceiling
  // belongs. Several means it cannot — see the note on `limit` above.
  const oneItem = Boolean(filter.itemId) || filter.itemIds?.length === 1;

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
    ...(filter.limit && oneItem ? { take: filter.limit } : {}),
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

  // The multi-item path's cap, applied to rows the database already ordered
  // oldest-first — so it keeps exactly the batches FIFO wants issued first,
  // which is what the database-side `take` keeps for one item.
  const capped =
    filter.limit && !oneItem
      ? keepPerItem(batches, filter.limit)
      : new Set(batches.map((b) => b.id));

  /**
   * Driven by the BALANCE rows, not the batch rows: a batch with stock in two
   * godowns of one site is two offers, and iterating batches would collapse it
   * back to one.
   *
   * 🔴 SO THE RETURNED ORDER IS THE BALANCE `groupBy`'S, WHICH IS TO SAY NONE.
   * The `orderBy: createdAt` above decides which rows survive `limit`; it does
   * NOT survive this flatMap. A caller that needs oldest-first must sort for
   * itself — `jobIssues.resolveLines` and `assemblies.allocateComponents` both
   * do, on the earliest INWARD ledger entry rather than on `createdAt`, because a
   * batch created on Friday for goods that arrived Monday must queue by Monday.
   *
   * Assuming this was already sorted consumed the NEWEST stock first and passed
   * every test that did not check which batch moved (2026-09-02).
   */
  const batchById = new Map(
    batches.filter((batch) => capped.has(batch.id)).map((batch) => [batch.id, batch]),
  );
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

/** The first `limit` rows of each item, taking `rows` in the order given. */
function keepPerItem(rows: readonly { id: string; itemId: string }[], limit: number): Set<string> {
  const kept = new Set<string>();
  const taken = new Map<string, number>();
  for (const row of rows) {
    const count = taken.get(row.itemId) ?? 0;
    if (count >= limit) continue;
    taken.set(row.itemId, count + 1);
    kept.add(row.id);
  }
  return kept;
}

/**
 * The balance of every UNIT of several batches, at one location or across a set
 * — one grouped query, keyed `batchId` → `batchUnitId` → qty.
 *
 * 🔴 The N+1 guard, and the reason this is a sibling of
 * `getBalancesByBatchAndLocation` rather than a parameter on it. A picker showing
 * a dozen batches each holding several units is fifty round trips if asked row by
 * row — invisible at three and the entire response time at three hundred.
 *
 * The **`null` key is part of the answer, not noise**: it is the batch's untagged
 * remainder, which is legal (units are an inequality, never an equality) and must
 * be rendered so nobody thinks the system lost it.
 *
 * Zero and negative balances come back untouched, exactly as the sibling does — a
 * unit that has wholly left is still the right answer to "where did T-1 go", and a
 * negative is a data problem someone needs to SEE.
 */
export async function getBalancesByBatchUnit(
  tx: TenantClient,
  filter: Omit<BalanceFilter, 'batchId'> & { batchIds: readonly string[] },
): Promise<Map<string, Map<string | null, Prisma.Decimal>>> {
  if (filter.batchIds.length === 0) return new Map();

  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchId', 'batchUnitId'],
    where: { ...balanceWhere(filter), batchId: { in: [...filter.batchIds] } },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  const byBatch = new Map<string, Map<string | null, Prisma.Decimal>>();
  for (const row of grouped) {
    const byUnit = byBatch.get(row.batchId) ?? new Map<string | null, Prisma.Decimal>();
    byUnit.set(row.batchUnitId, (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero));
    byBatch.set(row.batchId, byUnit);
  }
  return byBatch;
}

export interface AvailableBatchUnit {
  batchUnitId: string;
  batchId: string;
  /** WHERE this unit is. A unit has no location of its own — location lives on
   * the movement, which is what lets one sit at the dyer's. */
  locationId: string;
  seq: number;
  label: string;
  uomId: string | null;
  availableQty: Prisma.Decimal;
}

/**
 * What units are actually there to pick, for a set of batches.
 *
 * A sibling of `getAvailableBatches`, not a flag on it, for the same reason the
 * balance helper above is: the two answer different questions and a caller
 * usually wants the batch list first and the units of the ones it kept second.
 *
 * 🔴 Reads the LEDGER, not `batch_units`. A unit row exists from the moment it is
 * created and goes on existing after every last metre of it has left — "does this
 * unit exist" and "is any of it here" are different questions, and answering the
 * second with the first is how a picker offers a roll that is already at the
 * dyer's.
 *
 * The untagged remainder is deliberately NOT returned here: it belongs to no unit,
 * so it has no row to be. Callers render it from the batch balance minus the sum
 * of these — `getBalancesByBatchUnit` hands them both sides in one query.
 */
export async function getAvailableBatchUnits(
  tx: TenantClient,
  filter: Omit<BalanceFilter, 'batchId'> & { batchIds: readonly string[] },
): Promise<AvailableBatchUnit[]> {
  if (filter.batchIds.length === 0) return [];

  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ['batchId', 'batchUnitId', 'locationId'],
    where: {
      ...balanceWhere(filter),
      batchId: { in: [...filter.batchIds] },
      batchUnitId: { not: null },
    },
    _sum: { qtyIn: true, qtyOut: true },
  });

  const zero = new Prisma.Decimal(0);
  // The positive test is in JS because Prisma's `groupBy` cannot express
  // `HAVING SUM(a) - SUM(b) > 0` — same call, and same reasoning, as
  // `getAvailableBatches`.
  const positive = grouped
    .map((row) => ({
      batchId: row.batchId,
      batchUnitId: row.batchUnitId!,
      locationId: row.locationId,
      availableQty: (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
    }))
    .filter((row) => row.availableQty.greaterThan(0));

  if (positive.length === 0) return [];

  const units = await tx.batchUnit.findMany({
    where: {
      id: { in: positive.map((row) => row.batchUnitId) },
      organizationId: filter.organizationId,
      isDeleted: false,
    },
    orderBy: { seq: 'asc' },
    select: { id: true, seq: true, label: true, uomId: true },
  });
  const unitById = new Map(units.map((unit) => [unit.id, unit]));

  // Driven by the BALANCE rows: one unit split across two godowns of a dispatch
  // site is two offers, and iterating the unit rows would collapse it back to one.
  return positive
    .flatMap((balance) => {
      const unit = unitById.get(balance.batchUnitId);
      return unit
        ? [
            {
              batchUnitId: unit.id,
              batchId: balance.batchId,
              locationId: balance.locationId,
              seq: unit.seq,
              label: unit.label,
              uomId: unit.uomId,
              availableQty: balance.availableQty,
            },
          ]
        : [];
    })
    .sort((a, b) => a.seq - b.seq);
}

/** One package the user typed into the grid: a label and how much is in it. */
export interface BatchUnitInput {
  /** Free text — "T-1", or whatever the supplier printed on the tag. **Optional
   * since 2026-09-03**: blank means "this roll carries no tag of its own", and it
   * is auto-named from `seq`. Only the quantity is required. */
  label?: string | null;
  /** Becomes this unit's `qty_in` on the movement the CALLER then posts. It is
   * never stored on the row — see the model comment. */
  qty: Prisma.Decimal | number | string;
}

/**
 * The name a package gets when the user typed none.
 *
 * 🔴 `#seq`, not the org's word for the level ("Taka 3"). The level is RENAMEABLE
 * per org, and a stored label does not follow a rename — a company that switched
 * from "Taka" to "Roll" would be left with rolls called "Taka 3" forever. `#3` is
 * a position and stays true whatever the level is called; the column header
 * beside it already says which level that is.
 *
 * It also stays unique for free: `seq` is unique inside the batch and never
 * reused, so two auto-named packages can never collide. Only a HAND-TYPED "#3"
 * can, and that is refused loudly below rather than silently merged.
 */
export const autoUnitLabel = (seq: number) => `#${seq}`;

/**
 * Create the packages inside a batch. The ONLY place a `batch_units` row is born.
 *
 * 🔴 A SIBLING OF `createBatch`, not an argument to it, and the reason is the
 * top-up case: a second delivery adds units to a batch an earlier document
 * created, so the two events are genuinely separate and a caller needs to reach
 * the second without the first.
 *
 * `seq` is allocated as `MAX(seq) + 1` over ALL rows of the batch, soft-deleted
 * ones included — a deleted unit still owns whatever the ledger posted against
 * it, and `@@unique([batchId, seq])` is a FULL index (Prisma cannot express a
 * partial one, so a partial index would read as permanent drift). Handing a dead
 * unit's number to a live one would merge two histories under one label.
 *
 * 🔴 A BLANK LABEL IS LEGAL AND IS AUTO-FILLED (2026-09-03) — only the quantity is
 * required. The column stays NOT NULL and every read surface keeps working
 * untouched; what changed is that the user no longer has to invent a tag for a
 * roll that does not carry one. Nothing about tracking depended on the label:
 * quantity and value both hang off `stock_ledger.batch_unit_id`, which is a uuid.
 *
 * Returns the created rows in payload order, each carrying the `qty` it was asked
 * for, so the caller can post one movement per unit without re-pairing anything.
 */
export async function createBatchUnits(
  tx: TenantClient,
  input: {
    organizationId: string;
    batchId: string;
    units: readonly BatchUnitInput[];
    uomId?: string | null;
    sourceDocType?: string | null;
    sourceDocId?: string | null;
    userId?: string | null;
  },
): Promise<{ id: string; seq: number; label: string; qty: Prisma.Decimal }[]> {
  const cleaned = input.units
    .map((unit) => ({ label: unit.label?.trim() ?? '', qty: toDecimal(unit.qty) }))
    .filter((unit) => unit.label !== '' || !unit.qty.isZero());
  if (cleaned.length === 0) return [];

  for (const unit of cleaned) {
    if (!unit.qty.greaterThan(0)) {
      throw ApiError.badRequest(
        `${unit.label || 'This unit'} needs a quantity greater than zero.`,
        { units: `${unit.label || 'Every unit'} needs a quantity greater than zero.` },
      );
    }
  }

  /**
   * 🔴 `seq` IS ALLOCATED BEFORE THE LABELS ARE CHECKED, because since 2026-09-03
   * it is what an unlabelled package is NAMED after — a blank label is auto-filled
   * with `#seq`. Doing the duplicate check first would check names that did not
   * exist yet and let a hand-typed "#4" through beside an auto-named one.
   *
   * Still `MAX(seq) + 1` over ALL rows, soft-deleted ones included, so a dead
   * package's number is never handed to a live one — that would merge two
   * histories under one name, and now under one LABEL as well.
   */
  const highest = await tx.batchUnit.aggregate({
    where: { batchId: input.batchId },
    _max: { seq: true },
  });
  const base = (highest._max.seq ?? 0) + 1;
  const numbered = cleaned.map((unit, index) => ({
    ...unit,
    seq: base + index,
    /** Whether the name is the user's or ours — only the message differs, but a
     * conflict on a name nobody typed has to explain itself. */
    autoNamed: unit.label === '',
    resolvedLabel: unit.label || autoUnitLabel(base + index),
  }));

  // Two units of one batch may not share a label — they are physical tags, and a
  // picker showing "T-1" twice cannot be used. Checked against the whole batch,
  // not just this payload, so a top-up cannot re-use a label either.
  const existing = await tx.batchUnit.findMany({
    where: { batchId: input.batchId, organizationId: input.organizationId, isDeleted: false },
    select: { label: true },
  });
  const seen = new Set(existing.map((unit) => unit.label.toLowerCase()));
  for (const unit of numbered) {
    const key = unit.resolvedLabel.toLowerCase();
    if (seen.has(key)) {
      throw ApiError.conflict(
        unit.autoNamed
          ? `This batch already has a unit labelled "${unit.resolvedLabel}", which is the ` +
              'name an unlabelled one would be given. Name it yourself, or rename that one.'
          : `Unit ${unit.resolvedLabel} already exists in this batch.`,
      );
    }
    seen.add(key);
  }

  const created = [];
  for (const unit of numbered) {
    const row = await withUniqueViolation(
      `Unit ${unit.resolvedLabel} already exists in this batch.`,
      () =>
        tx.batchUnit.create({
          data: {
            organizationId: input.organizationId,
            batchId: input.batchId,
            seq: unit.seq,
            label: unit.resolvedLabel,
            uomId: input.uomId ?? null,
            sourceDocType: input.sourceDocType ?? null,
            sourceDocId: input.sourceDocId ?? null,
            createdBy: input.userId ?? null,
            updatedBy: input.userId ?? null,
          },
          select: { id: true, seq: true, label: true },
        }),
    );
    created.push({ ...row, qty: unit.qty });
  }
  return created;
}

export interface ExistingBatchUnitInput {
  /** A `batch_units.id` the caller wants to post MORE quantity onto. */
  batchUnitId: string;
  qty: Prisma.Decimal | number | string;
}

/**
 * Resolve packages that already exist, for a document adding quantity to them.
 *
 * 🔴 THE SIBLING OF `createBatchUnits`, and the split is the point. A package is
 * born once and its label is a physical tag, so `createBatchUnits` refuses a
 * label the batch already holds. Topping one up is therefore NOT a create with a
 * duplicate label — it is a second movement against the row that already exists,
 * which is what this resolves and nothing else does.
 *
 * Every id is checked to belong to THIS batch, not merely to the organization: a
 * unit id from another batch would otherwise post stock into a roll of a
 * different lot, and RLS cannot see the difference because both are ours.
 *
 * Returns rows in payload order carrying the `qty` asked for, so the caller posts
 * one movement per unit exactly as it does for created ones.
 */
export async function resolveExistingBatchUnits(
  tx: TenantClient,
  input: {
    organizationId: string;
    batchId: string;
    units: readonly ExistingBatchUnitInput[];
  },
): Promise<{ id: string; seq: number; label: string; qty: Prisma.Decimal }[]> {
  const cleaned = input.units.map((unit) => ({
    batchUnitId: unit.batchUnitId,
    qty: toDecimal(unit.qty),
  }));
  if (cleaned.length === 0) return [];

  for (const unit of cleaned) {
    if (!unit.qty.greaterThan(0)) {
      throw ApiError.badRequest('Every unit needs a quantity greater than zero.', {
        units: 'Enter a quantity greater than zero for each unit.',
      });
    }
  }

  // One roll cannot be topped up twice in one document — the two rows would be
  // indistinguishable afterwards, and the user meant one number.
  const ids = cleaned.map((unit) => unit.batchUnitId);
  if (new Set(ids).size !== ids.length) {
    throw ApiError.badRequest('The same unit is listed twice in this batch.', {
      units: 'Each existing unit can be added to once — combine the quantities.',
    });
  }

  // One grouped read, never one per id.
  const rows = await tx.batchUnit.findMany({
    where: {
      id: { in: ids },
      batchId: input.batchId,
      organizationId: input.organizationId,
      isDeleted: false,
    },
    select: { id: true, seq: true, label: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return cleaned.map((unit) => {
    const row = byId.get(unit.batchUnitId);
    if (!row) {
      throw ApiError.badRequest('That unit is not part of this batch.', {
        units: 'One of the units picked no longer belongs to this batch. Refresh and try again.',
      });
    }
    return { ...row, qty: unit.qty };
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
 * `WHERE isDeleted = false`, so a partial one would read as permanent drift
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
