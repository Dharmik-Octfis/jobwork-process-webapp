import { runAsTenant, type TenantClient } from '../../db/prisma.ts';
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
import {
  createBatch,
  getBalance,
  postMovement,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import type { ItemOpeningStockDto } from './items.schemas.ts';

export function toItemResponse(item: Record<string, unknown> | null | undefined) {
  if (!item) return item;
  return {
    ...item,
    product_id: item.id,
    organization_id: item.organizationId,
    hsn_or_sac: item.hsnCode,
    item_type: item.itemType,
    can_be_sold: item.isSalesInfo,
    rate:
      item.sellingPrice !== null && item.sellingPrice !== undefined
        ? Number(item.sellingPrice)
        : null,
    sales_description: item.salesDescription,
    can_be_purchased: item.isPurchaseInfo,
    purchase_rate:
      item.costPrice !== null && item.costPrice !== undefined ? Number(item.costPrice) : null,
    purchase_description: item.purchaseDescription,
    inventory_tracking: item.inventoryTracking,
    track_inventory: item.trackInventory,
    openingStock:
      item.openingStock !== null && item.openingStock !== undefined
        ? Number(item.openingStock)
        : null,
    openingStockValuePerUnit:
      item.openingStockValuePerUnit !== null && item.openingStockValuePerUnit !== undefined
        ? Number(item.openingStockValuePerUnit)
        : null,
    custom_fields: item.customFields,
    front_image: item.frontImage,
    rear_image: item.rearImage,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    created_by: item.createdBy,
    updated_by: item.updatedBy,
    is_active: item.isActive,
    is_deleted: item.isDeleted,
  };
}

/**
 * 🔴 The stocking unit must belong to THIS organization.
 *
 * Postgres checks foreign keys OUTSIDE row-level security, so an insert naming
 * another tenant's uom id succeeds and the row that lands is invisible to both
 * tenants' queries afterwards (jobwork.refs.ts). The id arrives from a client
 * and is therefore a claim; this is what turns it into a fact.
 */
async function assertStockingUom(
  tx: TenantClient,
  organizationId: string,
  stockingUomId: string | null | undefined,
) {
  if (!stockingUomId) return;
  const uom = await tx.unitOfMeasurement.findFirst({
    where: { id: stockingUomId, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (!uom) throw ApiError.badRequest('Unknown unit of measurement.');
}

export function normalizeItemDto<T extends Record<string, unknown>>(rawData: T): T {
  if (!rawData) return rawData;
  const copy: Record<string, unknown> = { ...rawData };

  if (copy.product_type !== undefined && copy.type === undefined) copy.type = copy.product_type;
  if (copy.hsn_or_sac !== undefined && copy.hsnCode === undefined) copy.hsnCode = copy.hsn_or_sac;
  if (copy.rate !== undefined && copy.sellingPrice === undefined) copy.sellingPrice = copy.rate;
  if (copy.sales_description !== undefined && copy.salesDescription === undefined)
    copy.salesDescription = copy.sales_description;
  if (copy.purchase_rate !== undefined && copy.costPrice === undefined)
    copy.costPrice = copy.purchase_rate;
  if (copy.purchase_description !== undefined && copy.purchaseDescription === undefined)
    copy.purchaseDescription = copy.purchase_description;
  if (copy.can_be_sold !== undefined && copy.isSalesInfo === undefined)
    copy.isSalesInfo = copy.can_be_sold;
  if (copy.can_be_purchased !== undefined && copy.isPurchaseInfo === undefined)
    copy.isPurchaseInfo = copy.can_be_purchased;
  if (copy.track_inventory !== undefined && copy.trackInventory === undefined)
    copy.trackInventory = copy.track_inventory;
  if (copy.custom_fields !== undefined && copy.customFields === undefined)
    copy.customFields = copy.custom_fields;
  if (copy.front_image !== undefined && copy.frontImage === undefined)
    copy.frontImage = copy.front_image;
  if (copy.rear_image !== undefined && copy.rearImage === undefined)
    copy.rearImage = copy.rear_image;
  if (copy.inventory_tracking !== undefined && copy.inventoryTracking === undefined)
    copy.inventoryTracking = copy.inventory_tracking;
  if (copy.is_active !== undefined && copy.isActive === undefined) {
    copy.isActive = copy.is_active;
  }

  // Strip unrecognized snake_case keys so Prisma write doesn't reject unknown properties
  delete copy.product_id;
  delete copy.product_type;
  delete copy.hsn_or_sac;
  delete copy.rate;
  delete copy.sales_description;
  delete copy.purchase_rate;
  delete copy.purchase_description;
  delete copy.can_be_sold;
  delete copy.can_be_purchased;
  delete copy.track_inventory;
  delete copy.custom_fields;
  delete copy.front_image;
  delete copy.rear_image;
  delete copy.item_type;
  delete copy.is_active;

  return copy as T;
}

export class ItemsService {
  /**
   * 🔴 ONE reader, and the LEDGER is the balance.
   *
   * This replaced four overlapping ones on 2026-08-13. The old shape read a
   * `stock_on_hand` cache first and only fell back to the ledger when that table
   * was empty — so the stale copy won over the truth, and the number on the Item
   * page drifted from the ledger the moment any other module moved stock.
   *
   * `item_opening_stock_rows` supplies only what it is: the DECLARED figures.
   * Quantity comes from `getBalance`, batch detail from the `batches` rows this
   * document created.
   */
  private async readOpeningStock(tx: TenantClient, itemId: string, organizationId: string) {
    const declared = await tx.itemOpeningStockRow.findMany({
      where: { organizationId, itemId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });

    // The batches this document created, with the location each landed at. A
    // batch has no location of its own — location lives on the movement (§5.4) —
    // so the `opening` row is what ties the two together.
    const entries = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId,
        itemId,
        sourceDocType: 'item_opening_stock',
        movementType: 'opening',
      },
      include: { batch: true },
      orderBy: { postedAt: 'asc' },
    });

    const reversals = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId,
        itemId,
        sourceDocType: 'item_opening_stock',
        movementType: 'reversal',
      },
      select: { batchId: true },
    });

    const reversedBatchIds = new Set(reversals.map((r) => r.batchId));
    const activeEntries = entries.filter((entry) => !reversedBatchIds.has(entry.batchId));

    const locationIds = new Set<string>([
      ...declared.map((row) => row.locationId),
      ...activeEntries.map((entry) => entry.locationId),
    ]);

    if (locationIds.size === 0) {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { openingStock: true, openingStockValuePerUnit: true },
      });

      if (
        item &&
        item.openingStock !== null &&
        item.openingStock !== undefined &&
        Number(item.openingStock) > 0
      ) {
        const primaryLoc =
          (await tx.location.findFirst({
            where: { organizationId, isPrimary: true, isDeleted: false },
          })) ??
          (await tx.location.findFirst({
            where: { organizationId, isDeleted: false },
          }));

        if (primaryLoc) {
          const itemOpeningQty = Number(item.openingStock);
          const itemOpeningVal =
            item.openingStockValuePerUnit !== null &&
            item.openingStockValuePerUnit !== undefined
              ? Number(item.openingStockValuePerUnit)
              : null;

          return [
            {
              id: primaryLoc.id,
              locationId: primaryLoc.id,
              openingStock: itemOpeningQty,
              openingStockValue: itemOpeningVal,
              stockOnHand: itemOpeningQty,
              committedStock: 0,
              availableForSale: itemOpeningQty,
              batches: [],
            },
          ];
        }
      }
    }

    const out = [];
    for (const locationId of locationIds) {
      const row = declared.find((d) => d.locationId === locationId);
      const balance = await getBalance(tx, { organizationId, itemId, locationId });
      const mine = activeEntries.filter((entry) => entry.locationId === locationId);

      out.push({
        id: row?.id ?? locationId,
        locationId,
        openingStock:
          row?.openingStock !== undefined && row.openingStock !== null
            ? Number(row.openingStock)
            : null,
        openingStockValue:
          row?.openingStockValuePerUnit !== undefined && row.openingStockValuePerUnit !== null
            ? Number(row.openingStockValuePerUnit)
            : null,
        /** Live, off the ledger — never a stored copy. */
        stockOnHand: Number(balance.qty),
        committedStock: 0,
        availableForSale: Number(balance.qty),
        batches: mine.map((entry) => ({
          id: entry.batch.id,
          batchNumber: entry.batch.batchNumber,
          batchReference: entry.batch.supplierBatchRef,
          manufacturerBatch: entry.batch.manufacturerBatch,
          manufacturedDate: entry.batch.manufacturedDate,
          expiryDate: entry.batch.expiryDate,
          sellingPrice: entry.batch.sellingPrice !== null ? Number(entry.batch.sellingPrice) : null,
          mrp: entry.batch.mrp !== null ? Number(entry.batch.mrp) : null,
          quantityIn: Number(entry.qtyIn),
        })),
      });
    }
    return out;
  }

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
      ...searchWhere<Prisma.ItemWhereInput>(opts.search, ['name', 'sku', 'category', 'hsnCode']),
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
      const { customFields: rawCustomFields, frontImage, rearImage, images, ...rest } = data;

      await assertStockingUom(tx, organizationId, rest.stockingUomId);

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
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      if (
        item.trackInventory &&
        item.stockingUomId &&
        rest.openingStock !== undefined &&
        rest.openingStock !== null &&
        Number(rest.openingStock) > 0
      ) {
        const primaryLoc =
          (await tx.location.findFirst({
            where: { organizationId, isPrimary: true, isDeleted: false },
          })) ??
          (await tx.location.findFirst({
            where: { organizationId, isDeleted: false },
          }));

        if (primaryLoc) {
          const declaredQty = new Prisma.Decimal(rest.openingStock);
          const valuePerUnit =
            rest.openingStockValuePerUnit !== undefined && rest.openingStockValuePerUnit !== null
              ? new Prisma.Decimal(rest.openingStockValuePerUnit)
              : null;

          await tx.itemOpeningStockRow.upsert({
            where: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              organizationId_itemId_locationId: {
                organizationId,
                itemId: item.id,
                locationId: primaryLoc.id,
              },
            },
            create: {
              organizationId,
              itemId: item.id,
              locationId: primaryLoc.id,
              openingStock: declaredQty,
              openingStockValuePerUnit: valuePerUnit,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            },
            update: {
              openingStock: declaredQty,
              openingStockValuePerUnit: valuePerUnit,
              isDeleted: false,
              updatedBy: userId ?? null,
            },
          });

          const batch = await createBatch(tx, {
            organizationId,
            itemId: item.id,
            uomId: item.stockingUomId,
            sourceDocType: 'item_opening_stock',
            sourceDocId: item.id,
            userId,
          });

          await postMovement(tx, {
            organizationId,
            batchId: batch.id,
            locationId: primaryLoc.id,
            movementType: 'opening',
            qtyIn: declaredQty,
            valueIn: valuePerUnit ? declaredQty.times(valuePerUnit) : 0,
            sourceDocType: 'item_opening_stock',
            sourceDocId: item.id,
            userId,
          });
        }
      }

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

      const { customFields: rawCustomFields, frontImage, rearImage, images, ...rest } = data;

      await assertStockingUom(tx, organizationId, rest.stockingUomId);

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

      if (item.itemType === 'Composite Item' && rest.itemType) {
        // Because of the zod schema, rest.itemType can never be 'Composite Item'
        // So this means the user is trying to change the itemType away from Composite Item
        const recipeCount = await tx.compositeItemComponent.count({
          where: { compositeItemId: id, organizationId, isDeleted: false },
        });
        const assemblyCount = await tx.itemAssembly.count({
          where: { compositeItemId: id, organizationId, isDeleted: false },
        });
        if (recipeCount > 0 || assemblyCount > 0) {
          throw ApiError.conflict(
            'Cannot change item type away from Composite Item because it has a recipe or assemblies.',
          );
        }
      }

      const updatedItem = await tx.item.update({
        where: { id },
        data: {
          ...rest,
          ...(customFields !== undefined ? { customFields } : {}),
          ...(frontImage !== undefined
            ? {
                frontImage:
                  frontImage === null ? Prisma.DbNull : (frontImage as Prisma.InputJsonValue),
              }
            : {}),
          ...(rearImage !== undefined
            ? {
                rearImage:
                  rearImage === null ? Prisma.DbNull : (rearImage as Prisma.InputJsonValue),
              }
            : {}),
          ...(images !== undefined ? { images: images as unknown as Prisma.InputJsonValue } : {}),
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

      const usageCount = await tx.compositeItemComponent.count({
        where: { componentItemId: id, organizationId, isDeleted: false },
      });
      if (usageCount > 0) {
        throw ApiError.conflict(
          'Cannot delete item because it is used as a component in a composite item recipe.',
        );
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
          updateData.frontImage = (await processFile(
            files.frontImage[0],
          )) as unknown as Prisma.InputJsonValue;
        }

        if (files.rearImage && files.rearImage.length > 0 && files.rearImage[0]) {
          updateData.rearImage = (await processFile(
            files.rearImage[0],
          )) as unknown as Prisma.InputJsonValue;
        }

        if (files.images && files.images.length > 0) {
          const uploadedImageObjects = await Promise.all(
            files.images.filter(Boolean).map((file) => processFile(file)),
          );

          // Replace existing images array with new ones
          updateData.images = uploadedImageObjects as unknown as Prisma.InputJsonValue;
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

  async getOpeningStock(itemId: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!item) throw ApiError.notFound('Item not found.');

      return this.readOpeningStock(tx, itemId, organizationId);
    });
  }

  /**
   * Re-declare an item's opening stock.
   *
   * 🔴 EVERY DECLARED QUANTITY REACHES THE LEDGER. Until 2026-08-13 the batch and
   * ledger writes sat inside the `for (batch of batches)` loop, so a location
   * given a bulk quantity and no batch rows wrote the document and nothing else:
   * the Item page showed stock that no jobwork screen could see or issue. One
   * such row existed in dev. An item at `inventoryTracking = 'none'` is the
   * NORMAL case for that shape, so it was not an edge case.
   *
   * A batch is created either way — `none` just means the user never names it
   * (schema: `Item.inventoryTracking`).
   */
  async saveOpeningStock(
    itemId: string,
    organizationId: string,
    data: ItemOpeningStockDto,
    userId?: string,
  ) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true, stockingUomId: true, inventoryTracking: true, trackInventory: true },
      });
      if (!item) throw ApiError.notFound('Item not found.');
      if (!item.trackInventory)
        throw ApiError.badRequest('Turn on inventory tracking for this item before adding stock.');
      if (!item.stockingUomId)
        throw ApiError.badRequest('Cannot add stock without a stocking unit of measurement.');

      // A correction is a REVERSING ENTRY, never an edit (inventory.prisma).
      // Only active unreversed opening entries need to be backed out.
      const oldOpenings = await tx.stockLedgerEntry.findMany({
        where: {
          organizationId,
          itemId,
          sourceDocType: 'item_opening_stock',
          movementType: 'opening',
        },
      });
      const oldReversals = await tx.stockLedgerEntry.findMany({
        where: {
          organizationId,
          itemId,
          sourceDocType: 'item_opening_stock',
          movementType: 'reversal',
        },
      });

      // Track net active unreversed opening stock per (batchId, locationId)
      const netMap = new Map<
        string,
        { batchId: string; locationId: string; netQty: Prisma.Decimal; netVal: Prisma.Decimal }
      >();

      for (const old of oldOpenings) {
        const key = `${old.batchId}_${old.locationId}`;
        const existing = netMap.get(key) ?? {
          batchId: old.batchId,
          locationId: old.locationId,
          netQty: new Prisma.Decimal(0),
          netVal: new Prisma.Decimal(0),
        };
        existing.netQty = existing.netQty.plus(old.qtyIn ?? 0);
        existing.netVal = existing.netVal.plus(old.valueIn ?? 0);
        netMap.set(key, existing);
      }

      for (const rev of oldReversals) {
        const key = `${rev.batchId}_${rev.locationId}`;
        const existing = netMap.get(key);
        if (existing) {
          existing.netQty = existing.netQty.minus(rev.qtyOut ?? 0);
          existing.netVal = existing.netVal.minus(rev.valueOut ?? 0);
        }
      }

      for (const { batchId, locationId, netQty, netVal } of netMap.values()) {
        if (netQty.greaterThan(0)) {
          await postMovement(tx, {
            organizationId,
            batchId,
            locationId,
            movementType: 'reversal',
            qtyOut: netQty,
            qtyIn: new Prisma.Decimal(0),
            valueOut: netVal,
            valueIn: new Prisma.Decimal(0),
            sourceDocType: 'item_opening_stock',
            sourceDocId: itemId,
            userId,
          });
        }
      }

      // Soft delete, not a wipe: the row carries who declared what and when.
      await tx.itemOpeningStockRow.updateMany({
        where: { organizationId, itemId, isDeleted: false },
        data: { isDeleted: true, updatedBy: userId ?? null },
      });

      const requiresBatchDetail = item.inventoryTracking === 'batch';

      for (const locRow of data.locationRows) {
        const rows = (locRow.batches ?? []).filter((b) => Number(b.quantityIn) > 0);
        const batchTotal = rows.reduce((sum, b) => sum + Number(b.quantityIn), 0);

        const declaredQty =
          locRow.openingStock !== null &&
          locRow.openingStock !== undefined &&
          locRow.openingStock !== ''
            ? new Prisma.Decimal(locRow.openingStock)
            : new Prisma.Decimal(batchTotal);

        if (requiresBatchDetail && rows.length > 0 && new Prisma.Decimal(batchTotal).greaterThan(declaredQty)) {
          throw ApiError.badRequest(
            `Total batch quantity (${batchTotal}) cannot exceed location opening stock (${declaredQty.toString()}).`,
          );
        }

        if (requiresBatchDetail && rows.length === 0 && declaredQty.greaterThan(0)) {
          throw ApiError.badRequest(
            'This item is batch-tracked, so opening stock needs at least one batch row with a quantity.',
            { batches: 'Add a batch row, or set the item to no batch tracking.' },
          );
        }

        const valuePerUnit =
          locRow.openingStockValue !== null &&
          locRow.openingStockValue !== undefined &&
          locRow.openingStockValue !== ''
            ? new Prisma.Decimal(locRow.openingStockValue)
            : null;

        // The DECLARATION. Upsert rather than insert: the unique key is still held
        // by the row just soft-deleted, and reviving it keeps its history.
        await tx.itemOpeningStockRow.upsert({
          where: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            organizationId_itemId_locationId: {
              organizationId,
              itemId,
              locationId: locRow.locationId,
            },
          },
          create: {
            organizationId,
            itemId,
            locationId: locRow.locationId,
            openingStock: declaredQty,
            openingStockValuePerUnit: valuePerUnit,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
          update: {
            openingStock: declaredQty,
            openingStockValuePerUnit: valuePerUnit,
            isDeleted: false,
            updatedBy: userId ?? null,
          },
        });

        if (declaredQty.lessThanOrEqualTo(0) && rows.length === 0) continue;

        // 🔴 Post user-entered batch rows ONLY
        const toPost =
          rows.length > 0
            ? rows
            : [{ quantityIn: declaredQty.toString() } as (typeof rows)[number]];

        for (const detail of toPost) {
          const qty = new Prisma.Decimal(detail.quantityIn ?? 0);
          if (qty.lessThanOrEqualTo(0)) continue;

          const batch = await createBatch(tx, {
            organizationId,
            itemId,
            uomId: item.stockingUomId,
            supplierBatchRef: detail.batchReference || null,
            manufacturerBatch: detail.manufacturerBatch || null,
            manufacturedDate: detail.manufacturedDate || null,
            expiryDate: detail.expiryDate || null,
            mrp: detail.mrp ?? null,
            sellingPrice: detail.sellingPrice ?? null,
            sourceDocType: 'item_opening_stock',
            sourceDocId: itemId,
            userId,
          });

          await postMovement(tx, {
            organizationId,
            batchId: batch.id,
            locationId: locRow.locationId,
            movementType: 'opening',
            qtyIn: qty,
            valueIn: valuePerUnit ? qty.times(valuePerUnit) : 0,
            sourceDocType: 'item_opening_stock',
            sourceDocId: itemId,
            userId,
          });
        }
      }

      return this.readOpeningStock(tx, itemId, organizationId);
    });
  }
}

export const itemsService = new ItemsService();
