import { runAsTenant } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';
import { uploadFile } from '../../lib/storage.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../settings/customization/custom-fields/customFields.engine.ts';
import type { Prisma } from '../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../lib/pagination.ts';
import { filterWhere } from '../settings/list-views/listFilters.catalog.ts';

export class ItemsService {
  /**
   * One paginated list endpoint that also does search — same shape as vendors /
   * customers, via the shared `searchWhere`/`pageContext` helpers. See
   * `lib/pagination.ts` and memory: list-search-pagination-pattern.
   */
  /** The one `where` both the list and the count are built from — see vendors. */
  private listWhere(organizationId: string, opts: ListQuery): Prisma.ItemWhereInput {
    return {
      // The `where` is what the query *means*; RLS is the net under it. Both stay.
      organizationId,
      // isDeleted: false — soft-deleted items never surface, search included.
      isDeleted: false,
      // Preset view ("Goods"), spread in so it narrows rather than replaces.
      ...filterWhere<Prisma.ItemWhereInput>('item', opts.filter),
      ...searchWhere<Prisma.ItemWhereInput>(opts.search, [
        'name',
        'sku',
        'aliasName',
        'category',
        'brand',
        'hsnCode',
      ]),
    };
  }

  async findMany(organizationId: string, opts: ListQuery) {
    const { page, perPage } = opts;
    return runAsTenant(organizationId, async (tx) => {
      // No COUNT here — one row beyond the page answers "is there a next page?".
      const rows = await tx.item.findMany({
        where: this.listWhere(organizationId, opts),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: takeForPage(perPage),
      });

      return pageSlice(rows, page, perPage);
    });
  }

  /** Total matching items — only run when the client explicitly asks for it. */
  async count(organizationId: string, opts: ListQuery): Promise<number> {
    return runAsTenant(organizationId, (tx) =>
      tx.item.count({ where: this.listWhere(organizationId, opts) }),
    );
  }

  async findUnique(id: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw ApiError.notFound('Item not found');
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
        throw ApiError.notFound('Item not found');
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
      const { customFields: rawCustomFields, ...rest } = data;

      const defs = await loadActiveDefinitions(tx, organizationId, 'item');
      const customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'create',
      }) as Prisma.InputJsonValue;

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const item = await tx.item.create({
        data: {
          ...rest,
          customFields,
          deliveryDate: rest.deliveryDate ? new Date(rest.deliveryDate) : null,
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
        throw ApiError.notFound('Item not found');
      }

      const { customFields: rawCustomFields, ...rest } = data;

      // Only re-validate when the client sends custom fields; otherwise leave the
      // stored blob untouched. Required policy (b) uses the existing values.
      let customFields: Prisma.InputJsonValue | undefined;
      if (rawCustomFields !== undefined) {
        const defs = await loadActiveDefinitions(tx, organizationId, 'item');
        customFields = validateCustomFields({
          defs,
          input: rawCustomFields,
          mode: 'update',
          existing: item.customFields,
        }) as Prisma.InputJsonValue;
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
          ...rest,
          ...(customFields !== undefined ? { customFields } : {}),
          deliveryDate: rest.deliveryDate
            ? new Date(rest.deliveryDate)
            : rest.deliveryDate === null
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
        throw ApiError.notFound('Item not found');
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
    userId?: string,
  ) {
    return runAsTenant(
      organizationId,
      async (tx) => {
        const item = await tx.item.findFirst({
          where: { id, organizationId, isDeleted: false },
        });
        if (!item) {
          throw ApiError.notFound('Item not found');
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
            files.images.filter(Boolean).map((file) => processFile(file)),
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
      },
      { timeout: 60000 },
    );
  }
}

export const itemsService = new ItemsService();
