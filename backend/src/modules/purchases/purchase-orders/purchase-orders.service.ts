import { runAsTenant } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import type {
  CreatePurchaseOrderPayload,
  UpdatePurchaseOrderPayload,
} from './purchase-orders.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';

const DUPLICATE_NUMBER = 'A purchase order with this PO number already exists.';

function poListWhere(organizationId: string, opts: ListQuery): Prisma.PurchaseOrderWhereInput {
  return {
    organization_id: organizationId,
    is_deleted: false,
    ...filterWhere<Prisma.PurchaseOrderWhereInput>('purchase_order', opts.filter),
    ...searchWhere<Prisma.PurchaseOrderWhereInput>(opts.search, [
      'purchaseorder_number',
      'notes',
      'payment_terms',
      'status',
    ]),
  };
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
      where: { id, organization_id: orgId, is_deleted: false },
      include: {
        line_items: {
          where: { is_deleted: false },
          include: { item: true },
        },
        vendor: { select: { contactName: true, email: true, phone: true, addresses: true } },
        deliveryLocation: true,
        deliveryCustomer: true,
        bills: true,
      },
    }),
  );
}

export async function createPurchaseOrder(
  orgId: string,
  userId: string,
  data: CreatePurchaseOrderPayload,
) {
  const { line_items: lineItems, ...poData } = data;
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
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'purchase_order' } },
    });

    if (seq) {
      if (poData.purchaseorder_number.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.purchaseOrder.create({
        data: {
          ...poData,
          organization_id: orgId,
          created_by: userId,
          updated_by: userId,
          documents: (poData.documents ?? []) as Prisma.InputJsonValue,
          custom_fields: (poData.custom_fields ?? {}) as Prisma.InputJsonObject,
          line_items: {
            create: lineItems.map((item) => ({
              ...item,
              custom_fields: (item.custom_fields ?? {}) as Prisma.InputJsonObject,
              created_by: userId,
              updated_by: userId,
            })),
          },
          activities: {
            create: [
              {
                title: 'Purchase Order Created',
                description: `Purchase order "${poData.purchaseorder_number}" created.`,
                performedBy,
                createdBy: userId,
                updatedBy: userId,
              },
            ],
          },
        },
        include: { line_items: true },
      }),
    );
  });
}

export async function updatePurchaseOrder(
  orgId: string,
  id: string,
  userId: string,
  data: UpdatePurchaseOrderPayload,
) {
  const { line_items: lineItems, ...poData } = data;
  return runAsTenant(orgId, async (tx) => {
    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, async () => {
      const po = await tx.purchaseOrder.updateMany({
        where: { id, organization_id: orgId, is_deleted: false },
        data: {
          ...poData,
          updated_by: userId,
          documents:
            poData.documents !== undefined
              ? (poData.documents as Prisma.InputJsonValue)
              : undefined,
          custom_fields: (poData.custom_fields ?? {}) as Prisma.InputJsonObject,
        },
      });

      if (lineItems) {
        await tx.purchaseOrderItem.updateMany({
          where: { purchaseorder_id: id },
          data: { is_deleted: true, updated_by: userId },
        });
        for (const item of lineItems) {
          await tx.purchaseOrderItem.create({
            data: {
              ...item,
              id: undefined,
              purchaseorder_id: id,
              created_by: userId,
              updated_by: userId,
              custom_fields: (item.custom_fields ?? {}) as Prisma.InputJsonObject,
            },
          });
        }
      }

      await tx.purchaseOrderActivity.create({
        data: {
          purchaseOrderId: id,
          title: 'Purchase Order Updated',
          description: `Purchase order ${poData.purchaseorder_number || ''} updated.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

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
           
          organization_id: organizationId,
          is_deleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function deletePurchaseOrder(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.purchaseOrder.updateMany({
      where: { id, organization_id: orgId, is_deleted: false },
      data: { is_deleted: true },
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
           
          organization_id: organizationId,
          is_deleted: false,
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
        purchaseOrder: { organization_id: organizationId },
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
