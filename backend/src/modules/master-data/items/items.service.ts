import { runAsTenant } from '../../../db/prisma.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';
import { uploadFile } from '../../../lib/storage.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

export class ItemsService {
  async findMany(organizationId: string) {
    return runAsTenant(organizationId, (tx) =>
      tx.item.findMany({
        where: { organizationId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      })
    );
  }

  async findUnique(id: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw new Error('Item not found');
      }
      return item;
    });
  }

  async getActivities(id: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      // First verify the item exists and belongs to the org
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!item) {
        throw new Error('Item not found');
      }

      // Then fetch its activities
      return tx.itemActivity.findMany({
        where: { itemId: id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async create(organizationId: string, data: CreateItemDto, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const item = await tx.item.create({
        data: {
          ...data,
          deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Item Created',
          description: `Item ${item.name} was created.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return item;
    });
  }

  async update(id: string, organizationId: string, data: UpdateItemDto, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw new Error('Item not found');
      }

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const updatedItem = await tx.item.update({
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

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Item Updated',
          description: `Item ${item.name} was updated.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return updatedItem;
    });
  }

  async delete(id: string, organizationId: string, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw new Error('Item not found');
      }

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const deletedItem = await tx.item.update({
        where: { id },
        data: { isDeleted: true, updatedBy: userId ?? null },
      });

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Item Deleted',
          description: `Item ${item.name} was marked as deleted.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return deletedItem;
    });
  }
  async uploadImages(
    id: string,
    organizationId: string,
    files: { [fieldname: string]: Express.Multer.File[] },
    userId?: string
  ) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw new Error('Item not found');
      }

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const updateData: Prisma.ItemUncheckedUpdateInput = {};
      
      const processFile = async (file: Express.Multer.File) => {
        const timestamp = Date.now();
        const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `items/${organizationId}/${id}/${timestamp}-${originalName}`;
        
        await uploadFile({
          key,
          body: file.buffer,
          contentType: file.mimetype,
        });
        
        return key;
      };

      if (files.frontImage && files.frontImage.length > 0 && files.frontImage[0]) {
        updateData.frontImage = await processFile(files.frontImage[0]);
      }
      
      if (files.rearImage && files.rearImage.length > 0 && files.rearImage[0]) {
        updateData.rearImage = await processFile(files.rearImage[0]);
      }
      
      if (files.images && files.images.length > 0) {
        const uploadedImageKeys = await Promise.all(
          files.images.filter(Boolean).map((file) => processFile(file))
        );
        
        // Append to existing images array if it exists
        const existingImages = item.images || [];
        // Cap the total extra images at 3 if needed, or simply append them.
        // User requested "upload img 3 in short 5 img". Multer limits to 3 per request.
        updateData.images = [...existingImages, ...uploadedImageKeys];
      }
      
      if (Object.keys(updateData).length === 0) {
        return item; // Nothing to update
      }

      updateData.updatedBy = userId ?? null;

      const updatedItem = await tx.item.update({
        where: { id },
        data: updateData,
      });

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Item Images Uploaded',
          description: `Images for item ${item.name} were uploaded.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return updatedItem;
    });
  }
}

export const itemsService = new ItemsService();
