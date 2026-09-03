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
  asResolvedBatch,
  autoUnitLabel,
  createBatch,
  createBatchUnits,
  getAvailableBatchUnits,
  getBalance,
  getBalanceByLocation,
  getBalancesByBatchUnit,
  postMovement,
  type ResolvedBatches,
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

/**
 * A package row the user actually meant, as opposed to a blank one the grid left
 * behind.
 *
 * 🔴 It used to be "has a label", and stopped being that on 2026-09-03 when the
 * label became optional: an unnamed package is now the ordinary case and is
 * auto-named `#seq` at the write. `id` counts on its own so a package already on
 * the books is still SETTLED when its quantity is cleared to zero — dropping it
 * here would leave its stock behind instead of removing it.
 */
const isDeclaredUnit = (unit: {
  id?: string | undefined;
  label?: string | null | undefined;
  quantityIn?: string | number | null | undefined;
}) =>
  Boolean(unit.id) ||
  (unit.label ?? '').trim() !== '' ||
  Number(unit.quantityIn === '' ? 0 : (unit.quantityIn ?? 0)) > 0;

/**
 * What this document currently declares for one batch — or one PACKAGE inside a
 * batch — at one location.
 *
 * 🔴 `batchUnitId` is part of the identity, not a detail hanging off it. A batch
 * holding three takas and a loose remainder is FOUR positions at that location,
 * each settled on its own, because each is a separate thing the user can edit,
 * delete, or have already issued. Keying on the batch alone would net them into
 * one number and make "delete T-2" indistinguishable from "reduce the batch".
 */
interface OpeningPosition {
  batchId: string;
  /** Null on the batch's untagged remainder — which is a position in its own
   * right, and the only one an item with no unit level ever has. */
  batchUnitId: string | null;
  locationId: string;
  batch: Awaited<ReturnType<TenantClient['batch']['findFirstOrThrow']>>;
  /** The package's label, for the error messages and the read-back. */
  unitLabel: string | null;
  unitSeq: number | null;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  postedAt: Date;
}

/** The identity of a position, as a map key. */
function positionKey(batchId: string, batchUnitId: string | null, locationId: string) {
  return `${batchId}_${batchUnitId ?? ''}_${locationId}`;
}

/**
 * 🔴 POSITIONS AT ONE LOCATION, FOLDED BACK INTO THE BATCH ROWS THE FORM SHOWS.
 *
 * The ledger holds one position per package plus one for the untagged remainder;
 * the grid shows one row per BATCH with its packages nested underneath. So a
 * batch's `quantityIn` is the sum of all its positions here — packages included —
 * which is what makes the number on the batch row keep meaning "how much of this
 * batch is here", exactly as it did before the level existed.
 *
 * Both ids round-trip. The batch id is what lets the writer tell "this batch,
 * edited" from "a new batch"; the unit id does the same one level down, and
 * without it deleting a package and renaming one would be the same request.
 */
function toBatchRows(positions: readonly OpeningPosition[]) {
  const byBatch = new Map<
    string,
    {
      id: string;
      batchReference: string | null;
      manufacturerBatch: string | null;
      manufacturedDate: Date | null;
      expiryDate: Date | null;
      sellingPrice: number | null;
      mrp: number | null;
      quantityIn: number;
      units: { id: string; label: string; seq: number; quantityIn: number }[];
    }
  >();

  for (const entry of positions) {
    const row = byBatch.get(entry.batchId) ?? {
      id: entry.batch.id,
      // 🔴 No `batchNumber` (2026-08-14) — internal, and a field in the payload
      // is a field somebody renders. `id` is the round-trip handle.
      batchReference: entry.batch.supplierBatchRef,
      manufacturerBatch: entry.batch.manufacturerBatch,
      manufacturedDate: entry.batch.manufacturedDate,
      expiryDate: entry.batch.expiryDate,
      sellingPrice: entry.batch.sellingPrice !== null ? Number(entry.batch.sellingPrice) : null,
      mrp: entry.batch.mrp !== null ? Number(entry.batch.mrp) : null,
      quantityIn: 0,
      units: [],
    };
    row.quantityIn += Number(entry.qty);
    if (entry.batchUnitId) {
      row.units.push({
        id: entry.batchUnitId,
        label: entry.unitLabel ?? '',
        seq: entry.unitSeq ?? 0,
        quantityIn: Number(entry.qty),
      });
    }
    byBatch.set(entry.batchId, row);
  }

  for (const row of byBatch.values()) row.units.sort((a, b) => a.seq - b.seq);
  return [...byBatch.values()];
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
      include: { batch: true, batchUnit: { select: { label: true, seq: true } } },
      orderBy: { postedAt: 'asc' },
    });

    const positions = new Map<string, OpeningPosition>();
    for (const row of rows) {
      const key = positionKey(row.batchId, row.batchUnitId, row.locationId);
      const current = positions.get(key) ?? {
        batchId: row.batchId,
        batchUnitId: row.batchUnitId,
        locationId: row.locationId,
        batch: row.batch,
        unitLabel: row.batchUnit?.label ?? null,
        unitSeq: row.batchUnit?.seq ?? null,
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
    /**
     * The batches still safe to post against, owned by the caller — see where it
     * is built. A batch absent from it (soft-deleted before this run, or during
     * it) falls through to `postMovement`'s own read and fails there, which is
     * exactly what happens without this argument at all.
     */
    batches?: ResolvedBatches,
    /**
     * The live quantity at each (batch, location), also owned by the caller — the
     * read the guard below would otherwise make per shrinking position.
     *
     * 🔴 It is kept RUNNING: every post here writes its effect back, so a second
     * settle of the same position sees what the first one did. Two payload rows
     * can name one batch, and the guard is meaningless against a stale figure.
     * A key that is missing falls back to reading, so an incomplete map costs a
     * query and never a wrong answer.
     */
    balances?: Map<string, Prisma.Decimal>,
  ) {
    const delta = desiredQty.minus(position.qty);
    if (delta.isZero()) return;

    const { organizationId, itemId, valuePerUnit, userId } = context;
    const balanceKey = positionKey(position.batchId, position.batchUnitId, position.locationId);
    // The value already riding on this position, per unit — used when the form
    // states no value of its own, so a top-up is worth what the rest of it is.
    const existingUnitValue = position.qty.greaterThan(0)
      ? position.value.dividedBy(position.qty)
      : new Prisma.Decimal(0);

    if (delta.greaterThan(0)) {
      const unit = valuePerUnit ?? existingUnitValue;
      const posted = await postMovement(
        tx,
        {
          organizationId,
          batchId: position.batchId,
          batchUnitId: position.batchUnitId,
          locationId: position.locationId,
          movementType: 'opening',
          qtyIn: delta,
          valueIn: delta.times(unit),
          sourceDocType: 'item_opening_stock',
          sourceDocId: itemId,
          userId,
        },
        batches,
      );
      // Only if the caller is already tracking this one — reading it here just to
      // seed the figure would add the query this argument exists to remove.
      const known = balances?.get(balanceKey);
      if (known) balances?.set(balanceKey, known.plus(posted.qtyIn));
      return;
    }

    const remove = delta.negated();
    const availableQty =
      balances?.get(balanceKey) ??
      (
        await getBalance(tx, {
          organizationId,
          batchId: position.batchId,
          // 🔴 Scoped to THIS position, which for the untagged one means the
          // untagged rows alone. Asking about the whole batch would let a
          // reduction of the loose remainder be waived through on the strength
          // of stock that is spoken for by a package — and `postMovement`'s own
          // invariant would then refuse the post, further down, with a message
          // about a rule the user never saw.
          batchUnitId: position.batchUnitId,
          locationId: position.locationId,
        })
      ).qty;
    if (remove.greaterThan(availableQty)) {
      const floor = position.qty.minus(availableQty);
      // The reference, not the internal number — the user has to find this row on
      // their own screen, where the number does not appear. A package says so by
      // name, because "batch JV2" is not enough to find a row three levels down.
      const label = position.unitLabel
        ? `${position.unitLabel} (in batch ${position.batch.supplierBatchRef ?? 'unnamed'})`
        : (position.batch.supplierBatchRef ?? 'This batch');
      throw ApiError.badRequest(
        `${label} has already moved — only ${availableQty.toString()} of it is ` +
          `still here, so its opening stock cannot go below ${floor.toString()}. ` +
          'Cancel the documents that moved it first, or leave this row as it is.',
        { batches: `${label} cannot go below ${floor.toString()}.` },
      );
    }

    const posted = await postMovement(
      tx,
      {
        organizationId,
        batchId: position.batchId,
        batchUnitId: position.batchUnitId,
        locationId: position.locationId,
        movementType: 'reversal',
        qtyOut: remove,
        // Proportional, not the whole value — a partial reduction that wrote off the
        // full value would leave the remainder costing nothing.
        valueOut: remove.times(existingUnitValue),
        sourceDocType: 'item_opening_stock',
        sourceDocId: itemId,
        userId,
      },
      batches,
    );
    balances?.set(balanceKey, availableQty.minus(posted.qtyOut));
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
        batches: toBatchRows(mine),
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
    const customFieldsWhere: Prisma.ItemWhereInput[] = [];
    const directFilters: Prisma.ItemWhereInput = {};

    if (opts.fieldFilters) {
      try {
        const filters = JSON.parse(opts.fieldFilters) as Record<string, string>;
        Object.entries(filters).forEach(([key, value]) => {
          if (!value) return;

          if (key.startsWith('cf_')) {
            const cfKey = key.replace('cf_', '');
            const vals = value.split(',').filter(Boolean);

            customFieldsWhere.push({
              OR: [
                { customFields: { path: [cfKey], equals: value } },
                ...vals.map((v) => ({
                  customFields: { path: [cfKey], array_contains: v },
                })),
              ],
            });
          } else if (key === 'type') {
            directFilters.OR = [{ itemType: value }, { itemStructure: value }];
          } else if (key === 'name') {
            directFilters.name = { contains: value, mode: 'insensitive' };
          } else if (key === 'sku') {
            directFilters.sku = { contains: value, mode: 'insensitive' };
          } else if (key === 'hsn') {
            directFilters.hsnCode = { contains: value, mode: 'insensitive' };
          } else if (key === 'category') {
            directFilters.category = value;
          }
        });
      } catch (_e) {
        // Ignore invalid JSON
      }
    }

    return {
      // The `where` is what the query *means*; RLS is the net under it. Both stay.
      organizationId,
      // isDeleted: false — soft-deleted items never surface, search included.
      isDeleted: false,
      // Preset view ("Goods"), spread in so it narrows rather than replaces.
      ...filterWhere<Prisma.ItemWhereInput>('item', opts.filter),
      ...searchWhere<Prisma.ItemWhereInput>(opts.search, ['name', 'sku', 'category', 'hsnCode']),
      ...directFilters,
      ...(customFieldsWhere.length > 0 ? { AND: customFieldsWhere } : {}),
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
          unit: rest.unit ?? '',
          sku: rest.sku ?? '',
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

          await postMovement(
            tx,
            {
              organizationId,
              batchId: batch.id,
              locationId: primaryLoc.id,
              movementType: 'opening',
              qtyIn: declaredQty,
              valueIn: valuePerUnit ? declaredQty.times(valuePerUnit) : 0,
              sourceDocType: 'item_opening_stock',
              sourceDocId: item.id,
              userId,
            },
            // `createBatch` just returned this row — no reason to read it back.
            asResolvedBatch(batch),
          );
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

      /**
       * 🔴 WHERE EACH PACKAGE IS — plan §8's first question, answered on the
       * screen where it is actually asked.
       *
       * "What is in B-1, how much in each, and where" is this grid one level
       * down, so the packages hang off the (batch, location) rows it already
       * builds rather than needing a report of their own. A roll sitting at the
       * dyer's shows under the dyer's row, which is what makes "where is T-1"
       * answerable at a glance.
       *
       * ONE grouped query for every batch on the page, never one per batch — the
       * trap this file's own `getBalanceByLocation` comment describes. Positive
       * balances only, matching the row behaviour above: a roll that has wholly
       * left a location is not in that location.
       *
       * Not gated on the org setting, and deliberately: a batch with no packages
       * returns an empty array either way, so the flag would buy nothing but a
       * second thing to keep in step. What decides whether the level is VISIBLE
       * is the client, which already knows.
       */
      const unitsByKey = new Map<
        string,
        { batchUnitId: string; seq: number; label: string; availableQty: number }[]
      >();
      for (const unit of await getAvailableBatchUnits(tx, { organizationId, batchIds })) {
        const key = `${unit.batchId}@${unit.locationId}`;
        unitsByKey.set(key, [
          ...(unitsByKey.get(key) ?? []),
          {
            batchUnitId: unit.batchUnitId,
            seq: unit.seq,
            label: unit.label,
            availableQty: Number(unit.availableQty),
          },
        ]);
      }

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
        // Ordered by the batch's own `seq`, so T-1 comes before T-2 wherever the
        // two are — the numbering is the only order a roll has.
        const units = (unitsByKey.get(`${g.batchId}@${g.locationId}`) ?? []).sort(
          (a, c) => a.seq - c.seq,
        );

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
          /** The packages of this batch AT THIS LOCATION, and what is left of
           * each. Empty for a batch that has none, which is every batch in an org
           * that never turned the level on. */
          units,
          /** 🔴 What is here but in no package — the batch's untagged remainder at
           * this location. Real, issuable, and printed so it never reads as stock
           * the system lost. */
          untaggedQty: Number(
            (qtyAvailable - units.reduce((sum, unit) => sum + unit.availableQty, 0)).toFixed(4),
          ),
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
      const key = positionKey;

      /**
       * 🔴 THE BATCHES STILL SAFE TO POST AGAINST — and it costs NOTHING.
       *
       * `settleOpening` posted one movement per position and `postMovement` read
       * the batch back on every one of them, when `openingPositions` had already
       * loaded every one of those rows (`include: { batch: true }`). So this is
       * the same read, hoisted, with no query behind it (2026-09-01).
       *
       * 🔴 A soft-deleted batch is LEFT OUT, and section 4 below DELETES from this
       * map the moment it soft-deletes one. That is the whole reason this is a
       * mutable map the caller owns rather than something resolved once up front:
       * this function deletes batches WHILE it is still settling positions, and
       * the same batch can hold a position at a second location. Posting against
       * a batch that has just been deleted must go on failing exactly as it does
       * today — by missing this map and falling through to `postMovement`'s own
       * `isDeleted: false` read.
       */
      const settleBatches = new Map(
        [...positions.values()]
          .filter((position) => !position.batch.isDeleted)
          .map((position) => [position.batchId, position.batch] as const),
      );

      /**
       * …and the live quantity behind each of them, one read per LOCATION rather
       * than one per shrinking position (2026-09-01).
       *
       * Only the reduction path consults it — the guard that refuses to take a
       * batch below what has already left — but a save that clears rows off the
       * grid reduces every one of them, so "only on reduction" is most of a run.
       *
       * `settleOpening` keeps it running as it posts. Nothing else in this
       * function writes to these pairs: sections 2 and 3 mint NEW batches and NEW
       * packages, which by definition hold no position here.
       *
       * 🔴 Keyed per POSITION, so per package as well as per batch — the same key
       * `settleOpening` looks up. `getBalancesByBatchUnit` returns the untagged
       * remainder under a `null` key, which is exactly the untagged position, so
       * one grouped query per location still covers every row.
       */
      const settleBalances = new Map<string, Prisma.Decimal>();
      const batchIdsByLocation = new Map<string, string[]>();
      for (const position of positions.values()) {
        batchIdsByLocation.set(position.locationId, [
          ...(batchIdsByLocation.get(position.locationId) ?? []),
          position.batchId,
        ]);
      }
      for (const [locationId, batchIds] of batchIdsByLocation) {
        const atLocation = await getBalancesByBatchUnit(tx, {
          organizationId,
          locationId,
          batchIds,
        });
        for (const [batchId, byUnit] of atLocation) {
          for (const [batchUnitId, qty] of byUnit) {
            settleBalances.set(key(batchId, batchUnitId, locationId), qty);
          }
        }
      }

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

        /**
         * 🔴 The package rules, beside the write — not only in the zod schema,
         * which runs on the HTTP route alone and would let a script, an import or
         * a test declare a batch whose packages do not account for it.
         *
         * 🔴 NAMING PACKAGES IS OPTIONAL; NAMING SOME OF THEM IS NOT. A batch with
         * none skips this loop entirely (`named` is empty) and declares its whole
         * quantity untagged, exactly as it did before the level existed. Name one,
         * and they must add up to the batch — see the equality below.
         */
        for (const b of rows) {
          const named = (b.units ?? []).filter(
            (u) => (u.label ?? '').trim() !== '' || Number(u.quantityIn ?? 0) > 0,
          );
          if (named.length === 0) continue;
          const rowName = b.batchReference || 'this batch';

          const seen = new Set<string>();
          for (const u of named) {
            // 🔴 A LABEL IS OPTIONAL SINCE 2026-09-03 — blank means "this roll
            // carries no tag" and `createBatchUnits` names it `#seq`. So blanks
            // are skipped by the duplicate check rather than rejected: two
            // unnamed packages are two packages, not a collision.
            const label = (u.label ?? '').trim();
            if (label) {
              // A label is a physical tag; two rows carrying the same one cannot
              // be told apart on any screen or on the goods themselves.
              if (seen.has(label.toLowerCase())) {
                throw ApiError.badRequest(`${rowName} names the unit ${label} twice.`, {
                  batches: `${rowName}: ${label} is used twice.`,
                });
              }
              seen.add(label.toLowerCase());
            }
            if (!(Number(u.quantityIn ?? 0) > 0)) {
              const name = label || 'a unit';
              throw ApiError.badRequest(`Unit ${name} needs a quantity greater than zero.`, {
                batches: `${rowName}: ${name} needs a quantity greater than zero.`,
              });
            }
          }

          // 🔴 An EQUALITY since 2026-09-02: naming any package commits to naming
          // them all, so a batch is broken down completely or not at all. Naming
          // NONE stays legal — `named` is empty and this block does not run.
          const unitTotal = named.reduce((sum, u) => sum + Number(u.quantityIn ?? 0), 0);
          const batchQtyIn = Number(b.quantityIn ?? 0);
          if (Math.abs(unitTotal - batchQtyIn) > 0.00005) {
            throw ApiError.badRequest(
              `The units inside ${rowName} add up to ${unitTotal}, not the ${batchQtyIn} ` +
                'the batch itself holds.',
              {
                batches: `${rowName}: its units must account for the whole batch, or name none at all.`,
              },
            );
          }
        }

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
          // A batch this document holds shows up as at least one position, but
          // WHICH one is not knowable from the batch id alone once packages
          // exist — so identity is "any position of this batch here".
          const here = detail.id
            ? [...positions.values()].filter(
                (p) => p.batchId === detail.id && p.locationId === locRow.locationId,
              )
            : [];
          if (here.length === 0) continue;
          const batchId = detail.id!;

          const batchQty = new Prisma.Decimal(
            detail.quantityIn === '' ? 0 : (detail.quantityIn ?? 0),
          );
          const named = (detail.units ?? []).filter(isDeclaredUnit);

          /**
           * 🔴 PACKAGES FIRST, THE REMAINDER LAST — and the order is load-bearing,
           * not tidiness.
           *
           * `postMovement` refuses an untagged outward row that would leave the
           * packages claiming more than the batch holds. Settling a package moves
           * BOTH sides of that inequality by the same amount, so it can never
           * break it; settling the remainder moves only the batch side. Doing the
           * remainder first would make a save that shrinks both — the ordinary
           * "this batch was smaller than I thought" edit — fail against a state
           * that only exists halfway through its own transaction.
           */
          const existingUnits = new Map(
            here.filter((p) => p.batchUnitId).map((p) => [p.batchUnitId!, p] as const),
          );

          for (const u of named) {
            const position = u.id ? existingUnits.get(u.id) : undefined;
            const qty = new Prisma.Decimal(u.quantityIn === '' ? 0 : (u.quantityIn ?? 0));
            if (!position) continue;
            claimed.add(key(batchId, position.batchUnitId, locRow.locationId));
            await this.settleOpening(
              tx,
              position,
              qty,
              settleContext,
              settleBatches,
              settleBalances,
            );
            // The tag may have been re-typed — the package is the same physical
            // thing, so this is a rename, not a new package.
            //
            // 🔴 CLEARING the box does not blank the label, it restores the
            // automatic one. A `batch_units.label` is NOT NULL and every picker,
            // challan and error message reads it, so an empty string would leave a
            // package the user cannot pick out of a list — "no name" and
            // "auto-named" are the same thing here, and the second is the one that
            // still prints.
            const typed = (u.label ?? '').trim();
            const label = typed || autoUnitLabel(position.unitSeq ?? 0);
            if (label !== position.unitLabel) {
              await tx.batchUnit.update({
                where: { id: position.batchUnitId! },
                data: { label, updatedBy: userId ?? null },
              });
            }
          }

          // Packages the user added to a batch that already existed — the top-up
          // case. `createBatchUnits` continues the batch's own `seq`.
          const fresh = named.filter((u) => !u.id || !existingUnits.has(u.id));
          if (fresh.length > 0) {
            const created = await createBatchUnits(tx, {
              organizationId,
              batchId,
              units: fresh.map((u) => ({
                label: (u.label ?? '').trim(),
                qty: u.quantityIn === '' ? 0 : (u.quantityIn ?? 0),
              })),
              uomId: item.stockingUomId,
              sourceDocType: 'item_opening_stock',
              sourceDocId: itemId,
              userId,
            });
            for (const unit of created) {
              claimed.add(key(batchId, unit.id, locRow.locationId));
              await postMovement(tx, {
                organizationId,
                batchId,
                batchUnitId: unit.id,
                locationId: locRow.locationId,
                movementType: 'opening',
                qtyIn: unit.qty,
                valueIn: valuePerUnit ? unit.qty.times(valuePerUnit) : 0,
                sourceDocType: 'item_opening_stock',
                sourceDocId: itemId,
                userId,
              });
            }
          }

          // …and finally the untagged remainder: what the batch holds, less
          // everything now spoken for by a package.
          const unitTotal = named.reduce(
            (sum, u) => sum.plus(new Prisma.Decimal(u.quantityIn === '' ? 0 : (u.quantityIn ?? 0))),
            new Prisma.Decimal(0),
          );
          const loose = Prisma.Decimal.max(batchQty.minus(unitTotal), new Prisma.Decimal(0));
          const loosePosition =
            here.find((p) => p.batchUnitId === null) ??
            ({
              batchId,
              batchUnitId: null,
              locationId: locRow.locationId,
              batch: here[0]!.batch,
              unitLabel: null,
              unitSeq: null,
              qty: new Prisma.Decimal(0),
              value: new Prisma.Decimal(0),
              postedAt: here[0]!.postedAt,
            } satisfies OpeningPosition);
          claimed.add(key(batchId, null, locRow.locationId));
          await this.settleOpening(
            tx,
            loosePosition,
            loose,
            settleContext,
            settleBatches,
            settleBalances,
          );

          await tx.batch.update({
            where: { id: batchId },
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
          const alreadyHandled =
            detail.id &&
            [...positions.values()].some(
              (p) => p.batchId === detail.id && p.locationId === locRow.locationId,
            );
          if (alreadyHandled) continue;

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

          const named = (detail.units ?? []).filter(isDeclaredUnit);
          const created =
            named.length > 0
              ? await createBatchUnits(tx, {
                  organizationId,
                  batchId: batch.id,
                  units: named.map((u) => ({
                    label: (u.label ?? '').trim(),
                    qty: u.quantityIn === '' ? 0 : (u.quantityIn ?? 0),
                  })),
                  uomId: item.stockingUomId,
                  sourceDocType: 'item_opening_stock',
                  sourceDocId: itemId,
                  userId,
                })
              : [];

          // One movement per package, then one for whatever was not tagged. The
          // batch's total is their sum — there is no second number to keep in step.
          const postable = asResolvedBatch(batch, created.length);
          let tagged = new Prisma.Decimal(0);
          for (const unit of created) {
            tagged = tagged.plus(unit.qty);
            await postMovement(
              tx,
              {
                organizationId,
                batchId: batch.id,
                batchUnitId: unit.id,
                locationId: locRow.locationId,
                movementType: 'opening',
                qtyIn: unit.qty,
                valueIn: valuePerUnit ? unit.qty.times(valuePerUnit) : 0,
                sourceDocType: 'item_opening_stock',
                sourceDocId: itemId,
                userId,
              },
              postable,
            );
          }

          const loose = qty.minus(tagged);
          // A batch broken up entirely leaves nothing behind, and a zero-quantity
          // movement is one `postMovement` refuses by design.
          if (loose.greaterThan(0)) {
            await postMovement(
              tx,
              {
                organizationId,
                batchId: batch.id,
                locationId: locRow.locationId,
                movementType: 'opening',
                qtyIn: loose,
                valueIn: valuePerUnit ? loose.times(valuePerUnit) : 0,
                sourceDocType: 'item_opening_stock',
                sourceDocId: itemId,
                userId,
              },
              postable,
            );
          }
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
                p.locationId === locRow.locationId &&
                !claimed.has(key(p.batchId, p.batchUnitId, p.locationId)) &&
                // 🔴 Untagged positions only. This branch is the bulk-quantity
                // shape an `inventoryTracking = 'none'` item takes, and such an
                // item never shows a batch field, so it never shows a package one
                // either (visibility is inherited, not configured per item). A
                // package reaching here would mean a batch-tracked item saved
                // with no batch rows — which section 4 settles to zero, correctly,
                // rather than having its quantity silently reassigned as bulk.
                p.batchUnitId === null,
            )
            .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
          for (const position of here) {
            claimed.add(key(position.batchId, position.batchUnitId, position.locationId));
          }

          const current = here.reduce((sum, p) => sum.plus(p.qty), new Prisma.Decimal(0));
          let remaining = declaredQty.minus(current);

          if (remaining.greaterThan(0)) {
            const top = here[0];
            if (top) {
              await this.settleOpening(
                tx,
                top,
                top.qty.plus(remaining),
                settleContext,
                settleBatches,
                settleBalances,
              );
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
              await this.settleOpening(
                tx,
                position,
                position.qty.minus(take),
                settleContext,
                settleBatches,
                settleBalances,
              );
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
      /**
       * 🔴 PACKAGES BEFORE THE REMAINDERS THEY SIT INSIDE — the same ordering rule
       * as section 1, for the same reason. Zeroing a batch that still holds
       * packages means zeroing four positions; take the untagged one out first and
       * `postMovement` refuses it, because at that instant the packages claim more
       * than the batch holds.
       */
      const orphans = [...positions.values()].sort((a, b) =>
        a.batchUnitId === b.batchUnitId ? 0 : a.batchUnitId ? -1 : 1,
      );
      /** What this run took to zero, for the cleanup pass below. */
      const emptied = new Set<string>();
      const emptiedUnits = new Set<string>();

      for (const position of orphans) {
        if (claimed.has(key(position.batchId, position.batchUnitId, position.locationId))) continue;
        if (position.qty.lessThanOrEqualTo(0)) continue;
        await this.settleOpening(
          tx,
          position,
          new Prisma.Decimal(0),
          {
            organizationId,
            itemId,
            valuePerUnit: null,
            userId,
          },
          settleBatches,
          settleBalances,
        );

        emptied.add(position.batchId);
        if (position.batchUnitId) emptiedUnits.add(position.batchUnitId);
      }

      /**
       * 🔴 THE ROWS BEHIND WHAT WAS JUST EMPTIED — cleaned up in a SECOND PASS,
       * after every settle, and never inside the loop above.
       *
       * It used to sit in that loop, which was sound while a batch had exactly one
       * position per location. It no longer does: a batch holding three packages
       * and a remainder is four positions, so soft-deleting the batch the moment
       * the first one hit zero would delete it out from under the three still
       * waiting to be settled — and `settleBatches.delete` would then make each of
       * those fail, on a save that was doing nothing wrong.
       */
      for (const batchUnitId of emptiedUnits) {
        const stillMoved = await tx.stockLedgerEntry.count({
          where: { batchUnitId, movementType: { notIn: ['opening', 'reversal'] } },
        });
        // A package that some other document has moved keeps its row: the ledger
        // rows naming it are permanent, and they have to stay interpretable.
        if (stillMoved === 0) {
          await tx.batchUnit.update({
            where: { id: batchUnitId },
            data: { isDeleted: true, updatedBy: userId ?? null },
          });
        }
      }

      for (const batchId of emptied) {
        // Still declared somewhere? A batch can sit at two locations and only one
        // of them was cleared.
        const stillDeclared = [...positions.values()].some(
          (p) =>
            p.batchId === batchId &&
            claimed.has(key(p.batchId, p.batchUnitId, p.locationId)) &&
            p.qty.greaterThan(0),
        );
        if (stillDeclared) continue;

        const otherMovements = await tx.stockLedgerEntry.count({
          where: { batchId, movementType: { notIn: ['opening', 'reversal'] } },
        });
        if (otherMovements === 0) {
          await tx.batch.update({
            where: { id: batchId },
            data: { isDeleted: true, updatedBy: userId ?? null },
          });
          // Nothing posts after this point, so removing it from the map is
          // belt-and-braces rather than the load-bearing guard it was while the
          // delete happened mid-run — kept so the invariant reads the same either
          // way: what is not in this map is not safe to post against.
          settleBatches.delete(batchId);
        }
      }

      await tx.item.update({
        where: { id: itemId },
        data: { openingStock: null, openingStockValuePerUnit: null, updatedBy: userId ?? null },
      });

      return this.readOpeningStock(tx, itemId, organizationId);
    });
  }
}

export const itemsService = new ItemsService();
