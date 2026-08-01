import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import type { CreateItemCategoryDto, UpdateItemCategoryDto } from './item-categories.schemas.ts';

export const createItemCategory = async (orgId: string, userId: string, data: CreateItemCategoryDto) => {
  return runAsTenant(orgId, (tx) =>
    tx.itemCategory.create({
      data: {
        organizationId: orgId,
        createdBy: userId,
        ...data,
      },
    })
  );
};

export const updateItemCategory = async (orgId: string, categoryId: string, userId: string, data: UpdateItemCategoryDto) => {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.itemCategory.findFirst({
      where: { id: categoryId, organizationId: orgId, isDeleted: false },
    });

    if (!existing) {
      throw new ApiError(404, 'Category not found');
    }

    return tx.itemCategory.update({
      where: { id: categoryId },
      data: {
        ...data,
        updatedBy: userId,
      },
    });
  });
};

export const deleteItemCategory = async (orgId: string, categoryId: string, userId: string) => {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.itemCategory.findFirst({
      where: { id: categoryId, organizationId: orgId, isDeleted: false },
      include: {
        children: {
          where: { isDeleted: false },
        },
      }
    });

    if (!existing) {
      throw new ApiError(404, 'Category not found');
    }

    if (existing.children.length > 0) {
      throw new ApiError(400, 'Cannot delete a category that has child categories');
    }

    return tx.itemCategory.update({
      where: { id: categoryId },
      data: {
        isDeleted: true,
        updatedBy: userId,
      },
    });
  });
};

export const fetchItemCategories = async (orgId: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.itemCategory.findMany({
      where: { organizationId: orgId, isDeleted: false },
      orderBy: [
        { name: 'asc' },
      ],
    })
  );
};
