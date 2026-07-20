import { prisma } from '../../../db/prisma.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';

export class ItemsService {
  async findMany(organizationId: string) {
    return prisma.item.findMany({
      // isDeleted: false — soft-deleted items are hidden from every read.
      where: { organizationId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUnique(id: string, organizationId: string) {
    const item = await prisma.item.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!item) {
      throw new Error('Item not found');
    }
    return item;
  }

  async create(organizationId: string, data: CreateItemDto, userId?: string) {
    return prisma.item.create({
      data: {
        ...data,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        organizationId,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  }

  async update(id: string, organizationId: string, data: UpdateItemDto, userId?: string) {
    await this.findUnique(id, organizationId);
    return prisma.item.update({
      where: { id },
      data: {
        ...data,
        deliveryDate: data.deliveryDate
          ? new Date(data.deliveryDate)
          : data.deliveryDate === null
            ? null
            : undefined,
        updatedBy: userId ?? null,
      },
    });
  }

  async delete(id: string, organizationId: string, userId?: string) {
    await this.findUnique(id, organizationId);
    // Soft delete: flip the flag and record who removed it via updatedBy.
    return prisma.item.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  }
}

export const itemsService = new ItemsService();
