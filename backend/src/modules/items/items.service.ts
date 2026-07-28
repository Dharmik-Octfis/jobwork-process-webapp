import { runAsTenant } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';
import { uploadFile } from '../../lib/storage.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../settings/customization/custom-fields/customFields.engine.ts';
import { Prisma } from '../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../lib/pagination.ts';
import { filterWhere } from '../settings/list-views/listFilters.catalog.ts';

export function toItemResponse(item: Record<string, unknown> | null | undefined) {
  if (!item) return item;
  return {
    ...item,
    product_id: item.id,
    organization_id: item.organizationId,
    alias_name: item.aliasName,
    product_type: item.type,
    hsn_or_sac: item.hsnCode,
    is_taxable: item.taxPreference === 'Taxable',
    taxability_type: item.taxPreference,
    item_type: item.itemType,
    can_be_sold: item.isSalesInfo,
    rate: item.sellingPrice !== null && item.sellingPrice !== undefined ? Number(item.sellingPrice) : null,
    account_id: item.salesAccount,
    can_be_purchased: item.isPurchaseInfo,
    purchase_rate: item.costPrice !== null && item.costPrice !== undefined ? Number(item.costPrice) : null,
    purchase_account_id: item.purchaseAccount,
    inventory_account_id: item.inventoryAccount,
    inventory_tracking: item.inventoryTracking,
    inventory_valuation_method: item.inventoryValuationMethod,
    is_storage_location_enabled: item.binLocationTracking === 'Yes' || Boolean(item.binLocationTracking),
    track_inventory: item.trackInventory,
    custom_fields: item.customFields,
    front_image: item.frontImage,
    rear_image: item.rearImage,
    delivery_date: item.deliveryDate,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    created_by: item.createdBy,
    updated_by: item.updatedBy,
    is_deleted: item.isDeleted,
  };
}

export function normalizeItemDto<T extends Record<string, unknown>>(rawData: T): T {
  if (!rawData) return rawData;
  const copy: Record<string, unknown> = { ...rawData };

  if (copy.product_type !== undefined && copy.type === undefined) copy.type = copy.product_type;
  if (copy.alias_name !== undefined && copy.aliasName === undefined) copy.aliasName = copy.alias_name;
  if (copy.hsn_or_sac !== undefined && copy.hsnCode === undefined) copy.hsnCode = copy.hsn_or_sac;
  if (copy.rate !== undefined && copy.sellingPrice === undefined) copy.sellingPrice = copy.rate;
  if (copy.account_id !== undefined && copy.salesAccount === undefined) copy.salesAccount = copy.account_id;
  if (copy.purchase_rate !== undefined && copy.costPrice === undefined) copy.costPrice = copy.purchase_rate;
  if (copy.purchase_account_id !== undefined && copy.purchaseAccount === undefined) copy.purchaseAccount = copy.purchase_account_id;
  if (copy.inventory_account_id !== undefined && copy.inventoryAccount === undefined) copy.inventoryAccount = copy.inventory_account_id;
  if (copy.can_be_sold !== undefined && copy.isSalesInfo === undefined) copy.isSalesInfo = copy.can_be_sold;
  if (copy.can_be_purchased !== undefined && copy.isPurchaseInfo === undefined) copy.isPurchaseInfo = copy.can_be_purchased;
  if (copy.track_inventory !== undefined && copy.trackInventory === undefined) copy.trackInventory = copy.track_inventory;
  if (copy.custom_fields !== undefined && copy.customFields === undefined) copy.customFields = copy.custom_fields;
  if (copy.front_image !== undefined && copy.frontImage === undefined) copy.frontImage = copy.front_image;
  if (copy.rear_image !== undefined && copy.rearImage === undefined) copy.rearImage = copy.rear_image;
  if (copy.delivery_date !== undefined && copy.deliveryDate === undefined) copy.deliveryDate = copy.delivery_date;
  if (copy.is_storage_location_enabled !== undefined && copy.binLocationTracking === undefined) {
    copy.binLocationTracking = typeof copy.is_storage_location_enabled === 'boolean'
      ? (copy.is_storage_location_enabled ? 'Yes' : 'No')
      : copy.is_storage_location_enabled;
  }
  if (copy.inventory_tracking !== undefined && copy.inventoryTracking === undefined) copy.inventoryTracking = copy.inventory_tracking;
  if (copy.inventory_valuation_method !== undefined && copy.inventoryValuationMethod === undefined) copy.inventoryValuationMethod = copy.inventory_valuation_method;
  if (copy.is_taxable !== undefined && copy.taxPreference === undefined) {
    copy.taxPreference = copy.is_taxable ? 'Taxable' : 'Non-Taxable';
  }

  // Strip unrecognized snake_case keys so Prisma write doesn't reject unknown properties
  delete copy.product_id;
  delete copy.product_type;
  delete copy.alias_name;
  delete copy.hsn_or_sac;
  delete copy.rate;
  delete copy.account_id;
  delete copy.purchase_rate;
  delete copy.purchase_account_id;
  delete copy.inventory_account_id;
  delete copy.can_be_sold;
  delete copy.can_be_purchased;
  delete copy.track_inventory;
  delete copy.custom_fields;
  delete copy.front_image;
  delete copy.rear_image;
  delete copy.delivery_date;
  delete copy.is_storage_location_enabled;
  delete copy.inventory_tracking;
  delete copy.inventory_valuation_method;
  delete copy.is_taxable;
  delete copy.taxability_type;
  delete copy.item_type;

  return copy as T;
}

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

      const paginated = pageSlice(rows, page, perPage);
      return {
        ...paginated,
        results: paginated.results.map(toItemResponse),
      };
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
      return toItemResponse(item);
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

  async create(organizationId: string, rawData: CreateItemDto, userId?: string) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const {
        customFields: rawCustomFields,
        frontImage,
        rearImage,
        images,
        ...rest
      } = data;

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
          frontImage: frontImage === null ? Prisma.DbNull : (frontImage as Prisma.InputJsonValue),
          rearImage: rearImage === null ? Prisma.DbNull : (rearImage as Prisma.InputJsonValue),
          images: images ? (images as unknown as Prisma.InputJsonValue) : undefined,
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

      return toItemResponse(item);
    });
  }

  async update(id: string, organizationId: string, rawData: UpdateItemDto, userId?: string) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, isDeleted: false },
      });
      if (!item) {
        throw ApiError.notFound('Item not found');
      }

      const {
        customFields: rawCustomFields,
        frontImage,
        rearImage,
        images,
        ...rest
      } = data;

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
          ...(frontImage !== undefined
            ? { frontImage: frontImage === null ? Prisma.DbNull : (frontImage as Prisma.InputJsonValue) }
            : {}),
          ...(rearImage !== undefined
            ? { rearImage: rearImage === null ? Prisma.DbNull : (rearImage as Prisma.InputJsonValue) }
            : {}),
          ...(images !== undefined
            ? { images: images as unknown as Prisma.InputJsonValue }
            : {}),
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

      return toItemResponse(updatedItem);
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

      return toItemResponse(deletedItem);
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

          return {
            key,
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
          };
        };

        if (files.frontImage && files.frontImage.length > 0 && files.frontImage[0]) {
          updateData.frontImage = (await processFile(files.frontImage[0])) as unknown as Prisma.InputJsonValue;
        }

        if (files.rearImage && files.rearImage.length > 0 && files.rearImage[0]) {
          updateData.rearImage = (await processFile(files.rearImage[0])) as unknown as Prisma.InputJsonValue;
        }

        if (files.images && files.images.length > 0) {
          const uploadedImageObjects = await Promise.all(
            files.images.filter(Boolean).map((file) => processFile(file)),
          );

          // Append to existing images array if it exists
          const existingImages = Array.isArray(item.images) ? (item.images as unknown[]) : [];
          updateData.images = [...existingImages, ...uploadedImageObjects] as unknown as Prisma.InputJsonValue;
        }

        if (Object.keys(updateData).length === 0) {
          return toItemResponse(item); // Nothing to update
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

        return toItemResponse(updatedItem);
      },
      { timeout: 60000 },
    );
  }
}

export const itemsService = new ItemsService();
