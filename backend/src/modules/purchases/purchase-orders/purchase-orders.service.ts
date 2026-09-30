import { runAsTenant } from '../../../db/prisma.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  CreatePurchaseOrderPayload,
  PurchaseOrderItemPayload,
  UpdatePurchaseOrderPayload,
} from './purchase-orders.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import { approvalTriggerService } from '../../automation/approval-processes/approvalTrigger.service.ts';

const DUPLICATE_NUMBER = 'A purchase order with this PO number already exists.';

/**
 * Line and document totals are derived here, never taken from the client: a PO
 * whose lines did not sum to its total was only as correct as whoever sent it.
 * A percentage wins over an amount; an amount above the line's value is refused.
 */
export function priceLines(lineItems: PurchaseOrderItemPayload[]) {
  const zero = new Prisma.Decimal(0);
  let subTotal = zero;
  let totalAmount = zero;
  const lines = lineItems.map((line, index) => {
    const gross = new Prisma.Decimal(line.quantity).times(line.rate).toDecimalPlaces(2);
    const discount =
      line.discountPercentage != null
        ? gross.times(line.discountPercentage).dividedBy(100).toDecimalPlaces(2)
        : new Prisma.Decimal(line.discount ?? 0).toDecimalPlaces(2);
    if (discount.greaterThan(gross)) {
      throw ApiError.badRequest('Discount cannot exceed the line amount.', {
        [`lineItems.${index}.discount`]: 'Discount cannot exceed the line amount.',
      });
    }
    const itemTotal = gross.minus(discount);
    subTotal = subTotal.plus(gross);
    totalAmount = totalAmount.plus(itemTotal);
    return { ...line, discount, itemTotal };
  });
  return { lines, subTotal, totalAmount };
}

function poListWhere(organizationId: string, opts: ListQuery): Prisma.PurchaseOrderWhereInput {
  const baseWhere: Prisma.PurchaseOrderWhereInput = {
    organizationId: organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.PurchaseOrderWhereInput>('purchase_order', opts.filter),
    ...searchWhere<Prisma.PurchaseOrderWhereInput>(opts.search, [
      'poNumber',
      'notes',
      'paymentTerms',
      'status',
    ]),
  };

  if (opts.fieldFilters) {
    try {
      const filters = JSON.parse(opts.fieldFilters) as Record<string, unknown>;
      if (filters.vendorId) {
        baseWhere.vendorId = filters.vendorId as string;
      }
    } catch (_e) {
      // Ignore invalid JSON
    }
  }

  return baseWhere;
}

export async function getPurchaseOrdersList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.purchaseOrder.findMany({
      where: poListWhere(organizationId, opts),
      orderBy: { date: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: {
        vendor: { select: { contactName: true } },
        deliveryLocation: true,
        deliveryCustomer: true,
      },
    });

    return pageSlice(rows, page, perPage);
  });
}

export async function countPurchaseOrders(
  organizationId: string,
  opts: ListQuery,
): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.purchaseOrder.count({ where: poListWhere(organizationId, opts) }),
  );
}

export async function getPurchaseOrderById(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.purchaseOrder.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: {
        lineItems: {
          where: { isDeleted: false },
          include: { item: { include: { stockingUom: { select: { symbol: true } } } } },
        },
        vendor: { select: { contactName: true, email: true, phone: true, addresses: true } },
        deliveryLocation: true,
        deliveryCustomer: true,
        // a deleted bill must drop off the PO, or it still reads BILLED and links to a 404
        bills: { where: { isDeleted: false } },
      },
    }),
  );
}

export async function createPurchaseOrder(
  orgId: string,
  userId: string,
  data: CreatePurchaseOrderPayload,
) {
  const { lineItems: rawLineItems, ...poData } = data;
  const { lines: lineItems, subTotal, totalAmount } = priceLines(rawLineItems);
  return runAsTenant(orgId, async (tx) => {
    await assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date: poData.date,
      field: 'date',
      label: 'purchase order',
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
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'purchase_order' } },
    });

    if (seq) {
      if (poData.poNumber.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    const createdPo = await withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.purchaseOrder.create({
        data: {
          ...poData,
          subTotal,
          totalAmount,
          organizationId: orgId,
          createdBy: userId,
          updatedBy: userId,
          documents: (poData.documents ?? []) as Prisma.InputJsonValue,
          customFields: (poData.customFields ?? {}) as Prisma.InputJsonObject,
          lineItems: {
            create: lineItems.map((item) => ({
              ...item,
              customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
              createdBy: userId,
              updatedBy: userId,
            })),
          },
          activities: {
            create: [
              {
                title: 'Purchase Order Created',
                description: `Purchase order "${poData.poNumber}" created.`,
                performedBy,
                createdBy: userId,
                updatedBy: userId,
              },
            ],
          },
        },
        include: { lineItems: true },
      }),
    );

    // Trigger approval workflow evaluation asynchronously post-commit
    approvalTriggerService
      .trigger({
        organizationId: orgId,
        moduleId: 'purchase_orders',
        recordId: createdPo.id,
        recordTitle: `PO #${createdPo.poNumber}`,
        triggerType: 'CREATE',
        record: createdPo as unknown as Record<string, unknown>,
        actorUserId: userId,
      })
      .catch((err) => console.error('[ApprovalTrigger] Error in create purchase order:', err));

    return createdPo;
  });
}

export async function updatePurchaseOrder(
  orgId: string,
  id: string,
  userId: string,
  data: UpdatePurchaseOrderPayload,
) {
  // totals move only with the lines they are summed from
  const { lineItems: rawLineItems, subTotal: _s, totalAmount: _t, ...poData } = data;
  const priced = rawLineItems ? priceLines(rawLineItems) : undefined;
  const lineItems = priced?.lines;
  return runAsTenant(orgId, async (tx) => {
    // `updatePurchaseOrderSchema` is partial, so an edit that does not touch the
    // date must not be refused for one it never sent.
    if (poData.date !== undefined) {
      await assertOnOrAfterMigration(tx, {
        organizationId: orgId,
        date: poData.date,
        field: 'date',
        label: 'purchase order',
      });
    }

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, async () => {
      const po = await tx.purchaseOrder.updateMany({
        where: { id, organizationId: orgId, isDeleted: false },
        data: {
          ...poData,
          subTotal: priced?.subTotal,
          totalAmount: priced?.totalAmount,
          updatedBy: userId,
          documents:
            poData.documents !== undefined
              ? (poData.documents as Prisma.InputJsonValue)
              : undefined,
          // Only when sent — `?? {}` here wiped every custom field on any PATCH
          // that did not carry them (a note, a status change).
          customFields:
            poData.customFields !== undefined
              ? (poData.customFields as Prisma.InputJsonObject)
              : undefined,
        },
      });

      if (lineItems) {
        await tx.purchaseOrderItem.updateMany({
          where: { purchaseOrderId: id },
          data: { isDeleted: true, updatedBy: userId },
        });
        for (const item of lineItems) {
          await tx.purchaseOrderItem.create({
            data: {
              ...item,
              id: undefined,
              purchaseOrderId: id,
              createdBy: userId,
              updatedBy: userId,
              customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            },
          });
        }
      }

      await tx.purchaseOrderActivity.create({
        data: {
          purchaseOrderId: id,
          title: 'Purchase Order Updated',
          description: `Purchase order ${poData.poNumber || ''} updated.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Trigger approval workflow evaluation asynchronously post-commit
      approvalTriggerService
        .trigger({
          organizationId: orgId,
          moduleId: 'purchase_orders',
          recordId: id,
          recordTitle: `PO #${poData.poNumber || id}`,
          triggerType: 'EDIT',
          record: {
            id,
            ...poData,
            // approval rules can key on the amount, so they see the server's figure
            ...(priced && {
              subTotal: priced.subTotal.toNumber(),
              totalAmount: priced.totalAmount.toNumber(),
            }),
          },
          actorUserId: userId,
        })
        .catch((err) => console.error('[ApprovalTrigger] Error in update purchase order:', err));

      return po;
    });
  });
}

export async function getPurchaseOrderActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.purchaseOrderActivity.findMany({
      where: {
        purchaseOrderId: id,
        isDeleted: false,
        purchaseOrder: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function deletePurchaseOrder(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.purchaseOrder.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { isDeleted: true },
    }),
  );
}

export async function getPurchaseOrderNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'purchase_order' } },
    });

    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          organizationId,
          entityType: 'purchase_order',
          prefix: 'PO-',
          nextNumber: 1,
        },
      });
    }

    return seq;
  });
}

export async function updatePurchaseOrderNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, async (tx) => {
    return tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'purchase_order' } },
      create: {
        organizationId,
        entityType: 'purchase_order',
        prefix,
        nextNumber,
      },
      update: {
        prefix,
        nextNumber,
      },
    });
  });
}

export async function getPurchaseOrderComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.purchaseOrderComment.findMany({
      where: {
        purchaseOrderId: id,
        isDeleted: false,
        purchaseOrder: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createPurchaseOrderComment(
  organizationId: string,
  id: string,
  content: string,
  userId: string | null,
) {
  return runAsTenant(organizationId, async (tx) => {
    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return tx.purchaseOrderComment.create({
      data: {
        purchaseOrderId: id,
        content,
        performedBy,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  });
}

export async function deletePurchaseOrderComment(
  organizationId: string,
  purchaseOrderId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.purchaseOrderComment.findFirst({
      where: {
        id: commentId,
        purchaseOrderId,
        isDeleted: false,
        purchaseOrder: { organizationId: organizationId },
      },
    });

    if (!existingComment) {
      throw ApiError.notFound('Comment not found');
    }

    return tx.purchaseOrderComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
