import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getBillsReport(
  organizationId: string,
  params: {
    page?: number;
    perPage?: number;
    pageSize?: number;
    vendorId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    billNumber?: string;
    vendorName?: string;
    locationName?: string;
    paymentTerms?: string;
    fromDeliveryDate?: string;
    toDeliveryDate?: string;
    total?: string;
    billCustomFields?: Record<string, unknown>;
  },
) {
  const {
    page,
    perPage,
    pageSize = perPage,
    vendorId,
    status,
    fromDate,
    toDate,
    billNumber,
    vendorName,
    locationName,
    paymentTerms,
    fromDeliveryDate,
    toDeliveryDate,
    total,
    billCustomFields,
  } = params;

  const skip = pageSize && page ? (page - 1) * pageSize : undefined;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.BillWhereInput = {
      organizationId,
      isDeleted: false,
    };

    if (vendorId) {
      where.vendorId = vendorId;
    }
    if (status) {
      where.status = status;
    }
    if (fromDate || toDate) {
      where.billDate = {};
      if (fromDate) where.billDate.gte = new Date(fromDate);
      if (toDate) where.billDate.lte = new Date(toDate);
    }

    if (billNumber) {
      where.billNumber = { contains: billNumber, mode: 'insensitive' };
    }

    if (vendorName) {
      where.vendor = {
        isDeleted: false,
        OR: [
          { contactName: { contains: vendorName, mode: 'insensitive' } },
          { companyName: { contains: vendorName, mode: 'insensitive' } },
        ],
      };
    }

    if (locationName) {
      where.location = {
        name: { contains: locationName, mode: 'insensitive' },
      };
    }

    if (paymentTerms) {
      where.paymentTerms = { contains: paymentTerms, mode: 'insensitive' };
    }

    if (total) {
      where.totalAmount = Number(total);
    }

    if (fromDeliveryDate || toDeliveryDate) {
      where.dueDate = {};
      if (fromDeliveryDate) where.dueDate.gte = new Date(fromDeliveryDate);
      if (toDeliveryDate) where.dueDate.lte = new Date(toDeliveryDate);
    }

    if (billCustomFields) {
      const customFieldsWhere: Prisma.BillWhereInput[] = [];
      Object.entries(billCustomFields).forEach(([cfKey, value]) => {
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
      tx.bill.findMany({
        where,
        ...(pageSize ? { skip: skip ?? 0, take: pageSize } : {}),
        orderBy: { billDate: 'desc' },
        include: {
          vendor: { select: { contactName: true, companyName: true, paymentTerms: true } },
          location: true,
        },
      }),
      tx.bill.count({ where }),
      tx.paymentTerm.findMany({
        where: { organizationId, isDeleted: false },
        select: { id: true, termName: true },
      }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page: page || 1, pageSize: pageSize || totalCount, totalCount, totalPages: 0 },
      };
    }

    const ptMap = new Map(paymentTermsList.map((pt) => [pt.id, pt.termName]));
    const resolvePt = (pt: string | null | undefined) => (pt ? ptMap.get(pt) || pt : '-');

    const formattedItems = items.map((bill) => {
      const locationName = bill.location?.name;

      return {
        id: bill.id,
        vendorId: bill.vendorId,
        billNumber: bill.billNumber,
        vendorName: bill.vendor?.contactName || bill.vendor?.companyName || '-',
        locationName: locationName || '-',
        date: bill.billDate,
        deliveryDate: bill.dueDate,
        paymentTerms: resolvePt(bill.paymentTerms || bill.vendor?.paymentTerms),
        total: Number(bill.totalAmount),
        status: bill.status,
        customFields: bill.customFields,
      };
    });

    return {
      items: formattedItems,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: pageSize ? Math.ceil(totalCount / pageSize) : 1,
      },
    };
  });
}
