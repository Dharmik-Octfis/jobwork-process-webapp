import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getPurchaseOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    perPage?: number;
    pageSize?: number;
    vendorId?: string;
    status?: string;
    deliveryType?: string;
    fromDate?: string;
    toDate?: string;
    poNumber?: string;
    vendorName?: string;
    purchaseOrderCustomFields?: Record<string, unknown>;
  },
) {
  const {
    page,
    perPage,
    pageSize = perPage,
    vendorId,
    status,
    deliveryType,
    fromDate,
    toDate,
    poNumber,
    vendorName,
    purchaseOrderCustomFields,
  } = params;

  const skip = pageSize && page ? (page - 1) * pageSize : undefined;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      isDeleted: false,
    };

    if (vendorId) {
      where.vendorId = vendorId;
    }
    if (status) {
      where.status = status;
    }
    if (deliveryType) {
      where.deliveryType = deliveryType;
    }
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }

    if (poNumber) {
      where.poNumber = { contains: poNumber, mode: 'insensitive' };
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

    if (purchaseOrderCustomFields) {
      const customFieldsWhere: Prisma.PurchaseOrderWhereInput[] = [];
      Object.entries(purchaseOrderCustomFields).forEach(([cfKey, value]) => {
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
      tx.purchaseOrder.findMany({
        where,
        ...(pageSize ? { skip: skip ?? 0, take: pageSize } : {}),
        orderBy: { date: 'desc' },
        include: {
          vendor: { select: { contactName: true, companyName: true, paymentTerms: true } },
          deliveryLocation: true,
          deliveryCustomer: true,
          location: true, // For issue location if needed
        },
      }),
      tx.purchaseOrder.count({ where }),
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

    const formattedItems = items.map((po) => {
      let deliveryAddress = '-';
      let locationName = po.location?.name;
      if (po.deliveryType === 'Location' && po.deliveryLocation) {
        deliveryAddress =
          po.deliveryLocation.addressString ||
          [
            po.deliveryLocation.street1,
            po.deliveryLocation.city,
            po.deliveryLocation.state,
            po.deliveryLocation.country,
          ]
            .filter(Boolean)
            .join(', ') ||
          '-';
        locationName = locationName || po.deliveryLocation.name;
      } else if (po.deliveryType === 'Customer' && po.deliveryCustomer) {
        deliveryAddress = po.deliveryCustomer.companyName || po.deliveryCustomer.contactName || '-';
      }

      return {
        id: po.id,
        vendorId: po.vendorId,
        poNumber: po.poNumber,
        vendorName: po.vendor?.contactName || po.vendor?.companyName || '-',
        locationName: locationName || '-',
        deliveryType: po.deliveryType,
        deliveryAddress,
        date: po.date,
        deliveryDate: po.deliveryDate,
        paymentTerms: resolvePt(po.paymentTerms || po.vendor?.paymentTerms),
        total: Number(po.totalAmount),
        status: po.status,
        customFields: po.customFields,
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
