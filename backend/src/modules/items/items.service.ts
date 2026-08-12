import { runAsTenant, type TenantClient } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import type { CreateItemDto, UpdateItemDto } from './items.schemas.ts';
import { uploadFile } from '../../lib/storage.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../settings/customization/custom-fields/customFields.engine.ts';
import { Prisma } from '../../../generated/prisma/client.ts';
import { randomUUID } from 'node:crypto';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../lib/pagination.ts';
import { filterWhere } from '../settings/list-views/listFilters.catalog.ts';
import { createLot, postMovement } from '../inventory/stock-ledger/stockLedger.service.ts';
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
  private normalizeOpeningStockRow(row: {
    id: string;
    locationId: string;
    openingStock: Prisma.Decimal | null;
    openingStockValuePerUnit: Prisma.Decimal | null;
    stockOnHand?: Prisma.Decimal | null;
    committedStock?: Prisma.Decimal | null;
    availableForSale?: Prisma.Decimal | null;
    batches: Prisma.JsonValue;
  }) {
    const batches = Array.isArray(row.batches)
      ? row.batches.map((batch, index) => {
          const value = batch as Record<string, unknown>;
          return {
            id: typeof value.id === 'string' ? value.id : `${row.id}:${index}`,
            batchReference: value.batchReference ?? null,
            manufacturerBatch: value.manufacturerBatch ?? null,
            manufacturedDate: value.manufacturedDate ?? null,
            expiryDate: value.expiryDate ?? null,
            sellingPrice: value.sellingPrice ?? null,
            mrp: value.mrp ?? null,
            quantityIn: value.quantityIn ?? null,
          };
        })
      : [];

    return {
      id: row.id,
      locationId: row.locationId,
      openingStock: row.openingStock !== null ? Number(row.openingStock) : null,
      openingStockValue:
        row.openingStockValuePerUnit !== null ? Number(row.openingStockValuePerUnit) : null,
      stockOnHand:
        row.stockOnHand !== null && row.stockOnHand !== undefined ? Number(row.stockOnHand) : null,
      committedStock:
        row.committedStock !== null && row.committedStock !== undefined
          ? Number(row.committedStock)
          : null,
      availableForSale:
        row.availableForSale !== null && row.availableForSale !== undefined
          ? Number(row.availableForSale)
          : null,
      batches,
    };
  }

  private async readLocationStockRowsFromTable(
    tx: TenantClient,
    itemId: string,
    organizationId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        locationId: string;
        stockOnHand: Prisma.Decimal | null;
        committedStock: Prisma.Decimal | null;
        availableForSale: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT
        id,
        location_id AS "locationId",
        stock_on_hand AS "stockOnHand",
        committed_stock AS "committedStock",
        available_for_sale AS "availableForSale"
      FROM item_location_stocks
      WHERE organization_id = ${organizationId}::uuid
        AND item_id = ${itemId}::uuid
        AND is_deleted = false
      ORDER BY created_at ASC
    `);

    return rows;
  }

  private async readOpeningStockRowsFromTable(
    tx: TenantClient,
    itemId: string,
    organizationId: string,
  ) {
    const summaryRows = await this.readLocationStockRowsFromTable(tx, itemId, organizationId);
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        locationId: string;
        openingStock: Prisma.Decimal | null;
        openingStockValuePerUnit: Prisma.Decimal | null;
        batches: Prisma.JsonValue;
      }>
    >(Prisma.sql`
      SELECT
        id,
        location_id AS "locationId",
        opening_stock AS "openingStock",
        opening_stock_value_per_unit AS "openingStockValuePerUnit",
        batches
      FROM item_opening_stock_rows
      WHERE organization_id = ${organizationId}::uuid
        AND item_id = ${itemId}::uuid
        AND is_deleted = false
      ORDER BY created_at ASC
      `);
    type NormalizedOpeningStockRow = ReturnType<ItemsService['normalizeOpeningStockRow']>;
    const byLocation = new Map<string, NormalizedOpeningStockRow>();
    for (const summary of summaryRows) {
      byLocation.set(summary.locationId, {
        id: summary.id,
        locationId: summary.locationId,
        openingStock: null,
        openingStockValue: null,
        stockOnHand: summary.stockOnHand !== null ? Number(summary.stockOnHand) : null,
        committedStock: summary.committedStock !== null ? Number(summary.committedStock) : null,
        availableForSale:
          summary.availableForSale !== null ? Number(summary.availableForSale) : null,
        batches: [],
      });
    }

    for (const row of rows) {
      const normalized = this.normalizeOpeningStockRow(row);
      const existing = byLocation.get(normalized.locationId);
      if (existing) {
        existing.id = normalized.id;
        existing.openingStock = normalized.openingStock;
        existing.openingStockValue = normalized.openingStockValue;
        existing.batches = normalized.batches;
        if (existing.stockOnHand === null) {
          existing.stockOnHand = normalized.openingStock ?? 0;
        }
        if (existing.availableForSale === null) {
          existing.availableForSale = existing.stockOnHand;
        }
        if (existing.committedStock === null) {
          existing.committedStock = 0;
        }
      } else {
        byLocation.set(normalized.locationId, {
          ...normalized,
          stockOnHand: normalized.openingStock ?? 0,
          committedStock: 0,
          availableForSale: normalized.openingStock ?? 0,
        });
      }
    }

    return Array.from(byLocation.values());
  }

  private async readOpeningStockRowsFromLedger(
    tx: TenantClient,
    itemId: string,
    organizationId: string,
  ) {
    const entries = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId,
        itemId,
        sourceDocType: 'item_opening_stock',
        movementType: 'opening',
      },
      include: { lot: true },
    });

    const locationMap = new Map<
      string,
      {
        id: string;
        locationId: string;
        openingStock: null;
        openingStockValue: null;
        batches: Array<Record<string, unknown>>;
      }
    >();
    for (const entry of entries) {
      if (!locationMap.has(entry.locationId)) {
        locationMap.set(entry.locationId, {
          id: entry.locationId,
          locationId: entry.locationId,
          openingStock: null,
          openingStockValue: null,
          batches: [],
        });
      }
      const row = locationMap.get(entry.locationId)!;
      const cf = entry.lot.customFields as Record<string, unknown> | undefined;
      row.batches.push({
        id: entry.lot.id,
        batchReference: entry.lot.supplierLotRef,
        manufacturerBatch: cf?.manufacturerBatch,
        manufacturedDate: cf?.manufacturedDate,
        expiryDate: cf?.expiryDate,
        quantityIn: entry.qtyIn,
        sellingPrice: cf?.sellingPrice,
        mrp: cf?.mrp,
      });
    }

    return Array.from(locationMap.values());
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
        where: { id: itemId, organizationId },
        select: { id: true, lotTracking: true },
      });
      if (!item) throw ApiError.notFound('Item not found.');

      const rows = await this.readOpeningStockRowsFromTable(tx, itemId, organizationId);
      if (rows.length > 0) return rows;

      return this.readOpeningStockRowsFromLedger(tx, itemId, organizationId);
    });
  }

  async saveOpeningStock(
    itemId: string,
    organizationId: string,
    data: ItemOpeningStockDto,
    userId?: string,
  ) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId },
        select: { id: true, stockingUomId: true, lotTracking: true },
      });
      if (!item) throw ApiError.notFound('Item not found.');
      if (!item.stockingUomId)
        throw ApiError.badRequest('Cannot add stock without a stocking unit of measurement.');

      const oldEntries = await tx.stockLedgerEntry.findMany({
        where: { organizationId, itemId, sourceDocType: 'item_opening_stock' },
      });
      for (const oldEntry of oldEntries) {
        await postMovement(tx, {
          organizationId,
          lotId: oldEntry.lotId,
          locationId: oldEntry.locationId,
          movementType: 'reversal',
          qtyOut: oldEntry.qtyIn,
          qtyIn: oldEntry.qtyOut,
          valueOut: oldEntry.valueIn,
          valueIn: oldEntry.valueOut,
          sourceDocType: 'item_opening_stock',
          sourceDocId: itemId,
          userId,
        });
      }

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM item_opening_stock_rows
        WHERE organization_id = ${organizationId}::uuid
          AND item_id = ${itemId}::uuid
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM item_location_stocks
        WHERE organization_id = ${organizationId}::uuid
          AND item_id = ${itemId}::uuid
      `);

      for (const locRow of data.locationRows) {
        const batches = Array.isArray(locRow.batches)
          ? locRow.batches.map((batch, index) => ({
              id:
                typeof batch.id === 'string' && batch.id.length > 0
                  ? batch.id
                  : `${locRow.locationId}:${index}:${randomUUID()}`,
              batchReference: batch.batchReference ?? null,
              manufacturerBatch: batch.manufacturerBatch ?? null,
              manufacturedDate: batch.manufacturedDate ?? null,
              expiryDate: batch.expiryDate ?? null,
              sellingPrice: batch.sellingPrice ?? null,
              mrp: batch.mrp ?? null,
              quantityIn: batch.quantityIn ?? null,
            }))
          : [];

        const batchTotal = batches.reduce((sum, batch) => sum + (Number(batch.quantityIn) || 0), 0);
        const openingStock =
          locRow.openingStock !== null &&
          locRow.openingStock !== undefined &&
          locRow.openingStock !== ''
            ? new Prisma.Decimal(locRow.openingStock)
            : new Prisma.Decimal(batchTotal);
        const openingStockValuePerUnit =
          locRow.openingStockValue !== null &&
          locRow.openingStockValue !== undefined &&
          locRow.openingStockValue !== ''
            ? new Prisma.Decimal(locRow.openingStockValue)
            : null;

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO item_location_stocks (
            id,
            organization_id,
            item_id,
            location_id,
            stock_on_hand,
            committed_stock,
            available_for_sale,
            custom_fields,
            is_deleted,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            ${itemId}::uuid,
            ${locRow.locationId}::uuid,
            ${openingStock},
            0,
            ${openingStock},
            '{}'::jsonb,
            false,
            ${userId ?? null}::uuid,
            ${userId ?? null}::uuid,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO item_opening_stock_rows (
            id,
            organization_id,
            item_id,
            location_id,
            opening_stock,
            opening_stock_value_per_unit,
            batches,
            custom_fields,
            is_deleted,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            ${itemId}::uuid,
            ${locRow.locationId}::uuid,
            ${openingStock},
            ${openingStockValuePerUnit},
            ${JSON.stringify(batches)}::jsonb,
            '{}'::jsonb,
            false,
            ${userId ?? null}::uuid,
            ${userId ?? null}::uuid,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);

        for (const batch of batches) {
          const qty = Number(batch.quantityIn);
          if (!qty || qty <= 0) continue;

          const lot = await createLot(tx, {
            organizationId,
            itemId,
            uomId: item.stockingUomId,
            lotNumber: undefined,
            supplierLotRef: batch.batchReference || null,
            sourceDocType: 'item_opening_stock',
            sourceDocId: itemId,
            userId,
            customFields: {
              manufacturerBatch: batch.manufacturerBatch,
              manufacturedDate: batch.manufacturedDate,
              expiryDate: batch.expiryDate,
              sellingPrice: batch.sellingPrice,
              mrp: batch.mrp,
            },
          });

          await postMovement(tx, {
            organizationId,
            lotId: lot.id,
            locationId: locRow.locationId,
            movementType: 'opening',
            qtyIn: qty,
            sourceDocType: 'item_opening_stock',
            sourceDocId: itemId,
            userId,
          });
        }
      }

      return this.readOpeningStockRowsFromTable(tx, itemId, organizationId);
    });
  }
}

export const itemsService = new ItemsService();
