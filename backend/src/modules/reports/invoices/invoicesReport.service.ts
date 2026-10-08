import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getInvoicesReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    customerId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    invoiceNumber?: string;
    customerName?: string;
    paymentTerms?: string;
    minTotal?: number;
    maxTotal?: number;
    invoiceCustomFields?: Record<string, unknown>;
  },
) {
  const {
    page = 1,
    pageSize = 20,
    customerId,
    status,
    fromDate,
    toDate,
    invoiceNumber,
    customerName,
    paymentTerms,
    minTotal,
    maxTotal,
    invoiceCustomFields,
  } = params;

  const skip = (page - 1) * pageSize;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.InvoiceWhereInput = {
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

    if (invoiceNumber) {
      where.invoiceNumber = { contains: invoiceNumber, mode: 'insensitive' };
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

    if (invoiceCustomFields) {
      const customFieldsWhere: Prisma.InvoiceWhereInput[] = [];
      Object.entries(invoiceCustomFields).forEach(([cfKey, value]) => {
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
      tx.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { contactName: true, companyName: true, paymentTerms: true } },
          location: true,
        },
      }),
      tx.invoice.count({ where }),
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

    const formattedItems = items.map((inv) => {
      return {
        id: inv.id,
        customerId: inv.customerId,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer?.contactName || inv.customer?.companyName || '-',
        locationName: inv.location?.name || '-',
        date: inv.date,
        dueDate: inv.dueDate,
        paymentTerms: resolvePt(inv.paymentTerms || inv.customer?.paymentTerms),
        total: Number(inv.totalAmount),
        status: inv.status,
        customFields: inv.customFields,
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
