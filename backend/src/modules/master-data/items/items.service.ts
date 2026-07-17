import { prisma } from '../../../db/prisma.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';

export class ItemsService {
  async findMany(organizationId: string) {
    return prisma.item.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUnique(id: string, organizationId: string) {
    const item = await prisma.item.findFirst({
      where: { id, organizationId },
    });
    if (!item) {
      throw new Error('Item not found');
    }
    return item;
  }

  async create(organizationId: string, data: CreateItemDto) {
    return prisma.item.create({
      data: {
        ...data,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        organizationId,
      },
    });
  }

  async update(id: string, organizationId: string, data: UpdateItemDto) {
    await this.findUnique(id, organizationId);
    return prisma.item.update({
      where: { id },
      data: {
        ...data,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : data.deliveryDate === null ? null : undefined,
      },
    });
  }

  async delete(id: string, organizationId: string) {
    await this.findUnique(id, organizationId);
    return prisma.item.delete({
      where: { id },
    });
  }
}

export const itemsService = new ItemsService();
