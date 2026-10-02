import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getPurchaseOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    vendorId?: string;
    status?: string;
    deliveryType?: string;
    fromDate?: string;
    toDate?: string;
  }
) {
  const {
    page = 1,
    pageSize = 20,
    vendorId,
    status,
    deliveryType,
    fromDate,
    toDate,
  } = params;
  
  const skip = (page - 1) * pageSize;

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

    const [items, totalCount] = await Promise.all([
      tx.purchaseOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          vendor: { select: { contactName: true, companyName: true, paymentTerms: true } },
          deliveryLocation: true,
          deliveryCustomer: true,
          location: true, // For issue location if needed
        }
      }),
      tx.purchaseOrder.count({ where }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page, pageSize, totalCount, totalPages: 0 },
      };
    }

    const formattedItems = items.map((po) => {
      let deliveryAddress = '-';
      let locationName = po.location?.name;
      if (po.deliveryType === 'Location' && po.deliveryLocation) {
        deliveryAddress = po.deliveryLocation.addressString || [po.deliveryLocation.street1, po.deliveryLocation.city, po.deliveryLocation.state, po.deliveryLocation.country].filter(Boolean).join(', ') || '-';
        locationName = locationName || po.deliveryLocation.name;
      } else if (po.deliveryType === 'Customer' && po.deliveryCustomer) {
        deliveryAddress = po.deliveryCustomer.companyName || po.deliveryCustomer.contactName || '-';
      }

      return {
        id: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendor?.contactName || po.vendor?.companyName || '-',
        locationName: locationName || '-',
        deliveryType: po.deliveryType,
        deliveryAddress,
        date: po.date,
        deliveryDate: po.deliveryDate,
        paymentTerms: (() => {
          console.log(`PO: ${po.poNumber}, paymentTerms: ${po.paymentTerms}, vendor.paymentTerms: ${po.vendor?.paymentTerms}`);
          return po.paymentTerms || po.vendor?.paymentTerms || '-';
        })(),
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
        totalPages: Math.ceil(totalCount / pageSize),
      },
    };
  });
}
