import { runAsTenant } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateSalesOrderPayload, UpdateSalesOrderPayload } from './sales-orders.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import { priceLines } from '../../../lib/linePricing.ts';

const DUPLICATE_NUMBER = 'A sales order with this SO number already exists.';

function soListWhere(organizationId: string, opts: ListQuery): Prisma.SalesOrderWhereInput {
  const baseWhere: Prisma.SalesOrderWhereInput = {
    organizationId: organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.SalesOrderWhereInput>('sales_order', opts.filter),
    ...searchWhere<Prisma.SalesOrderWhereInput>(
      opts.search,
      ['soNumber', 'notes', 'paymentTerms', 'status'],
      (term) => [
        {
          customer: searchWhere<Prisma.CustomerWhereInput>(term, ['contactName', 'companyName']),
        },
      ],
    ),
  };

  if (opts.fieldFilters) {
    try {
      const filters = JSON.parse(opts.fieldFilters) as Record<string, unknown>;
      if (filters.customerId) {
        baseWhere.customerId = filters.customerId as string;
      }
    } catch (_e) {
      // Ignore invalid JSON
    }
  }

  return baseWhere;
}

export async function getSalesOrdersList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.salesOrder.findMany({
      where: soListWhere(organizationId, opts),
      orderBy: { date: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: {
        customer: { select: { contactName: true } },
        location: true,
      },
    });

    return pageSlice(rows, page, perPage);
  });
}

export async function countSalesOrders(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.salesOrder.count({ where: soListWhere(organizationId, opts) }),
  );
}

export async function getSalesOrderById(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.salesOrder.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: {
        lineItems: {
          where: { isDeleted: false },
          include: { item: true },
        },
        customer: { select: { contactName: true, email: true, phone: true, addresses: true } },
        location: true,
        invoices: { where: { isDeleted: false } },
      },
    }),
  );
}

export async function createSalesOrder(
  orgId: string,
  userId: string,
  data: CreateSalesOrderPayload,
) {
  const { lineItems: rawLineItems, ...soData } = data;
  const { lines: lineItems, subTotal, totalAmount } = priceLines(rawLineItems);
  return runAsTenant(orgId, async (tx) => {
    await assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date: soData.date,
      field: 'date',
      label: 'sales order',
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
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'sales_order' } },
    });

    if (seq) {
      if (soData.soNumber.startsWith(seq.prefix)) {
        const suffixPart = soData.soNumber.slice(seq.prefix.length);
        const match = suffixPart.match(/^0*(\d+)/);
        let newNextNumber = seq.nextNumber + 1;
        if (match && match[1]) {
          const extracted = parseInt(match[1], 10);
          if (!isNaN(extracted) && extracted >= seq.nextNumber) {
            newNextNumber = extracted + 1;
          }
        }
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: newNextNumber },
        });
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.salesOrder.create({
        data: {
          ...soData,
          subTotal,
          totalAmount,
          organizationId: orgId,
          createdBy: userId,
          updatedBy: userId,
          documents: (soData.documents ?? []) as Prisma.InputJsonValue,
          customFields: (soData.customFields ?? {}) as Prisma.InputJsonObject,
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
                title: 'Sales Order Created',
                description: `Sales order "${soData.soNumber}" created.`,
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
  });
}

export async function updateSalesOrder(
  orgId: string,
  id: string,
  userId: string,
  data: UpdateSalesOrderPayload,
) {
  // totals move only with the lines they are summed from
  const { lineItems: rawLineItems, subTotal: _s, totalAmount: _t, ...soData } = data;
  const priced = rawLineItems ? priceLines(rawLineItems) : undefined;
  const lineItems = priced?.lines;
  return runAsTenant(orgId, async (tx) => {
    if (soData.date !== undefined) {
      await assertOnOrAfterMigration(tx, {
        organizationId: orgId,
        date: soData.date,
        field: 'date',
        label: 'sales order',
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
      const so = await tx.salesOrder.updateMany({
        where: { id, organizationId: orgId, isDeleted: false },
        data: {
          ...soData,
          subTotal: priced?.subTotal,
          totalAmount: priced?.totalAmount,
          updatedBy: userId,
          documents:
            soData.documents !== undefined
              ? (soData.documents as Prisma.InputJsonValue)
              : undefined,
          customFields:
            soData.customFields !== undefined
              ? (soData.customFields as Prisma.InputJsonObject)
              : undefined,
        },
      });

      if (lineItems) {
        await tx.salesOrderItem.updateMany({
          where: { salesOrderId: id },
          data: { isDeleted: true, updatedBy: userId },
        });
        for (const item of lineItems) {
          await tx.salesOrderItem.create({
            data: {
              ...item,
              id: undefined,
              salesOrderId: id,
              createdBy: userId,
              updatedBy: userId,
              customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            },
          });
        }
      }

      await tx.salesOrderActivity.create({
        data: {
          salesOrderId: id,
          title: 'Sales Order Updated',
          description: `Sales order ${soData.soNumber || ''} updated.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return so;
    });
  });
}

export async function getSalesOrderActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.salesOrderActivity.findMany({
      where: {
        salesOrderId: id,
        isDeleted: false,
        salesOrder: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function deleteSalesOrder(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.salesOrder.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { isDeleted: true },
    }),
  );
}

export async function getSalesOrderNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'sales_order' } },
    });

    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          organizationId,
          entityType: 'sales_order',
          prefix: 'SO-',
          nextNumber: 1,
        },
      });
    }

    return seq;
  });
}

export async function updateSalesOrderNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, async (tx) => {
    return tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'sales_order' } },
      create: {
        organizationId,
        entityType: 'sales_order',
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

export async function getSalesOrderComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.salesOrderComment.findMany({
      where: {
        salesOrderId: id,
        isDeleted: false,
        salesOrder: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createSalesOrderComment(
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

    return tx.salesOrderComment.create({
      data: {
        salesOrderId: id,
        content,
        performedBy,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  });
}

export async function deleteSalesOrderComment(
  organizationId: string,
  salesOrderId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.salesOrderComment.findFirst({
      where: {
        id: commentId,
        salesOrderId,
        isDeleted: false,
        salesOrder: { organizationId: organizationId },
      },
    });

    if (!existingComment) {
      throw ApiError.notFound('Comment not found');
    }

    return tx.salesOrderComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
