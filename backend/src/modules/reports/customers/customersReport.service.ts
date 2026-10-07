import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getCustomersReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    contactNumber?: string;
    companyName?: string;
    status?: string;
    customerType?: string;
  }
) {
  const {
    page = 1,
    pageSize = 20,
    contactNumber,
    companyName,
    status,
    customerType,
  } = params;
  
  const skip = (page - 1) * pageSize;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.CustomerWhereInput = {
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
    if (customerType) {
      where.customerType = customerType;
    }

    const [items, totalCount] = await Promise.all([
      tx.customer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              contactPersons: { where: { isDeleted: false } },
            },
          },
        },
      }),
      tx.customer.count({ where }),
    ]);

    if (items.length === 0) {
      return {
        items: [],
        pagination: { page, pageSize, totalCount, totalPages: 0 },
      };
    }

    const formattedItems = items.map((customer) => {
      return {
        id: customer.id,
        contactNumber: customer.contactNumber,
        customerType: customer.customerType,
        companyName: customer.companyName,
        contactName: customer.contactName,
        primaryContact: [customer.primaryContactFirstName, customer.primaryContactLastName].filter(Boolean).join(' ') || null,
        email: customer.email,
        phone: customer.phone,
        currency: customer.currency,
        paymentTerms: customer.paymentTerms,
        notes: customer.notes,
        customFields: customer.customFields,
        createdAt: customer.createdAt,
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
