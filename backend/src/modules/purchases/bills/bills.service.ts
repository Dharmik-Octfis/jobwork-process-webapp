import { runAsTenant } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateBillPayload, UpdateBillPayload, BillItemPayload } from './bills.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { validateCustomFields } from '../../settings/customization/custom-fields/customFields.engine.ts';
import { loadActiveDefinitions } from '../../settings/customization/custom-fields/custom-fields.service.ts';
import { postMovement, createBatch } from '../../inventory/stock-ledger/stockLedger.service.ts';

const DUPLICATE_NUMBER = 'A bill with this number already exists.';

function billListWhere(organizationId: string, opts: ListQuery): Prisma.BillWhereInput {
  return {
    organization_id: organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.BillWhereInput>('bill', opts.filter),
    ...searchWhere<Prisma.BillWhereInput>(opts.search, [
      'bill_number',
      'notes',
      'status',
    ]),
  };
}

export async function getBillsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.bill.findMany({
      where: billListWhere(organizationId, opts),
      orderBy: { bill_date: 'desc' },
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

export async function getBillById(orgId: string, id: string) {
  return runAsTenant(orgId, async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id, organization_id: orgId, isDeleted: false },
      include: {
        line_items: {
          where: { isDeleted: false },
          include: { item: true },
        },
        vendor: { select: { contactName: true, email: true, phone: true, addresses: true } },
        location: true,
      },
    });

    if (!bill) return null;

    const lineItemIds = bill.line_items.map((li) => li.id);
    const movements = await tx.stockLedgerEntry.findMany({
      where: {
        sourceDocId: bill.id,
        sourceDocLineId: { in: lineItemIds },
        sourceDocType: 'bill',
      },
      include: {
        batch: true,
      },
    });

    const movementsByLineId = movements.reduce((acc, mov) => {
      if (mov.sourceDocLineId) {
        if (!acc[mov.sourceDocLineId]) acc[mov.sourceDocLineId] = [];
        acc[mov.sourceDocLineId]!.push(mov);
      }
      return acc;
    }, {} as Record<string, typeof movements>);

    const lineItemsWithBatches = bill.line_items.map(li => {
      const liMovements = movementsByLineId[li.id] || [];
      const batches = liMovements.map(m => ({
        batchId: m.batchId,
        supplierBatchRef: m.batch?.supplierBatchRef || undefined,
        manufacturerBatch: m.batch?.manufacturerBatch || undefined,
        manufacturedDate: m.batch?.manufacturedDate || undefined,
        expiryDate: m.batch?.expiryDate || undefined,
        quantity: Number(m.qtyIn) || 0,
        mrp: m.batch?.mrp !== null ? Number(m.batch?.mrp) : undefined,
        sellingPrice: m.batch?.sellingPrice !== null ? Number(m.batch?.sellingPrice) : undefined,
      }));
      return {
        ...li,
        batches: batches.length > 0 ? batches : undefined,
      };
    });

    return {
      ...bill,
      line_items: lineItemsWithBatches,
    };
  });
}

export async function createBill(orgId: string, userId: string, data: CreateBillPayload) {
  const { line_items: lineItems, custom_fields: rawCustomFields, total_amount: totalAmount, terms_and_conditions: termsAndConditions, attachments, notes: _notes, ...billData } = data as CreateBillPayload & { notes?: string };
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
      if (billData.bill_number.startsWith(seq.prefix)) {
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

    const createdBill = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.bill.create({
        data: {
          ...billData,
          total: totalAmount,
          terms: termsAndConditions,
          organization_id: orgId,
          source_po_id: billData.source_po_id || null,
          createdBy: userId,
          updatedBy: userId,
          documents: (attachments ?? []) as Prisma.InputJsonValue,
          customFields: customFields as Prisma.InputJsonObject,
          line_items: {
            create: lineItems.map((item: BillItemPayload) => ({
              item_id: item.item_id,
              quantity: item.quantity,
              rate: item.rate,
              discount_percentage: item.discount_percentage,
              discount: item.discount_amount,
              item_total: item.amount,
              customFields: (item.custom_fields ?? {}) as Prisma.InputJsonObject,
              createdBy: userId,
              updatedBy: userId,
            })),
          },
          activities: {
            create: {
              title: 'Bill Created',
              description: `Bill ${billData.bill_number} was created.`,
              performedBy,
              createdBy: userId,
              updatedBy: userId,
            },
          },
        },
        include: {
          line_items: true,
          activities: true,
        },
      }),
    );

    if (createdBill.location_id) {
      const itemIds = lineItems.map((li: BillItemPayload) => li.item_id);
      const items = await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId: orgId },
        select: { id: true, inventoryTracking: true, trackInventory: true }
      });
      const itemsById = new Map(items.map((i) => [i.id, i]));

      for (let i = 0; i < lineItems.length; i++) {
        const payload = lineItems[i];
        if (!payload) continue;
        const lineRecord = createdBill.line_items[i]; // assuming same order since Prisma returns in create order mostly
        if (!lineRecord) continue;
        const item = itemsById.get(payload.item_id);

        if (item?.trackInventory && item.inventoryTracking !== 'none') {
          const batches = payload.batches?.length ? payload.batches : [{ quantity: payload.quantity } as NonNullable<BillItemPayload['batches']>[number]];
          for (const b of batches) {
            let batchId = b.batchId;
            if (!batchId) {
              const batch = await createBatch(tx, {
                organizationId: orgId,
                itemId: item.id,
                supplierBatchRef: b.supplierBatchRef,
                manufacturerBatch: b.manufacturerBatch,
                manufacturedDate: b.manufacturedDate,
                expiryDate: b.expiryDate,
                mrp: b.mrp,
                sellingPrice: b.sellingPrice,
                sourceDocType: 'bill',
                sourceDocId: createdBill.id,
                userId: userId || undefined,
              });
              batchId = batch.id;
            }
            await postMovement(tx, {
              organizationId: orgId,
              batchId: batchId,
              locationId: createdBill.location_id,
              movementType: 'receipt',
              qtyIn: b.quantity,
              valueIn: (payload.rate || 0) * b.quantity,
              sourceDocType: 'bill',
              sourceDocId: createdBill.id,
              sourceDocLineId: lineRecord.id,
              userId: userId || undefined,
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
          await postMovement(tx, {
            organizationId: orgId,
            batchId: batch.id,
            locationId: createdBill.location_id,
            movementType: 'receipt',
            qtyIn: payload.quantity,
            valueIn: (payload.rate || 0) * payload.quantity,
            sourceDocType: 'bill',
            sourceDocId: createdBill.id,
            sourceDocLineId: lineRecord.id,
            userId: userId || undefined,
          });
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
  const { line_items: lineItems, custom_fields: rawCustomFields, total_amount: totalAmount, terms_and_conditions: termsAndConditions, attachments, notes: _notes, ...billData } = data as UpdateBillPayload & { notes?: string };
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organization_id: orgId, isDeleted: false },
      include: { line_items: { where: { isDeleted: false } } },
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

    return withUniqueViolation(DUPLICATE_NUMBER, async () => {
      await tx.bill.update({
        where: { id },
        data: {
          ...billData,
          total: totalAmount,
          terms: termsAndConditions,
          documents: attachments !== undefined ? (attachments as Prisma.InputJsonValue) : undefined,
          customFields: customFields !== undefined ? (customFields as Prisma.InputJsonObject) : undefined,
          updatedBy: userId,
          activities: {
            create: {
              title: 'Bill Updated',
              description: `Bill ${existing.bill_number} was updated.`,
              performedBy,
              createdBy: userId,
              updatedBy: userId,
            },
          },
        },
      });

      if (lineItems) {
        // Delete all old lines and create new ones (simplest approach for full replace)
        await tx.billItem.updateMany({
          where: { bill_id: id },
          data: { isDeleted: true, updatedBy: userId },
        });

        await tx.billItem.createMany({
          data: lineItems.map((item: BillItemPayload) => ({
            bill_id: id,
            item_id: item.item_id,
            quantity: item.quantity,
            rate: item.rate,
            discount_percentage: item.discount_percentage ?? null,
            discount_amount: item.discount_amount ?? null,
            item_total: item.amount,
            customFields: (item.custom_fields ?? {}) as Prisma.InputJsonObject,
            createdBy: userId,
            updatedBy: userId,
          })),
        });
      }
    });
  });
}

export async function deleteBill(orgId: string, id: string) {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id, organization_id: orgId, isDeleted: false },
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
      where: { billId, bill: { organization_id: orgId }, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getBillComments(orgId: string, billId: string) {
  return runAsTenant(orgId, (tx) =>
    tx.billComment.findMany({
      where: { billId, bill: { organization_id: orgId }, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createBillComment(orgId: string, billId: string, content: string, userId: string | null) {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { id: billId, organization_id: orgId, isDeleted: false },
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
      where: { id: commentId, billId: billId, bill: { organization_id: orgId }, isDeleted: false },
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

export async function updateBillNumberPreference(orgId: string, prefix: string, nextNumber: number) {
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
