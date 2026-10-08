import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getSalesOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    customerId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    soNumber?: string;
    customerName?: string;
    salesOrderCustomFields?: Record<string, unknown>;
  },
) {
  const {
    page = 1,
    pageSize = 20,
    customerId,
    status,
    fromDate,
    toDate,
    soNumber,
    customerName,
    salesOrderCustomFields,
  } = params;

  const skip = (page - 1) * pageSize;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.SalesOrderWhereInput = {
      organizationId,
      isDeleted: false,
    };

    if (customerId) {
      where.customerId = customerId;
    }
    if (status) {
      where.status = status;
    }
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }

    if (soNumber) {
      where.soNumber = { contains: soNumber, mode: 'insensitive' };
    }

    if (customerName) {
      where.customer = {
        isDeleted: false,
        OR: [
          { contactName: { contains: customerName, mode: 'insensitive' } },
          { companyName: { contains: customerName, mode: 'insensitive' } },
        ],
      };
    }

    if (salesOrderCustomFields) {
      const customFieldsWhere: Prisma.SalesOrderWhereInput[] = [];
      Object.entries(salesOrderCustomFields).forEach(([cfKey, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            customFieldsWhere.push({
              OR: value.map((v) => ({
                customFields: { path: [cfKey], array_contains: v },
              })),
            });
          } else {
            customFieldsWhere.push({
              OR: [
                { customFields: { path: [cfKey], equals: value } },
                { customFields: { path: [cfKey], array_contains: value } },
              ],
            });
          }
        }
      });
      if (customFieldsWhere.length > 0) {
        where.AND = customFieldsWhere;
      }
    }

    const [items, totalCount] = await Promise.all([
      tx.salesOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          customer: { select: { contactName: true, companyName: true, paymentTerms: true } },
          location: true,
        },
      }),
      tx.salesOrder.count({ where }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page, pageSize, totalCount, totalPages: 0 },
      };
    }

    const formattedItems = items.map((so) => {
      return {
        id: so.id,
        customerId: so.customerId,
        soNumber: so.soNumber,
        customerName: so.customer?.contactName || so.customer?.companyName || '-',
        locationName: so.location?.name || '-',
        date: so.date,
        deliveryDate: so.deliveryDate,
        paymentTerms: so.paymentTerms || so.customer?.paymentTerms || '-',
        total: Number(so.totalAmount),
        status: so.status,
        customFields: so.customFields,
      };
    });

    return {
      items: formattedItems,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    };
  });
}
