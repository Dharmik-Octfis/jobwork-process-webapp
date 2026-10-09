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
    paymentTerms?: string;
    minTotal?: number;
    maxTotal?: number;
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
    paymentTerms,
    minTotal,
    maxTotal,
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

    if (paymentTerms) {
      where.paymentTerms = paymentTerms;
    }

    if (minTotal !== undefined || maxTotal !== undefined) {
      where.totalAmount = {};
      if (minTotal !== undefined) where.totalAmount.gte = minTotal;
      if (maxTotal !== undefined) where.totalAmount.lte = maxTotal;
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

    const [items, totalCount, paymentTermsList] = await Promise.all([
      tx.salesOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { contactName: true, companyName: true, paymentTerms: true } },
          location: true,
        },
      }),
      tx.salesOrder.count({ where }),
      tx.paymentTerm.findMany({
        where: { organizationId, isDeleted: false },
        select: { id: true, termName: true },
      }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page, pageSize, totalCount, totalPages: 0 },
      };
    }

    const ptMap = new Map(paymentTermsList.map((pt) => [pt.id, pt.termName]));
    const resolvePt = (pt: string | null | undefined) => (pt ? ptMap.get(pt) || pt : '-');

    const formattedItems = items.map((so) => {
      return {
        id: so.id,
        customerId: so.customerId,
        soNumber: so.soNumber,
        customerName: so.customer?.contactName || so.customer?.companyName || '-',
        locationName: so.location?.name || '-',
        date: so.date,
        deliveryDate: so.deliveryDate,
        paymentTerms: resolvePt(so.paymentTerms || so.customer?.paymentTerms),
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
