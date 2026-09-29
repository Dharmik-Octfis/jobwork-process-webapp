import { runAsTenant, type TenantClient } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import { getMigrationDate } from '../../lib/migrationDate.ts';
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
  OPENING_STOCK_SOURCE_DOC_TYPE,
  postMovement,
  UNALLOCATED_BATCH_STATE,
  type ResolvedBatches,
} from '../inventory/stock-ledger/stockLedger.service.ts';
import { consumersOfEntries } from '../inventory/stock-ledger/costLayers.ts';
import type { ItemOpeningStockDto } from './items.schemas.ts';
import { SOURCE_DOC_TYPES } from '../jobwork/jobwork.types.ts';

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
async function resolveStockingUom(
  tx: TenantClient,
  organizationId: string,
  stockingUomId: string | null | undefined,
) {
  if (!stockingUomId) return null;
  const uom = await tx.unitOfMeasurement.findFirst({
    where: { id: stockingUomId, organizationId, isDeleted: false },
    select: { id: true, unitName: true },
  });
  if (!uom) throw ApiError.badRequest('Unknown unit of measurement.');
  return uom;
}

// The web form has required a unit since 7988a5e, but the API never did — so
// items still landed with none and showed no unit on bills or POs.
const UNIT_REQUIRED = () =>
  ApiError.badRequest('Select a unit for this item.', { unit: 'Select a unit.' });

/** A bill posts stock for every tracked line, so a tracked service would create stock of work done. */
function assertServiceNotStocked(
  itemType: string | undefined,
  trackInventory: boolean | undefined,
) {
  if (itemType === 'service' && trackInventory) {
    throw ApiError.badRequest('A service item cannot track inventory.', {
      trackInventory: 'Services are not stocked.',
    });
  }
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
  /** The `opening` rows that built this position — the cost layers a reduction
   * takes back first (FIFO). Empty on a position this save is creating. */
  inEntryIds: string[];
}

const ZERO = new Prisma.Decimal(0);

/** Below this, a position's stated and posted value are the same rate — rounding, not an edit. */
const VALUE_TOLERANCE = new Prisma.Decimal('0.01');

/**
 * A transaction row's takas and the part of its quantity in none of them — the
 * same `units` + `untaggedQty` pair the Batch Details tab renders. Takas are
 * merged by id so a taka sent in two lines still reads as one.
 */
function summarizeBatchUnits(
  batchQty: Prisma.Decimal,
  units: readonly { batchUnitId: string; label: string; qty: Prisma.Decimal }[],
) {
  const merged = new Map<string, { batchUnitId: string; label: string; qty: Prisma.Decimal }>();
  for (const unit of units) {
    const existing = merged.get(unit.batchUnitId);
    merged.set(
      unit.batchUnitId,
      existing ? { ...existing, qty: existing.qty.plus(unit.qty) } : unit,
    );
  }
  const tagged = [...merged.values()].reduce((sum, unit) => sum.plus(unit.qty), ZERO);
  return {
    units: [...merged.values()].map((unit) => ({
      batchUnitId: unit.batchUnitId,
      label: unit.label,
      qty: Number(unit.qty),
    })),
    untaggedQty: merged.size > 0 ? Math.max(Number(batchQty.minus(tagged)), 0) : 0,
  };
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
        inEntryIds: [],
      };
      current.qty = current.qty.plus(row.qtyIn ?? 0).minus(row.qtyOut ?? 0);
      current.value = current.value.plus(row.valueIn ?? 0).minus(row.valueOut ?? 0);
      if (row.qtyIn.greaterThan(0)) current.inEntryIds.push(row.id);
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
      /**
       * 🔴 THE DAY THE BOOKS BEGAN, and it goes on BOTH branches below — the
       * top-up AND the reduction.
       *
       * An opening figure is a statement about one moment: what was here when we
       * started. Correcting a typo in it does not describe a second event that
       * happened today, it restates that same moment, so "stock as on the
       * migration date" has to come back 400 rather than "500, less 100 in
       * September". This is the opposite of a bill's reversal, which undoes
       * something that really did happen on its own day — and the reason the
       * distinction costs nothing is `created_at`, which still records when each
       * correction was actually typed.
       */
      postedAt: Date;
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
    const { organizationId, itemId, valuePerUnit, postedAt, userId } = context;
    const balanceKey = positionKey(position.batchId, position.batchUnitId, position.locationId);
    // The value already riding on this position, per unit — used when the form
    // states no value of its own, so a top-up is worth what the rest of it is.
    const existingUnitValue = position.qty.greaterThan(0)
      ? position.value.dividedBy(position.qty)
      : new Prisma.Decimal(0);

    /**
     * 🔴 A CHANGED PER UNIT VALUE RESTATES THE WHOLE POSITION — the same rule as a
     * bill's changed rate (FIFO_COSTING_PLAN.md D3). Until 2026-09-29 only the
     * quantity was compared, so a value-only edit returned below having posted
     * nothing: the form said 6500 while the ledger, its cost layer and every
     * report still said 5000. It is taken back whole and received again at the new
     * value, which is only sound while nothing of it has been used; once it has,
     * it is refused by name — posted documents are never re-costed (D2).
     */
    const revalue =
      valuePerUnit !== null &&
      position.qty.greaterThan(0) &&
      desiredQty.greaterThan(0) &&
      position.qty.times(valuePerUnit).minus(position.value).abs().greaterThan(VALUE_TOLERANCE);
    const delta = desiredQty.minus(position.qty);
    if (delta.isZero() && !revalue) return;

    // The reference, not the internal number — the user has to find this row on
    // their own screen, where the number does not appear. A package says so by
    // name, because "batch JV2" is not enough to find a row three levels down.
    const label = position.unitLabel
      ? `${position.unitLabel} (in batch ${position.batch.supplierBatchRef ?? 'unnamed'})`
      : (position.batch.supplierBatchRef ?? 'This batch');

    if (revalue) {
      const users = await consumersOfEntries(tx, organizationId, position.inEntryIds, {
        sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
        sourceDocId: itemId,
      });
      if (users.length > 0) {
        const location = await tx.location.findFirst({
          where: { id: position.locationId, organizationId },
          select: { name: true },
        });
        throw new ApiError(
          409,
          `The per unit value at ${location?.name ?? 'this location'} cannot change: this ` +
            `opening stock is on the books at ${existingUnitValue.toDecimalPlaces(2).toString()} ` +
            `per unit and has already been used by ${users.join(', ')}. Cancel that first, ` +
            'change the value, then create it again.',
          { openingStockValue: 'Value cannot change once stock is used.' },
        );
      }
    }

    const remove = revalue ? position.qty : delta.lessThan(0) ? delta.negated() : ZERO;
    if (remove.greaterThan(0)) {
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
        if (revalue) {
          throw new ApiError(
            409,
            `${label} has already moved — only ${availableQty.toString()} of it is still ` +
              'here, so its per unit value cannot change. Cancel the documents that moved it ' +
              'first, or leave the value as it is.',
            { openingStockValue: `${label} has already moved.` },
          );
        }
        const floor = position.qty.minus(availableQty);
        throw ApiError.badRequest(
          `${label} has already moved — only ${availableQty.toString()} of it is ` +
            `still here, so its opening stock cannot go below ${floor.toString()}. ` +
            'Cancel the documents that moved it first, or leave this row as it is.',
          { batches: `${label} cannot go below ${floor.toString()}.` },
        );
      }
      await this.withdrawOpening(tx, position, remove, context, batches);
      balances?.set(balanceKey, availableQty.minus(remove));
    }

    const add = revalue ? desiredQty : delta.greaterThan(0) ? delta : ZERO;
    if (add.greaterThan(0)) {
      const unit = valuePerUnit ?? existingUnitValue;
      const posted = await postMovement(
        tx,
        {
          organizationId,
          batchId: position.batchId,
          batchUnitId: position.batchUnitId,
          locationId: position.locationId,
          movementType: 'opening',
          qtyIn: add,
          valueIn: add.times(unit),
          sourceDocType: 'item_opening_stock',
          sourceDocId: itemId,
          postedAt,
          userId,
        },
        batches,
      );
      // Only if the caller is already tracking this one — reading it here just to
      // seed the figure would add the query this argument exists to remove.
      const known = balances?.get(balanceKey);
      if (known) balances?.set(balanceKey, known.plus(posted.qtyIn));
    }
  }

  private async withdrawOpening(
    tx: TenantClient,
    position: OpeningPosition,
    remove: Prisma.Decimal,
    context: { organizationId: string; itemId: string; postedAt: Date; userId?: string },
    batches?: ResolvedBatches,
  ) {
    const { organizationId, itemId, postedAt, userId } = context;
    await postMovement(
      tx,
      {
        organizationId,
        batchId: position.batchId,
        batchUnitId: position.batchUnitId,
        locationId: position.locationId,
        movementType: 'reversal',
        qtyOut: remove,
        /* 🔴 FIFO (D3): take back what OPENING STOCK put here — this position's own
           layers first, then the item's other opening layers at this location
           (all dated the anchor, so interchangeable), never a bill's or a
           receipt's. Refused, naming the document, once they are costed away. */
        costScope: {
          kind: 'withdraw',
          sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
          sourceDocId: itemId,
          preferEntryIds: position.inEntryIds,
          batchId: position.batchId,
        },
        sourceDocType: 'item_opening_stock',
        sourceDocId: itemId,
        postedAt,
        userId,
      },
      batches,
    );
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
              unallocatedQty: 0,
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
      const here = activeEntries.filter((entry) => entry.locationId === locationId);
      /* 🔴 The holding batch is NOT a batch row: the form would send it back as a
         named batch and the save would settle it twice. It is the gap between the
         declared figure and the rows, which the form already shows. Only opening
         stock ever moves it, so its opening position is its whole balance. */
      const isHeld = (entry: OpeningPosition) => entry.batch.state === UNALLOCATED_BATCH_STATE;
      const mine = here.filter((entry) => !isHeld(entry));
      const unallocatedQty = here
        .filter(isHeld)
        .reduce((sum, entry) => sum.plus(entry.qty), new Prisma.Decimal(0));

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
        /** Live, off the ledger — never a stored copy. Unallocated stock included. */
        stockOnHand: Number(balance.qty),
        /** Opening stock here not yet assigned to a batch: counted, not issuable. */
        unallocatedQty: Number(unallocatedQty),
        committedStock: 0,
        availableForSale: Number(balance.qty.minus(unallocatedQty)),
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
        // the symbol purchase lines show beside quantity and rate
        include: { stockingUom: { select: { symbol: true } } },
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
        include: { stockingUom: { select: { symbol: true } } },
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

  async getItemIssues(itemId: string, organizationId: string, opts: ListQuery) {
    const { page, perPage } = opts;
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!item) {
        throw ApiError.notFound('Item not found');
      }

      // Paged by CHALLAN, not by line: each taka is its own line, so paging lines
      // could split one batch's takas across two pages.
      const issues = await tx.jobIssue.findMany({
        where: {
          organizationId,
          isDeleted: false,
          lines: { some: { itemId, isDeleted: false } },
          ...searchWhere<Prisma.JobIssueWhereInput>(opts.search, ['challanNumber', 'status']),
        },
        orderBy: [{ issueDate: 'desc' }, { challanNumber: 'desc' }],
        skip: (page - 1) * perPage,
        take: takeForPage(perPage),
        select: {
          id: true,
          issueDate: true,
          challanNumber: true,
          processorNameSnapshot: true,
          status: true,
        },
      });

      const paginated = pageSlice(issues, page, perPage);

      const lines = await tx.jobIssueLine.findMany({
        where: {
          organizationId,
          itemId,
          isDeleted: false,
          jobIssueId: { in: paginated.results.map((issue) => issue.id) },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          jobIssueId: true,
          batchId: true,
          qty: true,
          batch: { select: { supplierBatchRef: true } },
          batchUnit: { select: { id: true, label: true } },
        },
      });

      // One row per (challan, batch) — a batch sent as three takas is three lines.
      const byIssue = new Map<string, Map<string, typeof lines>>();
      for (const line of lines) {
        const byBatch = byIssue.get(line.jobIssueId) ?? new Map<string, typeof lines>();
        byBatch.set(line.batchId, [...(byBatch.get(line.batchId) ?? []), line]);
        byIssue.set(line.jobIssueId, byBatch);
      }

      return {
        ...paginated,
        results: paginated.results.flatMap((issue) =>
          [...(byIssue.get(issue.id)?.values() ?? [])].map((group) => {
            const quantity = group.reduce((sum, line) => sum.plus(line.qty), new Prisma.Decimal(0));
            const summary = summarizeBatchUnits(
              quantity,
              group.flatMap((line) =>
                line.batchUnit
                  ? [{ batchUnitId: line.batchUnit.id, label: line.batchUnit.label, qty: line.qty }]
                  : [],
              ),
            );
            return {
              id: `${issue.id}:${group[0]!.batchId}`,
              issueId: issue.id,
              issueDate: issue.issueDate,
              issueNumber: issue.challanNumber,
              vendorName: issue.processorNameSnapshot,
              quantity: Number(quantity),
              status: issue.status,
              batches: [
                {
                  batchId: group[0]!.batchId,
                  batchRef: group[0]!.batch.supplierBatchRef,
                  qty: Number(quantity),
                  ...summary,
                },
              ],
            };
          }),
        ),
      };
    });
  }

  async getItemReceipts(itemId: string, organizationId: string, opts: ListQuery) {
    const { page, perPage } = opts;
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true },
      });
      if (!item) {
        throw ApiError.notFound('Item not found');
      }

      const rows = await tx.jobReceiptOutput.findMany({
        where: {
          itemId: itemId,
          jobReceipt: {
            organizationId: organizationId,
            isDeleted: false,
            ...searchWhere<Prisma.JobReceiptWhereInput>(opts.search, ['receiptNumber', 'status']),
          },
        },
        orderBy: { jobReceipt: { receiptDate: 'desc' } },
        skip: (page - 1) * perPage,
        take: takeForPage(perPage),
        include: {
          jobReceipt: true,
          batches: {
            where: { isDeleted: false },
            orderBy: { seq: 'asc' },
            select: {
              batchId: true,
              kind: true,
              qty: true,
              batch: { select: { supplierBatchRef: true } },
            },
          },
        },
      });

      const paginated = pageSlice(rows, page, perPage);

      /**
       * The takas each receipt put into each batch, from its `produce` rows — not
       * from `batch_units.source_doc_id`, which misses a taka that came back again
       * (resolved, not created, so it keeps the document that first made it).
       */
      const unitMovements = await tx.stockLedgerEntry.groupBy({
        by: ['sourceDocId', 'batchId', 'batchUnitId'],
        where: {
          organizationId,
          itemId,
          sourceDocType: SOURCE_DOC_TYPES.jobReceipt,
          sourceDocId: { in: paginated.results.map((row) => row.jobReceiptId) },
          movementType: 'produce',
          batchUnitId: { not: null },
        },
        _sum: { qtyIn: true },
      });
      const unitLabels = new Map(
        (
          await tx.batchUnit.findMany({
            where: {
              organizationId,
              id: { in: unitMovements.map((row) => row.batchUnitId!) },
            },
            select: { id: true, label: true, seq: true },
          })
        ).map((unit) => [unit.id, unit]),
      );
      const unitsByReceiptBatch = new Map<
        string,
        { batchUnitId: string; label: string; seq: number; qty: Prisma.Decimal }[]
      >();
      for (const row of unitMovements) {
        const unit = unitLabels.get(row.batchUnitId!);
        if (!unit) continue;
        const key = `${row.sourceDocId}:${row.batchId}`;
        unitsByReceiptBatch.set(key, [
          ...(unitsByReceiptBatch.get(key) ?? []),
          { batchUnitId: unit.id, label: unit.label, seq: unit.seq, qty: row._sum.qtyIn ?? ZERO },
        ]);
      }

      return {
        ...paginated,
        results: paginated.results.map((row) => ({
          id: row.id,
          receiptId: row.jobReceipt?.id,
          receiptDate: row.jobReceipt?.receiptDate,
          receiptNumber: row.jobReceipt?.receiptNumber,
          vendorName: row.jobReceipt?.processorNameSnapshot,
          quantity: Number(row.receivedQty),
          status: row.jobReceipt?.status,
          batches: row.batches.map((allocation) => ({
            batchId: allocation.batchId,
            batchRef: allocation.batch.supplierBatchRef,
            kind: allocation.kind,
            qty: Number(allocation.qty),
            ...summarizeBatchUnits(
              allocation.qty,
              (unitsByReceiptBatch.get(`${row.jobReceiptId}:${allocation.batchId}`) ?? []).sort(
                (a, b) => a.seq - b.seq,
              ),
            ),
          })),
        })),
      };
    });
  }

  async create(organizationId: string, rawData: CreateItemDto, userId?: string) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const { customFields: rawCustomFields, frontImage, rearImage, images, ...rest } = data;

      const uom = await resolveStockingUom(tx, organizationId, rest.stockingUomId);
      if (!uom) throw UNIT_REQUIRED();
      assertServiceNotStocked(rest.itemType, rest.trackInventory);

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
          // the name follows the linked unit, never a client string that could disagree
          unit: uom.unitName,
          sku: rest.sku ?? '',
          customFields,
          frontImage: frontImage === null ? Prisma.DbNull : (frontImage as Prisma.InputJsonValue),
          rearImage: rearImage === null ? Prisma.DbNull : (rearImage as Prisma.InputJsonValue),
          images: images ? (images as unknown as Prisma.InputJsonValue) : undefined,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
        // a purchase line created from "New Product" shows this symbol straight away
        include: { stockingUom: { select: { symbol: true } } },
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
              // Stated as at the anchor, same as `saveOpeningStock` — an item
              // created with a figure already on it is the same declaration,
              // just made on the item form instead of the stock one.
              postedAt: (await getMigrationDate(tx, organizationId)) ?? new Date(),
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

      // An edit that omits the unit leaves it alone; one that clears it is refused,
      // so a legacy item without one is fixed by the first full save of its form.
      if (rest.stockingUomId === null) throw UNIT_REQUIRED();
      const uom = await resolveStockingUom(tx, organizationId, rest.stockingUomId);
      if (uom) rest.unit = uom.unitName;
      assertServiceNotStocked(
        rest.itemType ?? item.itemType,
        rest.trackInventory ?? item.trackInventory,
      );
      if (rest.itemType === 'service' && item.itemType !== 'service') {
        const moved = await tx.stockLedgerEntry.count({
          where: { organizationId, itemId: id },
        });
        if (moved > 0) {
          throw ApiError.conflict(
            `${item.name} has stock movements, so it cannot become a service.`,
          );
        }
      }

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

      // Deleting hides the item from valuation while its stock stays on the books —
      // at a godown or at a job worker, own or a customer's. Bring it to zero first.
      const stock = await tx.stockLedgerEntry.aggregate({
        where: { organizationId, itemId: id, stockEffect: { in: ['both', 'physical'] } },
        _sum: { qtyIn: true, qtyOut: true },
      });
      const onHand = (stock._sum.qtyIn ?? new Prisma.Decimal(0)).minus(
        stock._sum.qtyOut ?? new Prisma.Decimal(0),
      );
      if (!onHand.isZero()) {
        throw ApiError.conflict(
          `${item.name} still has ${onHand.toString()} in stock, so it cannot be deleted. ` +
            'Issue, consume or adjust it to zero first, or mark the item inactive.',
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

          const currentImages = Array.isArray(item.images) ? item.images : [];
          const combinedImages = [...currentImages, ...uploadedImageObjects];

          if (combinedImages.length > 3) {
            throw ApiError.badRequest('You can only have up to 3 other images in total.');
          }

          updateData.images = combinedImages as unknown as Prisma.InputJsonValue;
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
      // A reversal nets against the side it undoes instead of counting as fresh
      // movement — a cancelled challan's stock coming back is not a new receipt.
      const byType = await tx.stockLedgerEntry.groupBy({
        by: ['batchId', 'locationId', 'movementType'],
        where: { organizationId, itemId },
        _sum: { qtyIn: true, qtyOut: true },
      });
      const netted = new Map<
        string,
        { batchId: string; locationId: string; qtyIn: number; qtyOut: number }
      >();
      for (const g of byType) {
        const key = `${g.batchId}@${g.locationId}`;
        const row = netted.get(key) ?? {
          batchId: g.batchId,
          locationId: g.locationId,
          qtyIn: 0,
          qtyOut: 0,
        };
        const sumIn = Number(g._sum.qtyIn || 0);
        const sumOut = Number(g._sum.qtyOut || 0);
        if (g.movementType === 'reversal') {
          row.qtyIn -= sumOut;
          row.qtyOut -= sumIn;
        } else {
          row.qtyIn += sumIn;
          row.qtyOut += sumOut;
        }
        netted.set(key, row);
      }
      const grouped = [...netted.values()];

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

        const qtyIn = Number(g.qtyIn.toFixed(4));
        const qtyOut = Number(g.qtyOut.toFixed(4));
        const qtyAvailable = Number((qtyIn - qtyOut).toFixed(4));

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
          /** Opening stock not yet assigned to a batch — it has no reference, so the
           * screen names it off this flag. */
          isUnallocated: b.state === UNALLOCATED_BATCH_STATE,
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
  async getStockSummary(itemId: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const byType = await tx.stockLedgerEntry.groupBy({
        by: ['movementType'],
        where: {
          organizationId,
          itemId,
          sourceDocType: { not: 'item_opening_stock' },
          location: { type: { notIn: ['processor', 'in_transit', 'customer_site'] } },
        },
        _sum: { qtyIn: true, qtyOut: true },
      });
      // Same netting as getItemBatches: a reversal undoes the side it mirrors.
      let stockIn = 0;
      let stockOut = 0;
      for (const g of byType) {
        const sumIn = Number(g._sum.qtyIn ?? 0);
        const sumOut = Number(g._sum.qtyOut ?? 0);
        if (g.movementType === 'reversal') {
          stockIn -= sumOut;
          stockOut -= sumIn;
        } else {
          stockIn += sumIn;
          stockOut += sumOut;
        }
      }
      return {
        stockIn: Number(stockIn.toFixed(4)),
        stockOut: Number(stockOut.toFixed(4)),
      };
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
        where: { id: itemId, organizationId, isDeleted: false },
        select: { id: true, stockingUomId: true, inventoryTracking: true, trackInventory: true },
      });
      if (!item) throw ApiError.notFound('Item not found.');
      if (!item.trackInventory)
        throw ApiError.badRequest('Turn on inventory tracking for this item before adding stock.');
      if (!item.stockingUomId)
        throw ApiError.badRequest('Cannot add stock without a stocking unit of measurement.');

      /**
       * 🔴 OPENING STOCK IS STATED AS AT THE MIGRATION DATE — that is what the
       * anchor is FOR, and until it existed there was no date here to state it as
       * at: every opening row fell through to `postMovement`'s `new Date()` and
       * landed on the day the figures were typed. So "stock as on 31-Mar" came
       * back empty for a business whose books began in April, and the batches
       * aged from the data-entry day rather than from the day they arrived.
       *
       * `new Date()` when the organization has no anchor: unchanged behaviour for
       * everyone who never migrated, which is every organization predating this.
       */
      const openingDate = (await getMigrationDate(tx, organizationId)) ?? new Date();

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

        const settleContext = {
          organizationId,
          itemId,
          valuePerUnit,
          postedAt: openingDate,
          userId,
        };

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
                postedAt: openingDate,
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
              inEntryIds: [],
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
                postedAt: openingDate,
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
                postedAt: openingDate,
                userId,
              },
              postable,
            );
          }
        }

        /**
         * ── 2b. THE UNALLOCATED REMAINDER (2026-09-11). A batch-tracked location
         *       may state more than its batch rows hold — the rule is only that
         *       the batches may not exceed it. Until this existed the difference
         *       was a number on `item_opening_stock_rows` and nothing on the books:
         *       500 declared with 150 in batches showed 150 on hand.
         *
         *       It is now real stock in one holding batch per location, settled by
         *       delta like every other position — so assigning some of it to a
         *       named batch on a later save shrinks it by exactly that much, which
         *       is the only way it is ever released for issue (`postMovement`
         *       refuses everything else).
         */
        if (requiresBatchDetail && rows.length > 0) {
          const inBatches = rows.reduce(
            (sum, b) => sum.plus(new Prisma.Decimal(b.quantityIn === '' ? 0 : (b.quantityIn ?? 0))),
            new Prisma.Decimal(0),
          );
          const unallocated = Prisma.Decimal.max(
            declaredQty.minus(inBatches),
            new Prisma.Decimal(0),
          );
          const holding = [...positions.values()].find(
            (p) =>
              p.locationId === locRow.locationId &&
              p.batch.state === UNALLOCATED_BATCH_STATE &&
              !p.batch.isDeleted,
          );
          if (holding) {
            claimed.add(key(holding.batchId, holding.batchUnitId, holding.locationId));
            await this.settleOpening(
              tx,
              holding,
              unallocated,
              settleContext,
              settleBatches,
              settleBalances,
            );
          } else if (unallocated.greaterThan(0)) {
            const batch = await createBatch(tx, {
              organizationId,
              itemId,
              uomId: item.stockingUomId,
              ownership: data.ownership ?? 'own',
              ownerPartyId: data.ownership === 'customer' ? (data.ownerPartyId ?? null) : null,
              sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
              sourceDocId: itemId,
              userId,
              unallocated: true,
            });
            await postMovement(
              tx,
              {
                organizationId,
                batchId: batch.id,
                locationId: locRow.locationId,
                movementType: 'opening',
                qtyIn: unallocated,
                valueIn: valuePerUnit ? unallocated.times(valuePerUnit) : 0,
                sourceDocType: OPENING_STOCK_SOURCE_DOC_TYPE,
                sourceDocId: itemId,
                postedAt: openingDate,
                userId,
              },
              asResolvedBatch(batch),
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
          /* A holding batch left from when this item WAS batch-tracked becomes
             ordinary bulk stock: an untracked item has no Add-a-batch step to
             release it, so kept locked it could never be issued at all. */
          const held = here.filter((p) => p.batch.state === UNALLOCATED_BATCH_STATE);
          if (!requiresBatchDetail && held.length > 0) {
            await tx.batch.updateMany({
              where: { id: { in: held.map((p) => p.batchId) }, organizationId },
              data: { state: 'open', updatedBy: userId ?? null },
            });
            for (const position of held) position.batch.state = 'open';
          }

          const current = here.reduce((sum, p) => sum.plus(p.qty), new Prisma.Decimal(0));
          let remaining = declaredQty.minus(current);
          // Every position is settled, not only the one whose quantity moves — a
          // changed per unit value restates each of them (see `settleOpening`).
          const desired = new Map(here.map((p) => [p, p.qty] as const));

          if (remaining.greaterThan(0)) {
            const top = here[0];
            if (top) {
              desired.set(top, top.qty.plus(remaining));
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
                postedAt: openingDate,
                userId,
              });
            }
          } else if (remaining.lessThan(0)) {
            // Take it off the newest first, so the oldest stock keeps its history.
            for (const position of here) {
              if (remaining.greaterThanOrEqualTo(0)) break;
              const take = Prisma.Decimal.min(remaining.negated(), position.qty);
              desired.set(position, position.qty.minus(take));
              remaining = remaining.plus(take);
            }
          }

          for (const position of here) {
            await this.settleOpening(
              tx,
              position,
              desired.get(position)!,
              settleContext,
              settleBatches,
              settleBalances,
            );
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
            postedAt: openingDate,
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
