import { runAsTenant } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateBillPayload, UpdateBillPayload, BillItemPayload } from './bills.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { validateCustomFields } from '../../settings/customization/custom-fields/customFields.engine.ts';
import { loadActiveDefinitions } from '../../settings/customization/custom-fields/custom-fields.service.ts';
import {
  asResolvedBatch,
  postMovement,
  createBatch,
  createBatchUnits,
  resolveExistingBatchUnits,
  type ResolvedBatches,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
import type { TenantClient } from '../../../db/prisma.ts';

const DUPLICATE_NUMBER = 'A bill with this number already exists.';

/** Same tolerance `assertAllocationsBalance` uses one level up: an exact
 * comparison rejects `3 × 33.3333` for being a billionth off. */
const QTY_EPSILON = 0.00005;

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
    locationId: string;
    rate: number;
    batch: BillBatchPayload;
  },
) {
  const { organizationId, userId, itemId, billId, lineId, locationId, rate, batch } = args;
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
        userId: userId || undefined,
      },
      resolved,
    );
  }

  const untagged = quantity - unitTotal;
  // A batch fully broken into packages leaves nothing behind, and a zero-quantity
  // movement is one `postMovement` refuses by design — one direction per row.
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
        userId: userId || undefined,
      },
      resolved,
    );
  }
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

/** One batch as the bill form reads it back, seeded from its first ledger row.
 * Quantity and `units` are then accumulated across that batch's other rows. */
function toBatchReadback(m: {
  batchId: string;
  qtyIn: Prisma.Decimal;
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
    batchId: m.batchId,
    supplierBatchRef: m.batch?.supplierBatchRef || undefined,
    manufacturerBatch: m.batch?.manufacturerBatch || undefined,
    manufacturedDate: m.batch?.manufacturedDate || undefined,
    expiryDate: m.batch?.expiryDate || undefined,
    quantity: Number(m.qtyIn) || 0,
    mrp: m.batch?.mrp != null ? Number(m.batch.mrp) : undefined,
    sellingPrice: m.batch?.sellingPrice != null ? Number(m.batch.sellingPrice) : undefined,
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

    const lineItemIds = bill.lineItems.map((li) => li.id);
    const movements = await tx.stockLedgerEntry.findMany({
      where: {
        sourceDocId: bill.id,
        sourceDocLineId: { in: lineItemIds },
        sourceDocType: 'bill',
      },
      include: {
        batch: true,
        // The package this row is, when the org runs a unit level. Null on the
        // untagged remainder and on every row written before the level existed.
        batchUnit: { select: { id: true, seq: true, label: true } },
      },
      orderBy: { postedAt: 'asc' },
    });

    const movementsByLineId = movements.reduce(
      (acc, mov) => {
        if (mov.sourceDocLineId) {
          if (!acc[mov.sourceDocLineId]) acc[mov.sourceDocLineId] = [];
          acc[mov.sourceDocLineId]!.push(mov);
        }
        return acc;
      },
      {} as Record<string, typeof movements>,
    );

    const lineItemsWithBatches = bill.lineItems.map((li) => {
      const liMovements = movementsByLineId[li.id] || [];

      /**
       * 🔴 GROUPED BY BATCH, because one batch is no longer one row.
       *
       * A batch broken into packages posts one movement per package plus one for
       * the untagged remainder, so the flat map this used to be would render the
       * same batch three times, each showing a slice of its quantity — the dialog
       * would then send those slices back as three separate batches on the next
       * save. The batch's quantity is the SUM of its rows; the packages are the
       * rows that name one.
       */
      const byBatch = new Map<string, ReturnType<typeof toBatchReadback>>();
      for (const m of liMovements) {
        const existing = byBatch.get(m.batchId);
        const row = existing ?? toBatchReadback(m);
        if (existing) row.quantity += Number(m.qtyIn) || 0;
        if (m.batchUnit) {
          row.units.push({
            batchUnitId: m.batchUnit.id,
            label: m.batchUnit.label,
            quantity: Number(m.qtyIn) || 0,
          });
        }
        byBatch.set(m.batchId, row);
      }

      const batches = [...byBatch.values()];
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
  return runAsTenant(orgId, async (tx) => {
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

    if (createdBill.status?.toLowerCase() === 'open' && createdBill.locationId) {
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
          const batches = payload.batches?.length
            ? payload.batches
            : [{ quantity: payload.quantity } as BillBatchPayload];
          for (const b of batches) {
            await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: createdBill.id,
              lineId: lineRecord.id,
              locationId: createdBill.locationId,
              rate: Number(payload.rate || 0),
              batch: b,
            });
          }
        } else if (item?.trackInventory && item.inventoryTracking === 'none') {
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
              locationId: createdBill.locationId,
              movementType: 'receipt',
              qtyIn: payload.quantity,
              valueIn: (payload.rate || 0) * payload.quantity,
              sourceDocType: 'bill',
              sourceDocId: createdBill.id,
              sourceDocLineId: lineRecord.id,
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
  return runAsTenant(orgId, async (tx) => {
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
    if (
      existing.status.toLowerCase() === 'draft' &&
      billData.status?.toLowerCase() === 'open' &&
      effectiveLocationId
    ) {
      /**
       * 🔴 POST ONCE, EVER — the guard that makes an Open → Draft → Open cycle
       * safe.
       *
       * `updateBillSchema` is `.partial()`, so a bill can be set back to Draft and
       * forward to Open again, and this block would post a SECOND full set of
       * receipt rows: the stock, and its value, doubled. Nothing checked, because
       * `createBill` and this branch each only knew about their own posting.
       *
       * Now the ledger itself is the record of whether it has happened. It is the
       * right thing to ask — a document's movements are exactly the rows carrying
       * its id, and they are never deleted, so the answer survives anything the
       * bill's own columns are edited into.
       */
      const alreadyPosted = await tx.stockLedgerEntry.count({
        where: { organizationId: orgId, sourceDocType: 'bill', sourceDocId: id },
      });

      const itemIds = writtenLines.map((line) => line.payload.itemId);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, inventoryTracking: true, trackInventory: true },
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));

      const toPost = alreadyPosted > 0 ? [] : writtenLines;
      for (const line of toPost) {
        const payload = line.payload;
        const lineRecord = { id: line.lineId };
        const item = itemsById.get(payload.itemId);

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          const batches = payload.batches?.length
            ? payload.batches
            : [{ quantity: Number(payload.quantity) } as BillBatchPayload];
          for (const b of batches) {
            await receiveBillBatch(tx, {
              organizationId: orgId,
              userId: userId || null,
              itemId: item.id,
              billId: id,
              lineId: lineRecord.id,
              locationId: effectiveLocationId,
              rate: Number(payload.rate || 0),
              batch: b,
            });
          }
        } else if (item?.trackInventory && item.inventoryTracking === 'none') {
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
              locationId: effectiveLocationId,
              movementType: 'receipt',
              qtyIn: Number(payload.quantity),
              valueIn: Number(payload.rate || 0) * Number(payload.quantity),
              sourceDocType: 'bill',
              sourceDocId: id,
              sourceDocLineId: lineRecord.id,
              userId: userId || undefined,
            },
            asResolvedBatch(batch),
          );
        }
      }
    }

    return await tx.bill.findFirst({ where: { id } });
  });
}

export async function deleteBill(orgId: string, id: string) {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Bill not found');

    await tx.bill.update({
      where: { id },
      data: { isDeleted: true },
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
