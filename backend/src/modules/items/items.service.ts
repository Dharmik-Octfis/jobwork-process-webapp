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
  getBalanceByLocation,
  postMovement,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import type { ItemOpeningStockDto } from './items.schemas.ts';

export function toItemResponse(item: Record<string, unknown> | null | undefined) {
  if (!item) return item;
  return {
    ...item,
    openingStock:
      item.openingStock !== null && item.openingStock !== undefined
        ? Number(item.openingStock)
        : null,
    openingStockValuePerUnit:
      item.openingStockValuePerUnit !== null && item.openingStockValuePerUnit !== undefined
        ? Number(item.openingStockValuePerUnit)
        : null,
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

  // Convert snake_case properties to their camelCase equivalents if provided.
  // This is a safety net during transition. The frontend now sends camelCase.
  if ('product_type' in copy && copy.type === undefined) copy.type = copy.product_type;
  if ('hsn_or_sac' in copy && copy.hsnCode === undefined) copy.hsnCode = copy.hsn_or_sac;
  if ('rate' in copy && copy.sellingPrice === undefined) copy.sellingPrice = copy.rate;
  if ('sales_description' in copy && copy.salesDescription === undefined)
    copy.salesDescription = copy.sales_description;
  if ('purchase_rate' in copy && copy.costPrice === undefined) copy.costPrice = copy.purchase_rate;
  if ('purchase_description' in copy && copy.purchaseDescription === undefined)
    copy.purchaseDescription = copy.purchase_description;
  if ('can_be_sold' in copy && copy.isSalesInfo === undefined) copy.isSalesInfo = copy.can_be_sold;
  if ('can_be_purchased' in copy && copy.isPurchaseInfo === undefined)
    copy.isPurchaseInfo = copy.can_be_purchased;
  if ('track_inventory' in copy && copy.trackInventory === undefined)
    copy.trackInventory = copy.track_inventory;
  if ('front_image' in copy && copy.frontImage === undefined) copy.frontImage = copy.front_image;
  if ('rear_image' in copy && copy.rearImage === undefined) copy.rearImage = copy.rear_image;
  if ('inventory_tracking' in copy && copy.inventoryTracking === undefined)
    copy.inventoryTracking = copy.inventory_tracking;
  if ('is_active' in copy && copy.isActive === undefined) copy.isActive = copy.is_active;

  // Clean up any remaining snake_case keys so Prisma write doesn't reject unknown properties
  const snakeCaseKeys = [
    'product_id',
    'product_type',
    'hsn_or_sac',
    'rate',
    'sales_description',
    'purchase_rate',
    'purchase_description',
    'can_be_sold',
    'can_be_purchased',
    'track_inventory',
    'front_image',
    'rear_image',
    'item_type',
    'is_active',
    'inventory_tracking',
  ];
  for (const key of snakeCaseKeys) {
    delete copy[key];
  }

  return copy as T;
}

/** What this document currently declares for one batch at one location. */
interface OpeningPosition {
  batchId: string;
  locationId: string;
  batch: Awaited<ReturnType<TenantClient['batch']['findFirstOrThrow']>>;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  postedAt: Date;
}

export class ItemsService {
  /**
   * 🔴 WHAT OPENING STOCK CURRENTLY SAYS, netted per batch and location.
   *
   * Every row this document has ever written, summed — `opening` in, `reversal`
   * out. Netting is the whole point: until 2026-08-13 both the reader and the
   * writer treated "this batch has a reversal" as "this batch is gone", which is
   * only true when the reversal was for the full quantity. A batch whose opening
   * had been trimmed from 100 to 80 vanished from the Item page entirely while
   * still holding 80 in the ledger.
   */
  private async openingPositions(
    tx: TenantClient,
    itemId: string,
    organizationId: string,
  ): Promise<Map<string, OpeningPosition>> {
    const rows = await tx.stockLedgerEntry.findMany({
      where: { organizationId, itemId, sourceDocType: 'item_opening_stock' },
      include: { batch: true },
      orderBy: { postedAt: 'asc' },
    });

    const positions = new Map<string, OpeningPosition>();
    for (const row of rows) {
      const key = `${row.batchId}_${row.locationId}`;
      const current = positions.get(key) ?? {
        batchId: row.batchId,
        locationId: row.locationId,
        batch: row.batch,
        qty: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        postedAt: row.postedAt,
      };
      current.qty = current.qty.plus(row.qtyIn ?? 0).minus(row.qtyOut ?? 0);
      current.value = current.value.plus(row.valueIn ?? 0).minus(row.valueOut ?? 0);
      positions.set(key, current);
    }
    return positions;
  }

  /**
   * 🔴 MOVE ONE POSITION TO A NEW QUANTITY — the fix for the defect that made a
   * re-save destructive.
   *
   * The old writer reversed every opening in full and re-created the lot from the
   * payload. That is only sound while nothing has left: batch A opens at 100, 40
   * go out to a dyer, someone re-saves, and the 100 is reversed at the godown —
   * A lands at MINUS 40 while a brand-new A′ takes the +100. The location total
   * still looked right, which is why it went unnoticed; the batch history did not,
   * and the 40 sitting at the dyer pointed at a batch with a negative source
   * balance. `getAvailableBatches` filters on a positive balance, so A simply
   * disappeared from every picker rather than raising anything.
   *
   * So a change is now a DELTA against what this document already said, and a
   * reduction can never take out more than is still there. Goods that have left
   * cannot be un-issued by reversing their receipt, so that case is refused by
   * name instead of being written.
   */
  private async settleOpening(
    tx: TenantClient,
    position: OpeningPosition,
    desiredQty: Prisma.Decimal,
    context: {
      organizationId: string;
      itemId: string;
      valuePerUnit: Prisma.Decimal | null;
      userId?: string;
    },
  ) {
    const delta = desiredQty.minus(position.qty);
    if (delta.isZero()) return;

    const { organizationId, itemId, valuePerUnit, userId } = context;
    // The value already riding on this position, per unit — used when the form
    // states no value of its own, so a top-up is worth what the rest of it is.
    const existingUnitValue = position.qty.greaterThan(0)
      ? position.value.dividedBy(position.qty)
      : new Prisma.Decimal(0);

    if (delta.greaterThan(0)) {
      const unit = valuePerUnit ?? existingUnitValue;
      await postMovement(tx, {
        organizationId,
        batchId: position.batchId,
        locationId: position.locationId,
        movementType: 'opening',
        qtyIn: delta,
        valueIn: delta.times(unit),
        sourceDocType: 'item_opening_stock',
        sourceDocId: itemId,
        userId,
      });
      return;
    }

    const remove = delta.negated();
    const balance = await getBalance(tx, {
      organizationId,
      batchId: position.batchId,
      locationId: position.locationId,
    });
    if (remove.greaterThan(balance.qty)) {
      const floor = position.qty.minus(balance.qty);
      // The reference, not the internal number — the user has to find this row on
      // their own screen, where the number does not appear.
      const label = position.batch.supplierBatchRef ?? 'This batch';
      throw ApiError.badRequest(
        `Batch ${label} has already moved — only ${balance.qty.toString()} of it is ` +
          `still here, so its opening stock cannot go below ${floor.toString()}. ` +
          'Cancel the documents that moved it first, or leave this batch as it is.',
        { batches: `${label} cannot go below ${floor.toString()}.` },
      );
    }

    await postMovement(tx, {
      organizationId,
      batchId: position.batchId,
      locationId: position.locationId,
      movementType: 'reversal',
      qtyOut: remove,
      // Proportional, not the whole value — a partial reduction that wrote off the
      // full value would leave the remainder costing nothing.
      valueOut: remove.times(existingUnitValue),
      sourceDocType: 'item_opening_stock',
      sourceDocId: itemId,
      userId,
    });
  }

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

    // The batches this document declares, with the location each landed at. A
    // batch has no location of its own — location lives on the movement (§5.4) —
    // so the `opening` row is what ties the two together. Netted, so a batch that
    // was trimmed rather than removed still shows, at what is left of it.
    const positions = [...(await this.openingPositions(tx, itemId, organizationId)).values()];
    const activeEntries = positions.filter((position) => position.qty.greaterThan(0));

    // 🔴 EVERY location the LEDGER puts this item at, not just the ones opening
    // stock named (2026-08-17). Building the list from this document alone made the
    // page blind to its own domain: material taken in against a job order, stock
    // sitting at a processor after an issue, and a receipt's output all rendered as
    // a zero at a location that really held them. 9 of 17 real balances in dev were
    // invisible this way. The quantity was never wrong — the list of places was.
    const balances = await getBalanceByLocation(tx, { organizationId, itemId });

    const locationIds = new Set<string>([
      ...declared.map((row) => row.locationId),
      ...activeEntries.map((entry) => entry.locationId),
      ...[...balances]
        .filter(([, balance]) => !balance.qty.isZero())
        .map(([locationId]) => locationId),
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
            item.openingStockValuePerUnit !== null && item.openingStockValuePerUnit !== undefined
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
      // Off the map above — one grouped query, not an aggregate per location.
      const balance = balances.get(locationId) ?? { qty: new Prisma.Decimal(0) };
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
          // 🔴 The batch's real id, and the client sends it back on save — that is
          // what lets the writer tell "this batch, edited" from "a new batch", and
          // therefore what lets it adjust instead of reverse-and-recreate.
          id: entry.batch.id,
          // 🔴 No `batchNumber` (2026-08-14) — internal, and a field in the
          // payload is a field somebody renders. `id` is the round-trip handle.
          batchReference: entry.batch.supplierBatchRef,
          manufacturerBatch: entry.batch.manufacturerBatch,
          manufacturedDate: entry.batch.manufacturedDate,
          expiryDate: entry.batch.expiryDate,
          sellingPrice: entry.batch.sellingPrice !== null ? Number(entry.batch.sellingPrice) : null,
          mrp: entry.batch.mrp !== null ? Number(entry.batch.mrp) : null,
          quantityIn: Number(entry.qty),
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

  async getItemBills(itemId: string, organizationId: string, opts: ListQuery) {
    const { page, perPage } = opts;
    return runAsTenant(organizationId, async (tx) => {
      // First verify the item exists
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!item) {
        throw ApiError.notFound('Item not found');
      }

      const rows = await tx.billItem.findMany({
        where: {
          itemId: itemId,
          isDeleted: false,
          bill: {
            organizationId: organizationId,
            isDeleted: false,
            // Search applied to the bill level
            ...searchWhere<Prisma.BillWhereInput>(opts.search, ['billNumber', 'status']),
          },
        },
        orderBy: { bill: { billDate: 'desc' } },
        skip: (page - 1) * perPage,
        take: takeForPage(perPage),
        include: {
          bill: {
            include: {
              vendor: { select: { contactName: true } },
            },
          },
        },
      });

      const paginated = pageSlice(rows, page, perPage);

      return {
        ...paginated,
        results: paginated.results.map((row) => ({
          id: row.id,
          billId: row.bill?.id,
          billDate: row.bill?.billDate,
          billNumber: row.bill?.billNumber,
          vendorName: row.bill?.vendor?.contactName,
          quantity: Number(row.quantity),
          rate: Number(row.rate),
          amount: Number(row.itemTotal),
          status: row.bill?.status,
        })),
      };
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

      /**
       * 🔴 The scalar shortcut cannot serve a batch-tracked item (2026-08-14).
       * It creates one batch with no reference, and a batch-tracked batch must
       * carry the label the user will pick it by — there is no field on this form
       * to supply one. The opening-stock grid is where that item declares stock,
       * and it asks for the reference per batch.
       */
      if (
        item.inventoryTracking === 'batch' &&
        rest.openingStock !== undefined &&
        rest.openingStock !== null &&
        Number(rest.openingStock) > 0
      ) {
        throw ApiError.badRequest(
          'This item is batch-tracked, so its opening stock has to be entered batch by batch. ' +
            'Save the item first, then add stock from the item page.',
          { openingStock: 'Add opening stock batch by batch after saving.' },
        );
      }

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

  async getItemBatches(itemId: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const grouped = await tx.stockLedgerEntry.groupBy({
        by: ['batchId', 'locationId'],
        where: { organizationId, itemId },
        _sum: { qtyIn: true, qtyOut: true },
      });

      const batchIds = [...new Set(grouped.map((g) => g.batchId))];
      const batches = await tx.batch.findMany({
        where: { id: { in: batchIds }, isDeleted: false },
      });
      const batchMap = new Map(batches.map((b) => [b.id, b]));

      const locationIds = [...new Set(grouped.map((g) => g.locationId))];
      const locations = await tx.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true },
      });
      const locMap = new Map(locations.map((l) => [l.id, l.name]));

      const usedBatchIdsResult = await tx.stockLedgerEntry.findMany({
        where: {
          batchId: { in: batchIds },
          movementType: { notIn: ['opening', 'reversal'] },
        },
        select: { batchId: true },
        distinct: ['batchId'],
      });
      const usedBatchIds = new Set(usedBatchIdsResult.map((e) => e.batchId));

      const results = [];
      const todayStr = new Date().toISOString().substring(0, 10);

      for (const g of grouped) {
        const b = batchMap.get(g.batchId);
        if (!b) continue;

        const qtyIn = Number(g._sum.qtyIn || 0);
        const qtyOut = Number(g._sum.qtyOut || 0);
        const qtyAvailable = qtyIn - qtyOut;

        if (qtyIn === 0 && qtyOut === 0) continue;

        // Skip batches that were opened and reversed out, but never actually used
        if (qtyAvailable <= 0 && !usedBatchIds.has(g.batchId)) {
          continue;
        }

        const expDate = b.expiryDate ? String(b.expiryDate).split('T')[0] : null;
        const isExpired = !!(expDate && expDate < todayStr);

        results.push({
          id: b.id,
          locationId: g.locationId,
          locationName: locMap.get(g.locationId) || 'Primary Location',
          batchReference: b.supplierBatchRef || undefined,
          manufacturerBatch: b.manufacturerBatch || undefined,
          manufacturedDate: b.manufacturedDate || undefined,
          expiryDate: b.expiryDate || undefined,
          quantityIn: qtyIn,
          quantityAvailable: qtyAvailable,
          sellingPrice: b.sellingPrice !== null ? Number(b.sellingPrice) : null,
          mrp: b.mrp !== null ? Number(b.mrp) : null,
          isExpired,
        });
      }
      return results;
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

      /**
       * 🔴 WHAT THIS DOCUMENT ALREADY SAYS. Everything below is a DELTA against
       * it — see `settleOpening` for the defect that made the old
       * reverse-everything-and-recreate approach destructive.
       *
       * `claimed` is how a batch the user still has on screen is told apart from
       * one they deleted: the form round-trips each batch's real id, so a row
       * carrying a known id is that batch edited, and a position nobody claimed is
       * a batch that was removed.
       */
      const positions = await this.openingPositions(tx, itemId, organizationId);
      const claimed = new Set<string>();
      const key = (batchId: string, locationId: string) => `${batchId}_${locationId}`;

      // Soft delete, not a wipe: the row carries who declared what and when.
      await tx.itemOpeningStockRow.updateMany({
        where: { organizationId, itemId, isDeleted: false },
        data: { isDeleted: true, updatedBy: userId ?? null },
      });

      const requiresBatchDetail = item.inventoryTracking === 'batch';

      for (const locRow of data.locationRows) {
        const rows = locRow.batches ?? [];
        for (const b of rows) {
          if (Number(b.quantityIn === '' ? 0 : (b.quantityIn ?? 0)) <= 0) {
            throw ApiError.badRequest('Batch quantity must be greater than zero.', {
              batches: 'All batches must have a quantity greater than zero.',
            });
          }
        }
        const batchTotal = rows.reduce((sum, b) => sum + Number(b.quantityIn), 0);

        const declaredQty =
          locRow.openingStock !== null &&
          locRow.openingStock !== undefined &&
          locRow.openingStock !== ''
            ? new Prisma.Decimal(locRow.openingStock)
            : new Prisma.Decimal(batchTotal);

        if (
          requiresBatchDetail &&
          rows.length > 0 &&
          new Prisma.Decimal(batchTotal).greaterThan(declaredQty)
        ) {
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

        const settleContext = { organizationId, itemId, valuePerUnit, userId };

        // ── 1. Rows naming a batch this document already holds: adjust it, and
        //       keep its details in step. Never a new batch — a batch number is
        //       printed on a tag stuck to a roll, and re-creating it would strand
        //       whatever has already been issued out of the original.
        for (const detail of rows) {
          const position = detail.id ? positions.get(key(detail.id, locRow.locationId)) : undefined;
          if (!position) continue;
          claimed.add(key(position.batchId, position.locationId));

          await this.settleOpening(
            tx,
            position,
            new Prisma.Decimal(detail.quantityIn === '' ? 0 : (detail.quantityIn ?? 0)),
            settleContext,
          );

          await tx.batch.update({
            where: { id: position.batchId },
            data: {
              supplierBatchRef: detail.batchReference || null,
              manufacturerBatch: detail.manufacturerBatch || null,
              manufacturedDate: detail.manufacturedDate ? new Date(detail.manufacturedDate) : null,
              expiryDate: detail.expiryDate ? new Date(detail.expiryDate) : null,
              mrp: detail.mrp ?? null,
              sellingPrice: detail.sellingPrice ?? null,
              updatedBy: userId ?? null,
            },
          });
        }

        // ── 2. Rows naming no batch of ours: genuinely new.
        for (const detail of rows) {
          if (detail.id && positions.has(key(detail.id, locRow.locationId))) continue;

          const qty = new Prisma.Decimal(detail.quantityIn === '' ? 0 : (detail.quantityIn ?? 0));

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
            /* 🔴 Customer-owned goods must go on the books as the customer's, or
               the availability query — which filters on ownership (§5.2) — will
               not offer them back to that customer's job orders. Only ever set by
               a caller that knows whose goods these are; the Item screen omits it
               and gets `own`. */
            ownership: data.ownership ?? 'own',
            ownerPartyId: data.ownership === 'customer' ? (data.ownerPartyId ?? null) : null,
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

        // ── 3. No batch rows at all: an `inventoryTracking = 'none'` item, which
        //       declares a bulk quantity and lets the system hold the batch. The
        //       bulk figure is reconciled against whatever batches this document
        //       already put here rather than replacing them, so the synthetic
        //       batch survives a re-save with its history.
        if (rows.length === 0) {
          const here = [...positions.values()]
            .filter(
              (p) =>
                p.locationId === locRow.locationId && !claimed.has(key(p.batchId, p.locationId)),
            )
            .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
          for (const position of here) claimed.add(key(position.batchId, position.locationId));

          const current = here.reduce((sum, p) => sum.plus(p.qty), new Prisma.Decimal(0));
          let remaining = declaredQty.minus(current);

          if (remaining.greaterThan(0)) {
            const top = here[0];
            if (top) {
              await this.settleOpening(tx, top, top.qty.plus(remaining), settleContext);
            } else if (declaredQty.greaterThan(0)) {
              const batch = await createBatch(tx, {
                organizationId,
                itemId,
                uomId: item.stockingUomId,
                ownership: data.ownership ?? 'own',
                ownerPartyId: data.ownership === 'customer' ? (data.ownerPartyId ?? null) : null,
                sourceDocType: 'item_opening_stock',
                sourceDocId: itemId,
                userId,
              });
              await postMovement(tx, {
                organizationId,
                batchId: batch.id,
                locationId: locRow.locationId,
                movementType: 'opening',
                qtyIn: declaredQty,
                valueIn: valuePerUnit ? declaredQty.times(valuePerUnit) : 0,
                sourceDocType: 'item_opening_stock',
                sourceDocId: itemId,
                userId,
              });
            }
          } else if (remaining.lessThan(0)) {
            // Take it off the newest first, so the oldest stock keeps its history.
            for (const position of here) {
              if (remaining.greaterThanOrEqualTo(0)) break;
              const take = Prisma.Decimal.min(remaining.negated(), position.qty);
              await this.settleOpening(tx, position, position.qty.minus(take), settleContext);
              remaining = remaining.plus(take);
            }
          }
        }
      }

      /**
       * ── 4. Everything this document still holds that the payload never
       *       mentioned: the user deleted the batch, or dropped the whole
       *       location. Settling to zero goes through the same guard, so a batch
       *       that has already been issued refuses by name rather than going
       *       negative in silence.
       */
      for (const position of positions.values()) {
        if (claimed.has(key(position.batchId, position.locationId))) continue;
        if (position.qty.lessThanOrEqualTo(0)) continue;
        await this.settleOpening(tx, position, new Prisma.Decimal(0), {
          organizationId,
          itemId,
          valuePerUnit: null,
          userId,
        });

        // Soft delete the batch if it has no other movements
        const otherMovements = await tx.stockLedgerEntry.count({
          where: {
            batchId: position.batchId,
            movementType: { notIn: ['opening', 'reversal'] },
          },
        });
        if (otherMovements === 0) {
          await tx.batch.update({
            where: { id: position.batchId },
            data: { isDeleted: true, updatedBy: userId ?? null },
          });
        }
      }

      return this.readOpeningStock(tx, itemId, organizationId);
    });
  }
}

export const itemsService = new ItemsService();
