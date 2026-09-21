import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateBillPayload, UpdateBillPayload, BillItemPayload } from './bills.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import { splitByQty } from '../../../lib/splitByQty.ts';
import { consumersOfEntries } from '../../inventory/stock-ledger/costLayers.ts';
import { validateCustomFields } from '../../settings/customization/custom-fields/customFields.engine.ts';
import { loadActiveDefinitions } from '../../settings/customization/custom-fields/custom-fields.service.ts';
import {
  asResolvedBatch,
  postMovement,
  createBatch,
  createBatchUnits,
  resolveBatchesForPosting,
  resolveExistingBatchUnits,
  type ResolvedBatches,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { approvalTriggerService } from '../../automation/approval-processes/approvalTrigger.service.ts';

const DUPLICATE_NUMBER = 'A bill with this number already exists.';

/** Same tolerance `assertAllocationsBalance` uses one level up: an exact
 * comparison rejects `3 × 33.3333` for being a billionth off. */
const QTY_EPSILON = 0.00005;

/**
 * Prisma's default interactive-transaction budget is 5 seconds. A fifty-taka
 * consignment already posts fifty rows through `postMovement` on the way in;
 * editing one now reverses those fifty before re-posting, so the write is twice
 * what it was. Same figures and the same reasoning as `DOCUMENT_TX` in
 * `jobwork.types.ts` — duplicated rather than imported, as `assemblies.service`
 * does, because purchases must not depend on jobwork.
 */
const DOCUMENT_TX = { maxWait: 15_000, timeout: 120_000 } as const;

function runAsDocument<T>(orgId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  return runAsTenant(orgId, fn, DOCUMENT_TX);
}

type BillBatchPayload = NonNullable<BillItemPayload['batches']>[number];

/**
 * 🔴 WHAT A BILL LINE COST US — `qty × rate` less the line's discount, never below
 * zero, and recomputed here rather than trusting the client's `amount` (FIFO plan
 * §5.1). This is the value its cost layers carry; `qty × rate` alone overstated
 * every discounted purchase in stock and in everything costed from it.
 *
 * Reads `discount` as well as `discountAmount` because "Open Bill" re-posts the
 * stored line rows, whose column is named `discount`.
 */
function lineNetValue(line: {
  quantity?: unknown;
  rate?: unknown;
  discountAmount?: unknown;
  discount?: unknown;
}): Prisma.Decimal {
  const num = (value: unknown) => new Prisma.Decimal(Number(value ?? 0) || 0);
  const gross = num(line.quantity).times(num(line.rate));
  const discount = num(line.discountAmount ?? line.discount);
  return Prisma.Decimal.max(gross.minus(discount), new Prisma.Decimal(0)).toDecimalPlaces(4);
}

/** One batch's share of its line's net value, by quantity. */
function batchValue(payload: BillItemPayload, batchQty: unknown): Prisma.Decimal {
  const lineQty = Number(payload.quantity ?? 0);
  if (!(lineQty > 0)) return new Prisma.Decimal(0);
  return lineNetValue(payload)
    .times(Number(batchQty ?? 0) || 0)
    .dividedBy(lineQty)
    .toDecimalPlaces(4);
}

/**
 * Where an Open bill's stock lands. Checked at the posting, not folded into "is
 * this posting": `posting = open && locationId` let a location-less bill become
 * Open while posting nothing at all, which is the silent shape this refuses.
 */
function requireReceivingLocation(locationId: string | null): string {
  if (!locationId) {
    throw ApiError.badRequest('A bill cannot be opened without a location to receive into.', {
      locationId: 'Select the location this stock is arriving at.',
    });
  }
  return locationId;
}

/**
 * The batches a batch-tracked line receives. An Open bill must name them:
 * `createBatch` requires a reference, so the whole-line fallback that used to sit
 * here could only ever fail, and failed on a field the detail page's "Open Bill"
 * button gives the user no way to fill. A draft may still leave them for later.
 */
function batchesToReceive(
  item: { name: string },
  payload: BillItemPayload,
  posting: boolean,
): BillBatchPayload[] {
  if (payload.batches?.length) return payload.batches;
  if (posting) {
    throw ApiError.badRequest(`Add the batch details for ${item.name} before opening this bill.`, {
      batches: `${item.name} is batch-tracked, so its batches must be named.`,
    });
  }
  return [];
}

/**
 * The batch detail a bill already holds, in the payload shape `receiveBillBatch`
 * takes — so a draft opened without its lines being re-sent posts exactly what it
 * says. Every package goes back by id, which makes `receiveBillBatch` top up the
 * rows the draft created instead of minting duplicates under the same tags.
 */
async function storedBatchesByLine(
  tx: TenantClient,
  organizationId: string,
  lineIds: string[],
): Promise<Map<string, BillBatchPayload[]>> {
  const rows = await tx.billItemBatch.findMany({
    where: { organizationId, billItemId: { in: lineIds }, isDeleted: false },
    select: { billItemId: true, batchId: true, batchUnitId: true, qty: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const byLine = new Map<string, Map<string, BillBatchPayload>>();
  for (const row of rows) {
    const batches = byLine.get(row.billItemId) ?? new Map<string, BillBatchPayload>();
    const batch = batches.get(row.batchId) ?? { batchId: row.batchId, quantity: 0, units: [] };
    batch.quantity += Number(row.qty);
    if (row.batchUnitId) {
      batch.units!.push({ batchUnitId: row.batchUnitId, quantity: Number(row.qty) });
    }
    batches.set(row.batchId, batch);
    byLine.set(row.billItemId, batches);
  }
  return new Map([...byLine].map(([lineId, batches]) => [lineId, [...batches.values()]]));
}

/**
 * 🔴 RECEIVE ONE BATCH OF ONE BILL LINE — the single place both `createBill` and
 * `updateBill` go through.
 *
 * It was two copies until 2026-09-01, and they had already started to drift
 * (`Number(...)` coercions on one side only). Adding a second level underneath
 * would have made that two copies of the unit rules as well, so the two are one
 * function now: a rule fixed here is fixed on both paths, by construction.
 *
 * WHAT IT POSTS, and why it is more than one row. A batch with named packages is
 * one ledger row PER PACKAGE — that is what makes a package's quantity a `SUM`
 * over its own rows rather than a number stored on it and kept in step by hand —
 * plus one final untagged row for whatever was not tagged.
 *
 * `value` is this batch's share of the line's NET amount (`batchValue`), split
 * across the packages and the untagged remainder by quantity — through
 * `splitByQty`, so the parts add up to the batch's share to the paisa and a
 * package carries no value of its own.
 */
async function receiveBillBatch(
  tx: TenantClient,
  args: {
    organizationId: string;
    userId: string | null;
    itemId: string;
    billId: string;
    lineId: string;
    locationId: string | null;
    /** What this batch cost, net of the line's discount — see `batchValue`. */
    value: Prisma.Decimal;
    batch: BillBatchPayload;
    /**
     * 🔴 WHETHER THE STOCK MOVES — the whole of what a draft changes, and the
     * same switch `jobIssues.service` calls `asDraft`.
     *
     * `bill_item_batches` is written either way, because that is the DOCUMENT
     * saying what it received; the ledger rows below are written only when the
     * bill is Open, because that is the stock actually arriving. A draft that
     * wrote no document rows is what made every taka vanish on save.
     */
    post: boolean;
  },
): Promise<{ unitIds: string[]; postings: BillPosting[] }> {
  const { organizationId, userId, itemId, billId, lineId, locationId, value, batch, post } = args;
  const quantity = Number(batch.quantity);

  let batchId = batch.batchId;
  /* Only set when WE created the batch. A batch the payload named is left to
     `postMovement` to read, which is what validates that it exists and belongs
     to this organization. */
  let resolved: ResolvedBatches | undefined;
  let uomId: string | null = null;
  if (!batchId) {
    const created = await createBatch(tx, {
      organizationId,
      itemId,
      supplierBatchRef: batch.supplierBatchRef,
      manufacturerBatch: batch.manufacturerBatch,
      manufacturedDate: batch.manufacturedDate,
      expiryDate: batch.expiryDate,
      mrp: batch.mrp,
      sellingPrice: batch.sellingPrice,
      sourceDocType: 'bill',
      sourceDocId: billId,
      userId: userId || undefined,
    });
    batchId = created.id;
    uomId = created.uomId;
    resolved = asResolvedBatch(created);
  }

  const units = batch.units ?? [];
  const unitTotal = units.reduce((sum, unit) => sum + Number(unit.quantity), 0);

  // 🔴 The business rule, beside the write — NOT only in the zod schema, which
  // runs on the HTTP route alone and would let a script, an import or a test post
  // a bill whose packages do not account for the batch they are inside.
  //
  // 🔴 AN EQUALITY SINCE 2026-09-02, not an inequality. Naming any package commits
  // to naming them all: a batch is broken down completely or not at all. A batch
  // with NO packages is untouched by this, which is what keeps every org that does
  // not run the level — and every bill posted before it existed — working.
  if (units.length > 0 && Math.abs(unitTotal - quantity) > QTY_EPSILON) {
    const label = batch.supplierBatchRef || 'this batch';
    throw ApiError.badRequest(
      `The units named inside ${label} add up to ${unitTotal}, not the ${quantity} ` +
        'being received into it.',
      {
        batches:
          `${label}: its units must account for the whole quantity received, ` +
          'or name none at all.',
      },
    );
  }

  /**
   * 🔴 Two kinds of package row, and they take different paths. A row with NO
   * `batchUnitId` is a roll arriving for the first time and is CREATED — named or
   * not, since a blank label is auto-filled; a row naming a `batchUnitId` is more
   * of a roll we already hold and is only RESOLVED, because `createBatchUnits`
   * refuses a label the batch already carries. Both then post the same movement.
   */
  const newUnits = units.filter((unit) => !unit.batchUnitId);
  const topUps = units.filter((unit) => unit.batchUnitId);

  // Guarded here as well as in the schema: a batch born on this bill cannot have
  // packages that predate it, and only the schema runs on the HTTP route.
  if (topUps.length && !batch.batchId) {
    throw ApiError.badRequest('A batch being created has no existing units to add to.', {
      batches: 'Pick an existing batch before adding to one of its units.',
    });
  }

  const postableUnits = [
    ...(newUnits.length
      ? await createBatchUnits(tx, {
          organizationId,
          batchId,
          units: newUnits.map((unit) => ({ label: unit.label ?? '', qty: unit.quantity })),
          uomId,
          sourceDocType: 'bill',
          sourceDocId: billId,
          userId,
        })
      : []),
    ...(topUps.length
      ? await resolveExistingBatchUnits(tx, {
          organizationId,
          batchId,
          units: topUps.map((unit) => ({ batchUnitId: unit.batchUnitId!, qty: unit.quantity })),
        })
      : []),
  ];

  const untagged = quantity - unitTotal;

  /**
   * 🔴 THE DOCUMENT ROWS — written on EVERY save, draft or open, and the reason
   * this function no longer needs a location to do its job.
   *
   * One row per package, plus one for the untagged remainder, which is the grain
   * `job_issue_lines` uses and the grain the ledger posts at. Writing them here
   * rather than beside the postings is the point: a draft reaches this line and
   * stops, and reopening it still shows every batch and every taka.
   */
  for (const unit of postableUnits) {
    await tx.billItemBatch.create({
      data: {
        organizationId,
        billItemId: lineId,
        batchId,
        batchUnitId: unit.id,
        qty: unit.qty,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }
  // A batch fully broken into packages leaves nothing behind. The epsilon is the
  // same one the equality above uses — `3 × 33.3333` must not leave a remainder.
  if (untagged > QTY_EPSILON) {
    await tx.billItemBatch.create({
      data: {
        organizationId,
        billItemId: lineId,
        batchId,
        batchUnitId: null,
        qty: untagged,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  const unitIds = postableUnits.map((unit) => unit.id);
  if (!post) return { unitIds, postings: [] };

  /**
   * 🔴 PAST HERE THE STOCK WOULD MOVE. Only an Open bill gets this far, so a draft
   * holds no stock, appears in no picker and changes no balance — while its
   * document rows above say exactly what it will receive when it is posted.
   *
   * What comes back is what the bill WANTS on the books, not rows already
   * written: `createBill` posts it as it is, `updateBill` reconciles it against
   * what the bill already holds and posts only the difference.
   */
  const receivingAt = requireReceivingLocation(locationId);

  const hasLoose = untagged > QTY_EPSILON;
  const shares = splitByQty(value, [
    ...postableUnits.map((unit) => unit.qty),
    ...(hasLoose ? [new Prisma.Decimal(untagged)] : []),
  ]);

  const postings: BillPosting[] = postableUnits.map((unit, index) => ({
    batchId,
    batchUnitId: unit.id,
    locationId: receivingAt,
    lineId,
    qty: unit.qty,
    value: shares[index] ?? new Prisma.Decimal(0),
    batch: resolved,
  }));
  // A zero-quantity movement is one `postMovement` refuses by design — one
  // direction per row.
  if (hasLoose) {
    postings.push({
      batchId,
      batchUnitId: null,
      locationId: receivingAt,
      lineId,
      qty: new Prisma.Decimal(untagged),
      value: shares[shares.length - 1] ?? new Prisma.Decimal(0),
      batch: resolved,
    });
  }

  return { unitIds, postings };
}

/**
 * The row an untracked line (`inventoryTracking = 'none'`) wants on the books.
 *
 * 🔴 It REUSES the batch this bill already created for the item. The user never
 * sees that batch, so the form cannot send it back; minting a fresh one on every
 * save made an edit look like "remove the old stock, add new stock" — refused the
 * moment any of the old stock had been used, even when nothing about it changed.
 */
async function untrackedPosting(
  tx: TenantClient,
  args: {
    organizationId: string;
    billId: string;
    itemId: string;
    lineId: string;
    locationId: string | null;
    payload: BillItemPayload;
    userId: string | null;
  },
): Promise<BillPosting> {
  const locationId = requireReceivingLocation(args.locationId);
  const existing = await tx.batch.findFirst({
    where: {
      organizationId: args.organizationId,
      itemId: args.itemId,
      sourceDocType: 'bill',
      sourceDocId: args.billId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const batch = existing
    ? undefined
    : await createBatch(tx, {
        organizationId: args.organizationId,
        itemId: args.itemId,
        sourceDocType: 'bill',
        sourceDocId: args.billId,
        userId: args.userId || undefined,
      });
  return {
    batchId: existing?.id ?? batch!.id,
    batchUnitId: null,
    locationId,
    lineId: args.lineId,
    qty: new Prisma.Decimal(Number(args.payload.quantity ?? 0) || 0),
    value: lineNetValue(args.payload),
    batch: batch ? asResolvedBatch(batch) : undefined,
  };
}

/** One inward row a bill wants on the books — see `receiveBillBatch`. */
interface BillPosting {
  batchId: string;
  batchUnitId: string | null;
  locationId: string;
  lineId: string;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  /** Set when this save created the batch, so the post need not read it back. */
  batch?: ResolvedBatches;
}

/**
 * Post a bill's wanted rows as they are — a bill with nothing on the books yet.
 *
 * Dated at the DOCUMENT's date, never the clock: `posted_at` is when the goods
 * arrived, so a bill dated 15-Apr entered in September ages and reports from April.
 */
async function postBillReceipts(
  tx: TenantClient,
  args: {
    organizationId: string;
    billId: string;
    billDate: Date;
    userId: string | null;
    postings: readonly BillPosting[];
  },
) {
  for (const posting of args.postings) {
    await postMovement(
      tx,
      {
        organizationId: args.organizationId,
        batchId: posting.batchId,
        batchUnitId: posting.batchUnitId,
        locationId: posting.locationId,
        movementType: 'receipt',
        qtyIn: posting.qty,
        valueIn: posting.value,
        sourceDocType: 'bill',
        sourceDocId: args.billId,
        sourceDocLineId: posting.lineId,
        postedAt: args.billDate,
        userId: args.userId || undefined,
      },
      posting.batch,
    );
  }
}

/**
 * 🔴 TAKE BACK WHAT THIS BILL PUT ON THE BOOKS — the missing half of
 * `receiveBillBatch`, and the reason editing a posted bill used to do nothing.
 *
 * Bills could post stock and never un-post it: removing a taka on the form
 * returned 200, rewrote the paperwork and left three takas receivable forever
 * while the bill claimed two. A posted movement is never rewritten or deleted
 * here — the correction is a `reversal` row, exactly as in `cancelJobReceipt`.
 *
 * 🔴 IT REVERSES THE NET, NOT ROW BY ROW, and that is what makes a SECOND edit
 * safe. Pairing every posted row with a fresh reversal would re-reverse the rows
 * an earlier edit had already undone, and the batch would go negative on the
 * third save. Netting `qty_in - qty_out` per (batch, package, location) across
 * every row this bill owns — its own reversals included — answers "what does
 * this bill still contribute", which is zero once it has been withdrawn. So
 * running it twice is a no-op, by construction rather than by a guard.
 */
async function reverseBillPostings(
  tx: TenantClient,
  args: {
    organizationId: string;
    billId: string;
    billNumber: string;
    /**
     * 🔴 The date the stock being withdrawn was posted at — the bill's date BEFORE
     * this edit, never the clock (FIFO plan §5.1). An edit replaces the old
     * posting; dated today, an as-of report between the bill date and the edit
     * showed the stock twice once the new posting landed on the bill date too.
     */
    postedAt: Date;
    userId: string | null;
  },
) {
  const { organizationId, billId, billNumber, postedAt, userId } = args;

  const posted = await tx.stockLedgerEntry.findMany({
    where: { organizationId, sourceDocType: 'bill', sourceDocId: billId },
    select: {
      id: true,
      batchId: true,
      /**
       * 🔴 THE COLUMN THIS PATH MOST EASILY FORGETS, AND THE WORST ONE TO MISS —
       * the same warning `cancelJobReceipt` carries on its own select. Drop it and
       * the reversals post UNTAGGED: the batch's balance comes back perfectly
       * correct, so no screen looks wrong, while every taka keeps its quantity
       * forever with an untagged negative beside it. No error, no warning.
       */
      batchUnitId: true,
      locationId: true,
      qtyIn: true,
      qtyOut: true,
    },
  });
  if (posted.length === 0) return;

  const batchIds = [...new Set(posted.map((row) => row.batchId))];

  /**
   * 🔴 THE TEST IS "HAS ANYTHING TAKEN STOCK OUT", not "has anything touched it"
   * — the same test `cancelJobReceipt` makes, for the same reason. This bill's
   * rows are receipts, so the only way withdrawing them can go wrong is if the
   * quantity is no longer there to withdraw: issued to a jobworker, consumed by
   * an assembly, transferred away.
   *
   * Quantity somebody else put IN stays allowed, or the ordinary case breaks — a
   * batch this bill topped up carries the earlier document's receipt forever.
   * This bill's own rows, its reversals included, are excluded by `sourceDocId`,
   * so a second edit reads the same as the first rather than blocking itself.
   *
   * One query across every batch, not one each: this runs inside the document's
   * single transaction connection, where a round trip per batch is a round trip
   * nobody gets back.
   */
  const movedOn = await tx.stockLedgerEntry.findFirst({
    where: {
      organizationId,
      batchId: { in: batchIds },
      qtyOut: { gt: 0 },
      NOT: { sourceDocType: 'bill', sourceDocId: billId },
    },
    select: { batchId: true },
  });
  if (movedOn) {
    // Read only to name the batch in the message, so it costs nothing on the
    // path that succeeds.
    const batch = await tx.batch.findFirst({
      where: { id: movedOn.batchId, organizationId },
      select: { supplierBatchRef: true },
    });
    throw ApiError.conflict(
      `Stock from batch ${batch?.supplierBatchRef || movedOn.batchId} has already been used ` +
        'since this bill was posted, so its quantities can no longer be changed. ' +
        'Reverse the document that used it first.',
    );
  }

  const netByKey = new Map<
    string,
    {
      batchId: string;
      batchUnitId: string | null;
      locationId: string;
      qty: Prisma.Decimal;
      /** This position's inward rows — the layers its withdrawal takes first. */
      inEntryIds: string[];
    }
  >();
  for (const row of posted) {
    const key = `${row.batchId}|${row.batchUnitId ?? ''}|${row.locationId}`;
    const net = netByKey.get(key) ?? {
      batchId: row.batchId,
      batchUnitId: row.batchUnitId,
      locationId: row.locationId,
      qty: new Prisma.Decimal(0),
      inEntryIds: [],
    };
    net.qty = net.qty.plus(row.qtyIn).minus(row.qtyOut);
    if (row.qtyIn.greaterThan(0)) net.inEntryIds.push(row.id);
    netByKey.set(key, net);
  }

  const batches = await resolveBatchesForPosting(tx, organizationId, batchIds);
  for (const net of netByKey.values()) {
    // Already withdrawn by an earlier edit — and `postMovement` refuses a
    // zero-quantity row regardless, one direction per row.
    if (!net.qty.greaterThan(0)) continue;
    /* 🔴 D3 (FIFO plan): the withdrawal takes this bill's OWN cost layers back,
       and is refused — naming the document — once any of them has been costed to
       something else, even when that document physically took another batch. */
    await postMovement(
      tx,
      {
        organizationId,
        batchId: net.batchId,
        batchUnitId: net.batchUnitId,
        locationId: net.locationId,
        movementType: 'reversal',
        qtyOut: net.qty,
        costScope: {
          kind: 'withdraw',
          sourceDocType: 'bill',
          sourceDocId: billId,
          preferEntryIds: net.inEntryIds,
          batchId: net.batchId,
          strict: true,
        },
        sourceDocType: 'bill',
        sourceDocId: billId,
        /* No `sourceDocLineId`: the line that posted the original row is being
           replaced, and the reversal undoes the bill's contribution as a whole.
           It also keeps reversals out of `getBillById`, which reads the form's
           quantities back by live line id. */
        remarks: `Reversed: bill ${billNumber} was edited.`,
        postedAt,
        userId,
      },
      batches,
    );
  }
}

/** Below this, two values of one position are the same rate — rounding, not an edit. */
const VALUE_TOLERANCE = new Prisma.Decimal('0.01');

/**
 * 🔴 EDIT AN OPEN BILL BY THE DIFFERENCE — never withdraw-everything-and-repost.
 *
 * Withdrawing the whole bill on every save meant that once ANY of its stock had
 * been used — issued, assembled, or merely costed by FIFO — every edit was
 * refused, a changed due date included. Now each position (batch, package,
 * location) is compared with what the bill already holds there:
 *
 *   · unchanged           — nothing is posted, however much of it has been used;
 *   · quantity up / new   — only the extra is received;
 *   · quantity down / gone — only the difference is taken back, and only while
 *     that much is still unused (physically here, and its cost not yet drawn);
 *   · rate, discount or bill date changed — the position is taken back whole and
 *     received again, so it is allowed only while NOTHING of it has been used.
 *     What a used position's changed rate should do is an open decision
 *     (FIFO_COSTING_PLAN.md §8), so it is refused, by name, for now.
 *
 * Withdrawals are dated at the bill's OLD date (they undo that posting) and run
 * before any receipt, packages before the untagged remainder — the order
 * `postMovement`'s package invariant needs.
 */
async function reconcileBillPostings(
  tx: TenantClient,
  args: {
    organizationId: string;
    billId: string;
    billNumber: string;
    oldDate: Date;
    newDate: Date;
    userId: string | null;
    postings: readonly BillPosting[];
  },
) {
  const { organizationId, billId, billNumber, oldDate, newDate, userId } = args;
  const zero = new Prisma.Decimal(0);
  const keyOf = (batchId: string, unitId: string | null, locationId: string) =>
    `${batchId}|${unitId ?? ''}|${locationId}`;

  type Position = {
    batchId: string;
    batchUnitId: string | null;
    locationId: string;
    heldQty: Prisma.Decimal;
    heldValue: Prisma.Decimal;
    inEntryIds: string[];
    wantQty: Prisma.Decimal;
    wantValue: Prisma.Decimal;
    lineId: string | null;
    batch?: ResolvedBatches;
  };
  const positions = new Map<string, Position>();
  const positionAt = (batchId: string, unitId: string | null, locationId: string) => {
    const key = keyOf(batchId, unitId, locationId);
    const found = positions.get(key);
    if (found) return found;
    const created: Position = {
      batchId,
      batchUnitId: unitId,
      locationId,
      heldQty: zero,
      heldValue: zero,
      inEntryIds: [],
      wantQty: zero,
      wantValue: zero,
      lineId: null,
    };
    positions.set(key, created);
    return created;
  };

  const held = await tx.stockLedgerEntry.findMany({
    where: { organizationId, sourceDocType: 'bill', sourceDocId: billId },
    select: {
      id: true,
      batchId: true,
      batchUnitId: true,
      locationId: true,
      qtyIn: true,
      qtyOut: true,
      valueIn: true,
      valueOut: true,
    },
  });
  for (const row of held) {
    const position = positionAt(row.batchId, row.batchUnitId, row.locationId);
    position.heldQty = position.heldQty.plus(row.qtyIn).minus(row.qtyOut);
    position.heldValue = position.heldValue.plus(row.valueIn).minus(row.valueOut);
    if (row.qtyIn.greaterThan(0)) position.inEntryIds.push(row.id);
  }
  for (const posting of args.postings) {
    const position = positionAt(posting.batchId, posting.batchUnitId, posting.locationId);
    position.wantQty = position.wantQty.plus(posting.qty);
    position.wantValue = position.wantValue.plus(posting.value);
    position.lineId ??= posting.lineId;
    position.batch ??= posting.batch;
  }

  const dateChanged = oldDate.getTime() !== newDate.getTime();
  const withdrawals: { position: Position; qty: Prisma.Decimal }[] = [];
  const receipts: { position: Position; qty: Prisma.Decimal; value: Prisma.Decimal }[] = [];
  const retaken: { position: Position; reason: 'rate' | 'date' }[] = [];

  for (const position of positions.values()) {
    const { heldQty, heldValue, wantQty, wantValue } = position;
    if (!heldQty.greaterThan(0)) {
      if (wantQty.greaterThan(0)) receipts.push({ position, qty: wantQty, value: wantValue });
      continue;
    }
    const sameRate =
      wantQty.isZero() ||
      wantValue
        .minus(heldValue.times(wantQty).dividedBy(heldQty))
        .abs()
        .lessThanOrEqualTo(VALUE_TOLERANCE);
    if (wantQty.greaterThan(0) && (!sameRate || dateChanged)) {
      retaken.push({ position, reason: sameRate ? 'date' : 'rate' });
      withdrawals.push({ position, qty: heldQty });
      receipts.push({ position, qty: wantQty, value: wantValue });
    } else if (wantQty.greaterThan(heldQty)) {
      receipts.push({ position, qty: wantQty.minus(heldQty), value: wantValue.minus(heldValue) });
    } else if (wantQty.lessThan(heldQty)) {
      withdrawals.push({ position, qty: heldQty.minus(wantQty) });
    }
  }
  if (withdrawals.length === 0 && receipts.length === 0) return;

  const labelOf = async (batchId: string) =>
    (await tx.batch.findFirst({
      where: { id: batchId, organizationId },
      select: { supplierBatchRef: true, item: { select: { name: true } } },
    })) ?? null;

  // A rate or date change re-receives the position, so none of it may be used yet.
  for (const { position, reason } of retaken) {
    const users = await consumersOfEntries(tx, organizationId, position.inEntryIds, {
      sourceDocType: 'bill',
      sourceDocId: billId,
    });
    if (users.length === 0) continue;
    const batch = await labelOf(position.batchId);
    const what = batch?.item.name ?? 'this item';
    const used = users.join(', ');
    throw new ApiError(
      409,
      reason === 'rate'
        ? `The rate or discount on ${what} cannot change: stock from this bill has already been ` +
            `used by ${used}. Quantities that are still unused, and fields that do not touch ` +
            'stock, can still be edited.'
        : `The bill date cannot change: stock of ${what} from this bill has already been used by ` +
            `${used}.`,
      reason === 'rate'
        ? { lineItems: 'Rate cannot change once stock is used.' }
        : { billDate: 'Date cannot change once stock is used.' },
    );
  }

  // Physically still here? One grouped read for every position being taken back.
  if (withdrawals.length > 0) {
    const grouped = await tx.stockLedgerEntry.groupBy({
      by: ['batchId', 'batchUnitId', 'locationId'],
      where: {
        organizationId,
        batchId: { in: [...new Set(withdrawals.map((w) => w.position.batchId))] },
      },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const onHand = new Map(
      grouped.map((row) => [
        keyOf(row.batchId, row.batchUnitId, row.locationId),
        (row._sum.qtyIn ?? zero).minus(row._sum.qtyOut ?? zero),
      ]),
    );
    for (const { position, qty } of withdrawals) {
      const here =
        onHand.get(keyOf(position.batchId, position.batchUnitId, position.locationId)) ?? zero;
      if (qty.greaterThan(here)) {
        const batch = await labelOf(position.batchId);
        const label = batch?.supplierBatchRef || batch?.item.name || 'This batch';
        throw new ApiError(
          409,
          `${label} has only ${here.toString()} left where this bill received it — the rest has ` +
            `already been used — so this bill cannot take back ${qty.toString()}. ` +
            'Reverse the document that used it first, or keep the quantity.',
          { lineItems: `${label}: only ${here.toString()} is still unused.` },
        );
      }
    }
  }

  const batches = await resolveBatchesForPosting(tx, organizationId, [
    ...new Set(withdrawals.map((w) => w.position.batchId)),
  ]);
  const packagesFirst = [...withdrawals].sort(
    (a, b) => Number(a.position.batchUnitId === null) - Number(b.position.batchUnitId === null),
  );
  for (const { position, qty } of packagesFirst) {
    await postMovement(
      tx,
      {
        organizationId,
        batchId: position.batchId,
        batchUnitId: position.batchUnitId,
        locationId: position.locationId,
        movementType: 'reversal',
        qtyOut: qty,
        costScope: {
          kind: 'withdraw',
          sourceDocType: 'bill',
          sourceDocId: billId,
          preferEntryIds: position.inEntryIds,
          batchId: position.batchId,
          strict: true,
        },
        sourceDocType: 'bill',
        sourceDocId: billId,
        remarks: `Reversed: bill ${billNumber} was edited.`,
        postedAt: oldDate,
        userId,
      },
      batches,
    );
  }

  await postBillReceipts(tx, {
    organizationId,
    billId,
    billDate: newDate,
    userId,
    postings: receipts.map(({ position, qty, value }) => ({
      batchId: position.batchId,
      batchUnitId: position.batchUnitId,
      locationId: position.locationId,
      lineId: position.lineId!,
      qty,
      value: Prisma.Decimal.max(value, zero),
      batch: position.batch,
    })),
  });
}

/**
 * 🔴 RETIRE THE PACKAGES THIS BILL CREATED AND NO LONGER NAMES.
 *
 * Split out of `reverseBillPostings` when drafts arrived, because it is needed on
 * both paths and the reversal is needed on only one: removing a taka from a DRAFT
 * moves no stock, so there is nothing to reverse, but its `batch_units` row must
 * still go or the tag stays reserved and the picker keeps offering it.
 *
 * Called AFTER the document rows are written, so `keepUnitIds` can be the units
 * actually used by this save — which is the only set that includes packages the
 * payload created without an id of its own.
 *
 * A dropped package's `seq` is never handed to its replacement: the numbers are
 * retired, so a batch that loses #2 and #3 reads #1, #4.
 */
async function retireBillUnits(
  tx: TenantClient,
  args: {
    organizationId: string;
    billId: string;
    keepUnitIds: ReadonlySet<string>;
    userId: string | null;
  },
) {
  const { organizationId, billId, keepUnitIds, userId } = args;

  const created = await tx.batchUnit.findMany({
    where: { organizationId, sourceDocType: 'bill', sourceDocId: billId, isDeleted: false },
    select: { id: true },
  });
  /* A package this save still uses keeps its row, so the next edit tops it up
     through `resolveExistingBatchUnits` instead of hitting "already exists in
     this batch" on its own tag. */
  const candidates = created.map((unit) => unit.id).filter((id) => !keepUnitIds.has(id));
  if (candidates.length === 0) return;

  // 🔴 Two queries for fifty takas, not a hundred. A `count` per package is the
  // N+1 this transaction's one connection pays for serially.
  const movedElsewhere = await tx.stockLedgerEntry.findMany({
    where: {
      organizationId,
      batchUnitId: { in: candidates },
      NOT: { sourceDocType: 'bill', sourceDocId: billId },
    },
    select: { batchUnitId: true },
    distinct: ['batchUnitId'],
  });
  // A package another document has moved keeps its row: those ledger rows name it
  // forever and have to stay interpretable.
  const spokenFor = new Set(movedElsewhere.map((row) => row.batchUnitId));

  /* And a package another BILL LINE still names keeps its row too — a batch
     topped up by a second line of the same bill is one this save is still
     using, just not through the line that created it. */
  const namedElsewhere = await tx.billItemBatch.findMany({
    where: {
      organizationId,
      batchUnitId: { in: candidates },
      isDeleted: false,
      billItem: { isDeleted: false },
    },
    select: { batchUnitId: true },
    distinct: ['batchUnitId'],
  });
  for (const row of namedElsewhere) spokenFor.add(row.batchUnitId);

  const retire = candidates.filter((id) => !spokenFor.has(id));
  if (retire.length === 0) return;

  await tx.batchUnit.updateMany({
    where: { id: { in: retire }, organizationId },
    data: { isDeleted: true, updatedBy: userId },
  });
}

function billListWhere(organizationId: string, opts: ListQuery): Prisma.BillWhereInput {
  return {
    organizationId: organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.BillWhereInput>('bill', opts.filter),
    ...searchWhere<Prisma.BillWhereInput>(opts.search, ['billNumber', 'notes', 'status']),
  };
}

export async function getOpenJobReceiptsForVendor(organizationId: string, vendorId: string) {
  return runAsTenant(organizationId, async (tx) => {
    const results = await tx.jobReceipt.findMany({
      where: {
        organizationId,
        processorId: vendorId,
        status: 'posted',
        isDeleted: false,
        billItems: { none: {} }, // Only unbilled receipts
      },
      include: {
        jobOrder: { select: { jobOrderNumber: true } },
        location: { select: { name: true } },
        outputs: {
          where: { isDeleted: false },
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
                trackInventory: true,
                inventoryTracking: true,
              },
            },
            outputBatch: { select: { batchNumber: true } },
          },
        },
      },
      orderBy: { receiptDate: 'asc' },
    });
    return results;
  });
}

export async function getBillsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.bill.findMany({
      where: billListWhere(organizationId, opts),
      orderBy: { billDate: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: {
        vendor: { select: { contactName: true } },
        location: true,
      },
    });

    return pageSlice(rows, page, perPage);
  });
}

export async function countBills(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.bill.count({ where: billListWhere(organizationId, opts) }),
  );
}

/** One batch as the bill form reads it back, seeded from its first document row.
 * Quantity and `units` are then accumulated across that batch's other rows. */
function toBatchReadback(row: {
  batchId: string;
  qty: Prisma.Decimal;
  batch: {
    supplierBatchRef: string | null;
    manufacturerBatch: string | null;
    manufacturedDate: Date | null;
    expiryDate: Date | null;
    mrp: Prisma.Decimal | null;
    sellingPrice: Prisma.Decimal | null;
  } | null;
}) {
  return {
    batchId: row.batchId,
    supplierBatchRef: row.batch?.supplierBatchRef || undefined,
    manufacturerBatch: row.batch?.manufacturerBatch || undefined,
    manufacturedDate: row.batch?.manufacturedDate || undefined,
    expiryDate: row.batch?.expiryDate || undefined,
    quantity: Number(row.qty) || 0,
    mrp: row.batch?.mrp != null ? Number(row.batch.mrp) : undefined,
    sellingPrice: row.batch?.sellingPrice != null ? Number(row.batch.sellingPrice) : undefined,
    units: [] as { batchUnitId: string; label: string; quantity: number }[],
  };
}

export async function getBillById(orgId: string, id: string) {
  return runAsTenant(orgId, async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: {
        lineItems: {
          where: { isDeleted: false },
          include: { item: true },
        },
        vendor: { select: { contactName: true, email: true, phone: true, addresses: true } },
        location: true,
      },
    });

    if (!bill) return null;

    /**
     * 🔴 READ FROM THE DOCUMENT, NOT FROM THE LEDGER (2026-09-08).
     *
     * This used to query `stock_ledger` and reconstruct what the bill must have
     * said from the movements it left behind. That inverted the dependency — a
     * document is a record of INTENT and the ledger a record of EFFECT — and it
     * failed in three ways for one reason:
     *
     *   · a DRAFT posts nothing, so it read back with no batches and no takas at
     *     all, and everything the user typed was lost on save;
     *   · an EDIT replaces the `bill_items` rows, so the movements pointed at ids
     *     that had just been soft-deleted and the whole form went blank;
     *   · a REVERSED bill nets to zero, so a document that plainly said something
     *     read back as having said nothing.
     *
     * `bill_item_batches` is written on every save by `receiveBillBatch`, so all
     * three now answer the same way, and the ledger is left to answer the only
     * question it should: what stock actually moved.
     */
    const lineItemIds = bill.lineItems.map((li) => li.id);
    const documentRows = await tx.billItemBatch.findMany({
      where: {
        organizationId: orgId,
        billItemId: { in: lineItemIds },
        isDeleted: false,
      },
      include: {
        batch: true,
        // The package this row is, when the org runs a unit level. Null on the
        // untagged remainder and on every row written before the level existed.
        batchUnit: { select: { id: true, seq: true, label: true } },
      },
      /**
       * 🔴 `id` IS THE TIEBREAK, NOT `createdAt` ALONE — the same trap this file
       * documents for `bill_items`. Every row of one save carries the identical
       * `created_at`, because Postgres's `CURRENT_TIMESTAMP` is the TRANSACTION's
       * start time, so a sort on it alone has nothing to order by and the batches
       * come back in whatever order the planner chose. Packages are then ordered
       * by `seq` in memory below, which a relation sort cannot do reliably here.
       */
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const rowsByLineId = documentRows.reduce(
      (acc, row) => {
        if (!acc[row.billItemId]) acc[row.billItemId] = [];
        acc[row.billItemId]!.push(row);
        return acc;
      },
      {} as Record<string, typeof documentRows>,
    );

    const lineItemsWithBatches = bill.lineItems.map((li) => {
      const liRows = rowsByLineId[li.id] || [];

      /**
       * 🔴 GROUPED BY BATCH, because one batch is no longer one row.
       *
       * A batch broken into packages is one row per package plus one for the
       * untagged remainder, so a flat map would render the same batch three
       * times, each showing a slice of its quantity — and the dialog would then
       * send those slices back as three separate batches on the next save. The
       * batch's quantity is the SUM of its rows; the packages are the rows that
       * name one.
       */
      const byBatch = new Map<string, ReturnType<typeof toBatchReadback>>();
      /* `seq` alongside each package, only to sort by — see below. Kept out of
         the payload because it is the batch's numbering, not the bill's, and the
         form neither sends it back nor has anywhere to show it. */
      const seqByUnitId = new Map<string, number>();
      for (const m of liRows) {
        const existing = byBatch.get(m.batchId);
        const row = existing ?? toBatchReadback(m);
        if (existing) row.quantity += Number(m.qty) || 0;
        if (m.batchUnit) {
          seqByUnitId.set(m.batchUnit.id, m.batchUnit.seq);
          row.units.push({
            batchUnitId: m.batchUnit.id,
            label: m.batchUnit.label,
            quantity: Number(m.qty) || 0,
          });
        }
        byBatch.set(m.batchId, row);
      }

      /* 🔴 Packages in `seq` order, which is the order they sit in the batch —
         so the dialog reads #1, #2, #3 however the rows were written. Insert
         order would put a taka the user just ADDED before one they kept, because
         `createBatchUnits` runs before `resolveExistingBatchUnits`. */
      const batches = [...byBatch.values()];
      for (const batch of batches) {
        batch.units.sort(
          (a, b) => (seqByUnitId.get(a.batchUnitId) ?? 0) - (seqByUnitId.get(b.batchUnitId) ?? 0),
        );
      }
      return {
        ...li,
        batches: batches.length > 0 ? batches : undefined,
      };
    });

    return {
      ...bill,
      lineItems: lineItemsWithBatches,
    };
  });
}

export async function createBill(orgId: string, userId: string, data: CreateBillPayload) {
  const {
    lineItems: lineItems,
    customFields: rawCustomFields,
    totalAmount: totalAmount,
    termsAndConditions: termsAndConditions,
    attachments,
    notes: _notes,
    ...billData
  } = data as CreateBillPayload & { notes?: string };
  // `runAsDocument`, like `updateBill`: a fifty-taka consignment now writes fifty
  // package rows, fifty document rows and fifty ledger rows in one transaction.
  const createdBill = await runAsDocument(orgId, async (tx) => {
    // Drafts too: a bill's date rides through to the ledger the moment it opens,
    // so a parked one holding an invalid date is a posting waiting to happen.
    await assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date: billData.billDate,
      field: 'billDate',
      label: 'bill',
    });

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    const seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'bill' } },
    });

    if (seq) {
      if (billData.billNumber.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    const defs = await loadActiveDefinitions(tx, orgId, 'bill');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields as Record<string, unknown> | undefined,
      mode: 'create',
    });

    const existingBill = await tx.bill.findFirst({
      where: {
        organizationId: orgId,
        vendorId: billData.vendorId,
        billNumber: billData.billNumber,
        isDeleted: false,
      },
    });
    if (existingBill) {
      throw ApiError.conflict(DUPLICATE_NUMBER);
    }

    const createdBill = await tx.bill.create({
      data: {
        ...billData,
        totalAmount: totalAmount,
        termsAndConditions: termsAndConditions,
        organizationId: orgId,
        sourcePoId: billData.sourcePoId || null,
        createdBy: userId,
        updatedBy: userId,
        documents: (attachments ?? []) as Prisma.InputJsonValue,
        customFields: customFields as Prisma.InputJsonObject,
        lineItems: {
          create: lineItems.map((item: BillItemPayload) => ({
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discountPercentage: item.discountPercentage,
            discount: item.discountAmount,
            itemTotal: item.amount,
            jobReceiptId: item.jobReceiptId,
            customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            createdBy: userId,
            updatedBy: userId,
          })),
        },
        activities: {
          create: {
            title: 'Bill Created',
            description: `Bill ${billData.billNumber} was created.`,
            performedBy,
            createdBy: userId,
            updatedBy: userId,
          },
        },
      },
      include: {
        lineItems: true,
        activities: true,
      },
    });

    /**
     * 🔴 THE DOCUMENT IS WRITTEN EITHER WAY; ONLY THE STOCK WAITS FOR "Open".
     *
     * This whole block used to sit behind that condition, so a DRAFT stored none
     * of its batches or takas and reopening it showed an empty form. Now the
     * condition only decides `post` — the same shape `jobIssues.service` uses to
     * park a challan without moving anything.
     */
    const posting = createdBill.status?.toLowerCase() === 'open';
    {
      const itemIds = lineItems.map((li: BillItemPayload) => li.itemId);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, name: true, inventoryTracking: true, trackInventory: true },
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));
      const postings: BillPosting[] = [];

      for (let i = 0; i < lineItems.length; i++) {
        const payload = lineItems[i];
        if (!payload) continue;
        const lineRecord = createdBill.lineItems[i]; // assuming same order since Prisma returns in create order mostly
        if (!lineRecord) continue;
        const item = itemsById.get(payload.itemId);

        // Lines billed from a Job Receipt do not affect inventory.
        // The Job Receipt already received the physical stock.
        if (payload.jobReceiptId) continue;

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          for (const b of batchesToReceive(item, payload, posting)) {
            const received = await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: createdBill.id,
              lineId: lineRecord.id,
              locationId: createdBill.locationId,
              value: batchValue(payload, b.quantity),
              batch: b,
              post: posting,
            });
            postings.push(...received.postings);
          }
          /* An item tracked at neither batch nor package level has no detail to
             remember: its quantity is the line's own column, and the anonymous
             batch below exists only to give the ledger something to hang on. So
             this branch stays posting-only, and a draft writes nothing for it. */
        } else if (posting && item?.trackInventory && item.inventoryTracking === 'none') {
          postings.push(
            await untrackedPosting(tx, {
              organizationId: orgId,
              billId: createdBill.id,
              itemId: item.id,
              lineId: lineRecord.id,
              locationId: createdBill.locationId,
              payload,
              userId: userId || null,
            }),
          );
        }
      }

      await postBillReceipts(tx, {
        organizationId: orgId,
        billId: createdBill.id,
        billDate: createdBill.billDate,
        userId: userId || null,
        postings,
      });
    }

    return createdBill;
  });

  // Trigger approval workflow evaluation asynchronously post-commit
  approvalTriggerService
    .trigger({
      organizationId: orgId,
      moduleId: 'bills',
      recordId: createdBill.id,
      recordTitle: `Bill #${createdBill.billNumber}`,
      triggerType: 'CREATE',
      record: createdBill as unknown as Record<string, unknown>,
      actorUserId: userId,
    })
    .catch((err) => console.error('[ApprovalTrigger] Error in create bill:', err));

  return createdBill;
}

export async function updateBill(
  orgId: string,
  id: string,
  userId: string,
  data: UpdateBillPayload,
) {
  const {
    lineItems: lineItems,
    customFields: rawCustomFields,
    totalAmount: totalAmount,
    termsAndConditions: termsAndConditions,
    attachments,
    notes: _notes,
    ...billData
  } = data as UpdateBillPayload & { notes?: string };
  // `runAsDocument`, not `runAsTenant`: an edit now reverses every row this bill
  // posted before re-posting the new ones, so a fifty-taka consignment is a
  // hundred `postMovement` calls on one connection.
  const updatedBill = await runAsDocument(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: { lineItems: { where: { isDeleted: false } } },
    });

    if (!existing) throw ApiError.notFound('Bill not found');

    const effectiveStatus = (billData.status ?? existing.status ?? '').toLowerCase();
    /**
     * 🔴 AN OPEN BILL NEVER GOES BACK TO DRAFT (2026-09-11). Once a bill is on the
     * books it is corrected by editing it — which reverses and re-posts, below —
     * or withdrawn by deleting it; that is how Zoho Books, SAP and Tally all treat
     * a posted purchase document. Before this, Save as Draft on an Open bill
     * quietly took its stock off the books while the vendor's invoice still stood.
     */
    if (existing.status.toLowerCase() === 'open' && effectiveStatus === 'draft') {
      throw ApiError.badRequest(
        'An open bill cannot be moved back to Draft. Edit and save it, or delete it.',
        { status: 'An open bill stays open.' },
      );
    }
    const goingOpen = existing.status.toLowerCase() === 'draft' && effectiveStatus === 'open';
    /* The detail page's "Open Bill" sends the status and nothing else, so the lines
       and batches to post are the ones the draft already stores. */
    const openingFromDocument = goingOpen && !lineItems;

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    let customFields: unknown;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, orgId, 'bill');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields as Record<string, unknown>,
        mode: 'update',
        existing: existing.customFields as Record<string, unknown>,
      });
    }

    const effectiveVendorId = billData.vendorId ?? existing.vendorId;
    const effectiveBillNumber = billData.billNumber ?? existing.billNumber;

    if (billData.vendorId !== undefined || billData.billNumber !== undefined) {
      const existingDuplicate = await tx.bill.findFirst({
        where: {
          organizationId: orgId,
          vendorId: effectiveVendorId,
          billNumber: effectiveBillNumber,
          isDeleted: false,
          id: { not: id },
        },
      });
      if (existingDuplicate) {
        throw ApiError.conflict(DUPLICATE_NUMBER);
      }
    }

    await tx.bill.update({
      where: { id },
      data: {
        ...billData,
        totalAmount: totalAmount,
        termsAndConditions: termsAndConditions,
        documents: attachments !== undefined ? (attachments as Prisma.InputJsonValue) : undefined,
        customFields:
          customFields !== undefined ? (customFields as Prisma.InputJsonObject) : undefined,
        updatedBy: userId,
        activities: {
          create: {
            title: 'Bill Updated',
            description: `Bill ${existing.billNumber} was updated.`,
            performedBy,
            createdBy: userId,
            updatedBy: userId,
          },
        },
      },
    });

    /**
     * 🔴 EACH PAYLOAD LINE PAIRED WITH THE ROW IT ACTUALLY CREATED.
     *
     * This used to re-read the lines afterwards and pair them to the payload BY
     * ARRAY INDEX, on the stated assumption that `orderBy: { createdAt: 'asc' }`
     * returns them in the order they were written. It does not: `created_at`
     * defaults to `CURRENT_TIMESTAMP`, which in Postgres is the TRANSACTION's
     * start time — so every line of one bill carries the identical timestamp and
     * the sort has nothing to order by. The pairing was then whatever the planner
     * felt like, and a mismatched pair files a line's stock movements (and now
     * its packages) under a different line's id.
     *
     * Keeping the rows the writes returned removes the guess entirely.
     */
    const writtenLines: { payload: BillItemPayload; lineId: string }[] = [];

    if (lineItems) {
      // Delete all old lines and create new ones (simplest approach for full replace)
      await tx.billItem.updateMany({
        where: { billId: id },
        data: { isDeleted: true, updatedBy: userId },
      });
      /* The batch rows go with the lines that own them. They are re-created below
         from the payload, and leaving the old ones live would double every
         quantity the form reads back. */
      await tx.billItemBatch.updateMany({
        where: { organizationId: orgId, billItem: { billId: id } },
        data: { isDeleted: true, updatedBy: userId },
      });

      for (const item of lineItems) {
        const created = await tx.billItem.create({
          data: {
            billId: id,
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discountPercentage: item.discountPercentage ?? null,
            discount: item.discountAmount ?? null,
            itemTotal: item.amount,
            jobReceiptId: item.jobReceiptId,
            customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            createdBy: userId,
            updatedBy: userId,
          },
          select: { id: true },
        });
        writtenLines.push({ payload: item, lineId: created.id });
      }
    } else {
      /* No lines in the payload: the rows already on the bill ARE the lines, so
         each one pairs with itself and no ordering question arises.

         🔴 OPENING A DRAFT THIS WAY POSTED NOTHING until 2026-09-11. The lines
         carried no `batches` and nothing was written, so the bill turned Open with
         an empty ledger behind it — stock that never arrived at its location and
         a batch no Batch Details tab could find. Now its stored batch detail rides
         along and is rewritten below exactly as an edit's would be; the old rows
         go first because `receiveBillBatch` writes them again. Every other
         line-less save still carries no batches and never touches the ledger. */
      const stored = openingFromDocument
        ? await storedBatchesByLine(
            tx,
            orgId,
            existing.lineItems.map((row) => row.id),
          )
        : undefined;
      if (openingFromDocument) {
        await tx.billItemBatch.updateMany({
          where: { organizationId: orgId, billItem: { billId: id } },
          data: { isDeleted: true, updatedBy: userId },
        });
      }
      for (const row of existing.lineItems) {
        writtenLines.push({
          payload: { ...(row as unknown as BillItemPayload), batches: stored?.get(row.id) },
          lineId: row.id,
        });
      }
    }

    const effectiveLocationId =
      billData.locationId !== undefined ? billData.locationId : existing.locationId;
    // Re-dating a bill re-dates the stock it moved: the reversal below withdraws
    // every old row and this save posts fresh ones, so they must carry the date
    // the bill now says, not the one it used to.
    const effectiveBillDate = billData.billDate ?? existing.billDate;
    await assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date: effectiveBillDate,
      field: 'billDate',
      label: 'bill',
    });

    /**
     * 🔴 THE LEDGER IS THE RECORD OF WHETHER THIS BILL HAS POSTED — not a column
     * on the bill. Bills sent back to Draft before that was refused (2026-09-11)
     * carry a receipt and its reversal, so the answer has to come from the rows,
     * which are never deleted and survive any edit.
     */
    const alreadyPosted = await tx.stockLedgerEntry.count({
      where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: id },
    });

    /**
     * 🔴 THE NET ON THE BOOKS IS ALWAYS EXACTLY WHAT THE PAYLOAD SAYS — never a
     * second posting on top of the first, and never a withdraw-everything-and-
     * repost either (2026-09-18): an Open bill is reconciled position by position
     * (`reconcileBillPostings`), so an edit that leaves used stock untouched is not
     * refused because of it.
     *
     * A draft holds no stock, so a bill that is not Open reverses whatever it still
     * nets on the books. Open → Draft is refused above, so in practice that only
     * reaches the old drafts sent back before the refusal, which already net to
     * zero. Being idempotent, the reversal is a no-op there.
     *
     * 🔴 SO THE ONE CASE THAT MUST NOT TOUCH STOCK is a payload with no `lineItems`
     * that leaves the bill OPEN — a note, an attachment, a payment term. There
     * `writtenLines` falls back to the rows already on the bill, which carry no
     * `batches`, so reversing would withdraw the stock and re-post it from a
     * payload that never described it, flattening every taka into one untagged
     * lump on an edit that never mentioned them.
     */
    const rewritingLines = Boolean(lineItems);

    /**
     * 🔴 THE DOCUMENT ROWS ARE REWRITTEN WHENEVER THE LINES ARE — draft or open,
     * and independently of whether anything posts. That is what lets a draft be
     * edited over and over and still read back exactly what was typed. Opening a
     * draft from its stored rows is the same rewrite, fed from the database.
     */
    const mustWrite = rewritingLines || openingFromDocument;
    /* Only a bill that is not Open takes everything back — in practice the old
       drafts sent back before Open → Draft was refused, which already net to zero.
       An Open bill is reconciled by the difference instead (`reconcileBillPostings`). */
    const mustReverse = alreadyPosted > 0 && effectiveStatus !== 'open';
    /* 🔴 An Open bill whose lines are saved ALWAYS ends up holding what they say. This
       used to require `alreadyPosted > 0`, which is exactly what an Open bill with an
       empty ledger lacks — so the bills the status-only "Open Bill" left unposted
       could never be repaired by editing them. No location is refused inside the
       posting (`requireReceivingLocation`) rather than silently skipping it. */
    const mustPost = effectiveStatus === 'open' && (goingOpen || rewritingLines);

    if (mustReverse) {
      await reverseBillPostings(tx, {
        organizationId: orgId,
        billId: id,
        billNumber: existing.billNumber,
        postedAt: existing.billDate,
        userId: userId || null,
      });
    }

    if (mustWrite) {
      const itemIds = writtenLines.map((line) => line.payload.itemId);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, name: true, inventoryTracking: true, trackInventory: true },
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));

      /* Every package this save actually used, created ones included — which is
         why it is collected HERE and not read off the payload: a taka the user
         has just added carries no id until `createBatchUnits` gives it one. */
      const usedUnitIds = new Set<string>();
      const postings: BillPosting[] = [];

      for (const line of writtenLines) {
        const payload = line.payload;
        const lineRecord = { id: line.lineId };
        const item = itemsById.get(payload.itemId);

        // Lines billed from a Job Receipt do not affect inventory.
        // The Job Receipt already received the physical stock.
        if (payload.jobReceiptId) continue;

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          for (const b of batchesToReceive(item, payload, mustPost)) {
            const received = await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: id,
              lineId: lineRecord.id,
              locationId: effectiveLocationId,
              value: batchValue(payload, b.quantity),
              batch: b,
              post: mustPost,
            });
            for (const unitId of received.unitIds) usedUnitIds.add(unitId);
            postings.push(...received.postings);
          }
          // Posting-only, for the same reason as on create: an item tracked at
          // neither level has no detail to remember.
        } else if (mustPost && item?.trackInventory && item.inventoryTracking === 'none') {
          postings.push(
            await untrackedPosting(tx, {
              organizationId: orgId,
              billId: id,
              itemId: item.id,
              lineId: lineRecord.id,
              locationId: effectiveLocationId,
              payload,
              userId: userId || null,
            }),
          );
        }
      }

      // Before retiring packages: a package being taken back must still be live
      // for `postMovement` to post against it.
      if (mustPost) {
        await reconcileBillPostings(tx, {
          organizationId: orgId,
          billId: id,
          billNumber: existing.billNumber,
          oldDate: existing.billDate,
          newDate: effectiveBillDate,
          userId: userId || null,
          postings,
        });
      }

      /* 🔴 LAST, once every package this save uses is known. A taka the user
         deleted from a DRAFT moves no stock, so nothing reverses it — but its
         `batch_units` row still has to go, or the tag stays reserved and the
         picker keeps offering a roll the bill no longer claims. */
      await retireBillUnits(tx, {
        organizationId: orgId,
        billId: id,
        keepUnitIds: usedUnitIds,
        userId: userId || null,
      });
    }

    return await tx.bill.findFirst({ where: { id } });
  });

  if (updatedBill) {
    // Trigger approval workflow evaluation asynchronously post-commit
    approvalTriggerService
      .trigger({
        organizationId: orgId,
        moduleId: 'bills',
        recordId: updatedBill.id,
        recordTitle: `Bill #${updatedBill.billNumber}`,
        triggerType: 'EDIT',
        record: updatedBill as unknown as Record<string, unknown>,
        actorUserId: userId,
      })
      .catch((err) => console.error('[ApprovalTrigger] Error in update bill:', err));
  }

  return updatedBill;
}

/**
 * 🔴 A DELETED BILL TAKES ITS STOCK WITH IT.
 *
 * This soft-deleted the bill and stopped there, so deleting a posted bill left
 * every receipt row on the books: the quantity stayed issuable from a document
 * that no longer existed on any screen, and there was no path left to take it
 * back — the bill could not be opened to edit, and `updateBill` refuses a deleted
 * one. It was the only way to put stock somewhere unreachable.
 *
 * The reversal also brings its guard: a bill whose stock has already been issued
 * onward cannot be deleted at all (409), rather than deleted and left inconsistent.
 * That is the same answer SAP gives, and the right one — the document that
 * consumed the stock has to be reversed first.
 */
export async function deleteBill(orgId: string, id: string, userId: string | null = null) {
  return runAsDocument(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Bill not found');

    await reverseBillPostings(tx, {
      organizationId: orgId,
      billId: id,
      billNumber: existing.billNumber,
      postedAt: existing.billDate,
      userId,
    });

    /* 🔴 THE DOCUMENT'S OWN ROWS GO FIRST, and the order is load-bearing:
       `retireBillUnits` reads this table to decide which packages are still
       claimed by a live line. Leave these standing and every one of them looks
       spoken for, so nothing is retired. */
    await tx.billItemBatch.updateMany({
      where: { organizationId: orgId, billItem: { billId: id } },
      data: { isDeleted: true, updatedBy: userId },
    });

    // Nothing is kept: the bill is going away, so every package it created goes
    // with it — unless another document has moved one, which keeps its row so the
    // ledger rows naming it stay interpretable.
    await retireBillUnits(tx, {
      organizationId: orgId,
      billId: id,
      keepUnitIds: new Set(),
      userId,
    });

    await tx.bill.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId },
    });
  });
}

export async function getBillActivities(orgId: string, billId: string) {
  return runAsTenant(orgId, (tx) =>
    tx.billActivity.findMany({
      where: { billId, bill: { organizationId: orgId }, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getBillComments(orgId: string, billId: string) {
  return runAsTenant(orgId, (tx) =>
    tx.billComment.findMany({
      where: { billId, bill: { organizationId: orgId }, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createBillComment(
  orgId: string,
  billId: string,
  content: string,
  userId: string | null,
) {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id: billId, organizationId: orgId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Bill not found');

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return tx.billComment.create({
      data: {
        billId,
        content,
        performedBy,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  });
}

export async function deleteBillComment(
  orgId: string,
  billId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.billComment.findFirst({
      where: { id: commentId, billId: billId, bill: { organizationId: orgId }, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Comment not found');

    return tx.billComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

export async function getBillNumberPreference(orgId: string) {
  return runAsTenant(orgId, (tx) =>
    tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'bill' } },
    }),
  );
}

export async function updateBillNumberPreference(
  orgId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(orgId, (tx) =>
    tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'bill' } },
      create: {
        organizationId: orgId,
        entityType: 'bill',
        prefix,
        nextNumber,
      },
      update: {
        prefix,
        nextNumber,
      },
    }),
  );
}
