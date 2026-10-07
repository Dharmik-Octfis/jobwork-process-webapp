import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getVendorsReport(
  organizationId: string,
  params: {
    page?: number;
    perPage?: number;
    pageSize?: number;
    contactNumber?: string;
    companyName?: string;
    status?: string;
    vendorType?: string;
  }
) {
  const {
    page,
    perPage,
    pageSize = perPage,
    contactNumber,
    companyName,
    status,
    vendorType,
  } = params;
  
  const skip = pageSize && page ? (page - 1) * pageSize : undefined;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.VendorWhereInput = {
      organizationId,
      isDeleted: false,
    };

    if (contactNumber) {
      where.contactNumber = { contains: contactNumber, mode: 'insensitive' };
    }
    if (companyName) {
      where.companyName = { contains: companyName, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }
    if (vendorType) {
      where.vendorTypes = { has: vendorType };
    }

    const [items, totalCount] = await Promise.all([
      tx.vendor.findMany({
        where,
        ...(pageSize ? { skip: skip ?? 0, take: pageSize } : {}),
        orderBy: { createdAt: 'desc' },
      }),
      tx.vendor.count({ where }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page: page || 1, pageSize: pageSize || totalCount, totalCount, totalPages: 0 },
      };
    }

    const formattedItems = items.map((vendor) => {
      return {
        id: vendor.id,
        contactNumber: vendor.contactNumber,
        companyName: vendor.companyName,
        contactName: vendor.contactName,
        primaryContact: [vendor.primaryContactFirstName, vendor.primaryContactLastName].filter(Boolean).join(' ') || null,
        email: vendor.email,
        phone: vendor.phone,
        currency: vendor.currency,
        paymentTerms: vendor.paymentTerms,
        notes: vendor.notes,
        customFields: vendor.customFields,
        createdAt: vendor.createdAt,
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
