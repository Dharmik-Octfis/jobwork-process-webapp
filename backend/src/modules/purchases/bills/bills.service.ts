import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateBillPayload, UpdateBillPayload, BillItemPayload } from './bills.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
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
 * Value rides along proportionally at the line's rate, so the batch's total value
 * is identical whether or not it was broken into packages. That is what keeps
 * this change out of valuation entirely: a package carries no value of its own,
 * it inherits its batch's weighted average.
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
    rate: number;
    /* The DOCUMENT's date, never the clock. `posted_at` is when the goods arrived,
       so a bill dated 15-Apr and entered in September must age and report from
       April — see the column's own comment in `inventory.prisma`. */
    billDate: Date;
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
): Promise<{ unitIds: string[] }> {
  const {
    organizationId,
    userId,
    itemId,
    billId,
    lineId,
    locationId,
    rate,
    billDate,
    batch,
    post,
  } = args;
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
  if (!post) return { unitIds };

  /**
   * 🔴 PAST HERE THE STOCK ACTUALLY MOVES. Only an Open bill gets this far, so a
   * draft holds no stock, appears in no picker and changes no balance — while its
   * document rows above say exactly what it will receive when it is posted.
   */
  if (!locationId) {
    throw ApiError.badRequest('A bill cannot be opened without a location to receive into.', {
      locationId: 'Select the location this stock is arriving at.',
    });
  }

  for (const unit of postableUnits) {
    await postMovement(
      tx,
      {
        organizationId,
        batchId,
        batchUnitId: unit.id,
        locationId,
        movementType: 'receipt',
        qtyIn: unit.qty,
        valueIn: unit.qty.times(rate || 0),
        sourceDocType: 'bill',
        sourceDocId: billId,
        sourceDocLineId: lineId,
        postedAt: billDate,
        userId: userId || undefined,
      },
      resolved,
    );
  }

  // A zero-quantity movement is one `postMovement` refuses by design — one
  // direction per row.
  if (untagged > QTY_EPSILON) {
    await postMovement(
      tx,
      {
        organizationId,
        batchId,
        locationId,
        movementType: 'receipt',
        qtyIn: untagged,
        valueIn: untagged * (rate || 0),
        sourceDocType: 'bill',
        sourceDocId: billId,
        sourceDocLineId: lineId,
        postedAt: billDate,
        userId: userId || undefined,
      },
      resolved,
    );
  }

  return { unitIds };
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
    userId: string | null;
  },
) {
  const { organizationId, billId, billNumber, userId } = args;

  const posted = await tx.stockLedgerEntry.findMany({
    where: { organizationId, sourceDocType: 'bill', sourceDocId: billId },
    select: {
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
      valueIn: true,
      valueOut: true,
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
      value: Prisma.Decimal;
    }
  >();
  for (const row of posted) {
    const key = `${row.batchId}|${row.batchUnitId ?? ''}|${row.locationId}`;
    const net = netByKey.get(key) ?? {
      batchId: row.batchId,
      batchUnitId: row.batchUnitId,
      locationId: row.locationId,
      qty: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
    };
    net.qty = net.qty.plus(row.qtyIn).minus(row.qtyOut);
    net.value = net.value.plus(row.valueIn).minus(row.valueOut);
    netByKey.set(key, net);
  }

  const batches = await resolveBatchesForPosting(tx, organizationId, batchIds);
  const now = new Date();
  for (const net of netByKey.values()) {
    // Already withdrawn by an earlier edit — and `postMovement` refuses a
    // zero-quantity row regardless, one direction per row.
    if (!net.qty.greaterThan(0)) continue;
    await postMovement(
      tx,
      {
        organizationId,
        batchId: net.batchId,
        batchUnitId: net.batchUnitId,
        locationId: net.locationId,
        movementType: 'reversal',
        qtyOut: net.qty,
        valueOut: net.value.greaterThan(0) ? net.value : 0,
        sourceDocType: 'bill',
        sourceDocId: billId,
        /* No `sourceDocLineId`: the line that posted the original row is being
           replaced, and the reversal undoes the bill's contribution as a whole.
           It also keeps reversals out of `getBillById`, which reads the form's
           quantities back by live line id. */
        remarks: `Reversed: bill ${billNumber} was edited.`,
        postedAt: now,
        userId,
      },
      batches,
    );
  }
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
  return runAsDocument(orgId, async (tx) => {
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
    const posting = createdBill.status?.toLowerCase() === 'open' && !!createdBill.locationId;
    {
      const itemIds = lineItems.map((li: BillItemPayload) => li.itemId);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, inventoryTracking: true, trackInventory: true },
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));

      for (let i = 0; i < lineItems.length; i++) {
        const payload = lineItems[i];
        if (!payload) continue;
        const lineRecord = createdBill.lineItems[i]; // assuming same order since Prisma returns in create order mostly
        if (!lineRecord) continue;
        const item = itemsById.get(payload.itemId);

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          /* 🔴 THE UNNAMED FALLBACK IS A POSTING CONCERN, NOT A DOCUMENT ONE.
             It exists so an Open bill still moves stock when the user skipped the
             batch dialog. A DRAFT must not use it: inventing a batch nobody named
             is both wrong — the user has not decided yet — and impossible, since
             `createBatch` requires a reference for a batch-tracked item and there
             is none to give. A draft with no batch detail simply stores none. */
          const batches = payload.batches?.length
            ? payload.batches
            : posting
              ? [{ quantity: payload.quantity } as BillBatchPayload]
              : [];
          for (const b of batches) {
            await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: createdBill.id,
              lineId: lineRecord.id,
              locationId: createdBill.locationId,
              rate: Number(payload.rate || 0),
              billDate: createdBill.billDate,
              batch: b,
              post: posting,
            });
          }
          /* An item tracked at neither batch nor package level has no detail to
             remember: its quantity is the line's own column, and the anonymous
             batch below exists only to give the ledger something to hang on. So
             this branch stays posting-only, and a draft writes nothing for it. */
        } else if (posting && item?.trackInventory && item.inventoryTracking === 'none') {
          const batch = await createBatch(tx, {
            organizationId: orgId,
            itemId: item.id,
            sourceDocType: 'bill',
            sourceDocId: createdBill.id,
            userId: userId || undefined,
          });
          await postMovement(
            tx,
            {
              organizationId: orgId,
              batchId: batch.id,
              // Non-null by `posting`, which this branch is gated on.
              locationId: createdBill.locationId!,
              movementType: 'receipt',
              qtyIn: payload.quantity,
              valueIn: (payload.rate || 0) * payload.quantity,
              sourceDocType: 'bill',
              sourceDocId: createdBill.id,
              sourceDocLineId: lineRecord.id,
              postedAt: createdBill.billDate,
              userId: userId || undefined,
            },
            asResolvedBatch(batch),
          );
        }
      }
    }

    return createdBill;
  });
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
  return runAsDocument(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: { lineItems: { where: { isDeleted: false } } },
    });

    if (!existing) throw ApiError.notFound('Bill not found');

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
            customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            createdBy: userId,
            updatedBy: userId,
          },
          select: { id: true },
        });
        writtenLines.push({ payload: item, lineId: created.id });
      }
    } else {
      // No lines in the payload: the rows already on the bill ARE the lines, so
      // each one pairs with itself and no ordering question arises. They carry no
      // `batches`, which is what makes the whole-line fallback below apply.
      for (const row of existing.lineItems) {
        writtenLines.push({ payload: row as unknown as BillItemPayload, lineId: row.id });
      }
    }

    const effectiveLocationId =
      billData.locationId !== undefined ? billData.locationId : existing.locationId;
    const effectiveStatus = (billData.status ?? existing.status ?? '').toLowerCase();
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
    const goingOpen = existing.status.toLowerCase() === 'draft' && effectiveStatus === 'open';

    /**
     * 🔴 THE LEDGER IS THE RECORD OF WHETHER THIS BILL HAS POSTED — not a column
     * on the bill, which `updateBillSchema.partial()` lets an Open → Draft → Open
     * cycle rewrite freely. A document's movements are exactly the rows carrying
     * its id, and they are never deleted, so the answer survives any edit.
     */
    const alreadyPosted = await tx.stockLedgerEntry.count({
      where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: id },
    });

    /**
     * 🔴 REVERSE, THEN RE-POST — never post a second time on top of the first.
     *
     * This was a flat "post once, ever" guard. It did stop an Open → Draft → Open
     * cycle doubling the stock, but it also made a posted bill's stock
     * permanently uncorrectable: deleting a taka on the form returned 200,
     * replaced the line rows and left all three takas receivable. Withdrawing the
     * old postings first keeps the anti-doubling guarantee — the net on the books
     * is always exactly what the payload says — and makes the edit mean something.
     *
     * 🔴 GOING BACK TO DRAFT WITHDRAWS THE STOCK TOO — a draft holds none. That
     * is the other half of the same rule, and it is safe for the opposite reason:
     * there is no re-post to get wrong, because a bill that is not Open does not
     * post. Reopening it posts again from whatever the payload then says.
     *
     * 🔴 SO THE ONE CASE THAT MUST NOT REVERSE is a payload with no `lineItems`
     * that leaves the bill OPEN — a note, an attachment, a payment term. There
     * `writtenLines` falls back to the rows already on the bill, which carry no
     * `batches`, so reversing would withdraw the stock and re-post it from a
     * payload that never described it, flattening every taka into one untagged
     * lump on an edit that never mentioned them.
     */
    const rewritingLines = Boolean(lineItems);
    const mustReverse = alreadyPosted > 0 && (rewritingLines || effectiveStatus !== 'open');

    /**
     * 🔴 THE DOCUMENT ROWS ARE REWRITTEN WHENEVER THE LINES ARE — draft or open,
     * and independently of whether anything posts. That is what lets a draft be
     * edited over and over and still read back exactly what was typed.
     */
    const mustWrite = rewritingLines;
    const mustPost =
      effectiveStatus === 'open' &&
      !!effectiveLocationId &&
      (goingOpen || (alreadyPosted > 0 && rewritingLines));

    // Reversal FIRST and on its own: it withdraws what the OLD payload posted, so
    // it must not see the batches and packages the new one is about to create.
    if (mustReverse) {
      await reverseBillPostings(tx, {
        organizationId: orgId,
        billId: id,
        billNumber: existing.billNumber,
        userId: userId || null,
      });
    }

    if (mustWrite) {
      const itemIds = writtenLines.map((line) => line.payload.itemId);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, inventoryTracking: true, trackInventory: true },
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));

      /* Every package this save actually used, created ones included — which is
         why it is collected HERE and not read off the payload: a taka the user
         has just added carries no id until `createBatchUnits` gives it one. */
      const usedUnitIds = new Set<string>();

      for (const line of writtenLines) {
        const payload = line.payload;
        const lineRecord = { id: line.lineId };
        const item = itemsById.get(payload.itemId);

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          // Posting-only, same as on create — a draft never invents a batch.
          const batches = payload.batches?.length
            ? payload.batches
            : mustPost
              ? [{ quantity: Number(payload.quantity) } as BillBatchPayload]
              : [];
          for (const b of batches) {
            const { unitIds } = await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: id,
              lineId: lineRecord.id,
              locationId: effectiveLocationId,
              rate: Number(payload.rate || 0),
              billDate: effectiveBillDate,
              batch: b,
              post: mustPost,
            });
            for (const unitId of unitIds) usedUnitIds.add(unitId);
          }
          // Posting-only, for the same reason as on create: an item tracked at
          // neither level has no detail to remember.
        } else if (mustPost && item?.trackInventory && item.inventoryTracking === 'none') {
          const batch = await createBatch(tx, {
            organizationId: orgId,
            itemId: item.id,
            sourceDocType: 'bill',
            sourceDocId: id,
            userId: userId || undefined,
          });
          await postMovement(
            tx,
            {
              organizationId: orgId,
              batchId: batch.id,
              locationId: effectiveLocationId!,
              movementType: 'receipt',
              qtyIn: Number(payload.quantity),
              valueIn: Number(payload.rate || 0) * Number(payload.quantity),
              sourceDocType: 'bill',
              sourceDocId: id,
              sourceDocLineId: lineRecord.id,
              postedAt: effectiveBillDate,
              userId: userId || undefined,
            },
            asResolvedBatch(batch),
          );
        }
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
