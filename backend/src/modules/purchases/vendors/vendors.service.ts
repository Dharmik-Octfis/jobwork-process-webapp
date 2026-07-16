import { prisma } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

export async function getVendorsList(organizationId: string) {
  return prisma.vendor.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createNewVendor(
  organizationId: string,
  data: Omit<Prisma.VendorUncheckedCreateInput, 'organizationId'>
) {
  return prisma.vendor.create({
    data: {
      ...data,
      organizationId,
    },
  });
}
