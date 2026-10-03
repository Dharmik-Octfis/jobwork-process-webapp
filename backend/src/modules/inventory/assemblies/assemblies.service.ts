import { runAsTenant, type TenantClient } from '../../../db/prisma.js';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.js';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.js';
import { reserveSuppliedNumber } from '../../../lib/numberSequence.js';
import { splitByQty } from '../../../lib/splitByQty.js';
import type { AssemblyLineDto, CreateAssemblyDto } from './assemblies.schemas.js';
import type { ListQuery } from '../../../lib/pagination.js';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.js';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.js';
import {
  asResolvedBatch,
  createBatch,
  createBatchUnits,
  postMovement,
  resolveBatchesForPosting,
  reverseMovement,
} from '../stock-ledger/stockLedger.service.js';
import { allocateOutward } from '../stock-ledger/allocateOutward.js';
import { Prisma } from '../../../../generated/prisma/client.ts';

/**
 * 🔴 ASSEMBLIES MOVE STOCK — since 2026-09-02, and they did not before.
 *
 * Until then this module wrote `item_assemblies` and nothing else: components
 * were not consumed, the composite was not produced, and assembling a shirt out
 * of fabric and buttons left every balance in the system untouched. It invented a
 * `DEFAULT-<itemId>` batch per component with a raw `tx.batch.create` purely to
 * satisfy a NOT NULL column. `deleteAssembly` said so in its own comment.
 *
 * The schema had been designed for the real thing all along — `compositeBatchId`,
 * `componentValue`, `additionalCost`, `ownership`, and a line table whose comment
 * says "one (component × batch) ALLOCATION". This file now does what those
 * columns describe.
 *
 * WHAT ONE ASSEMBLE POSTS
 *
 *   · one `consume` per (component, batch) — out of the assembly's location;
 *   · one `produce` for the composite, into a NEW batch whose parents are every
 *     component batch consumed.
 *
 * Value flows with it: each consume takes its batch's cost per unit at that
 * location, the composite's `produce` carries the sum plus `additionalCost`. That
 * is what makes "what did this shirt cost" answerable without storing it twice.
 */

/** What the ledger calls a row this module posted. Its own constant rather than
 * an import from `jobwork.types`: jobwork depends on inventory, and inventory
 * must not depend back. */
const ASSEMBLY_DOC_TYPE = 'item_assembly';

/**
 * Prisma's default interactive-transaction budget is 5 seconds, and an assembly
 * of a twenty-component recipe across several batches each posts a row through
 * `postMovement` — comfortably past it over a network. Same figures and the same
 * reasoning as `DOCUMENT_TX` in `jobwork.types.ts`; duplicated rather than
 * imported for the dependency reason above.
 */
const DOCUMENT_TX = { maxWait: 15_000, timeout: 120_000 } as const;

function runAsDocument<T>(orgId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  return runAsTenant(orgId, fn, DOCUMENT_TX);
}

/** The columns' own precision, so `3 × 33.3333` is not rejected for being a
 * billionth off — the same tolerance every quantity comparison here uses. */
const QTY_EPSILON = new Prisma.Decimal('0.00005');

function decimal(
  value: Prisma.Decimal | number | string | null | undefined | unknown,
): Prisma.Decimal {
  return new Prisma.Decimal((value as Prisma.Decimal | number | string | null | undefined) ?? 0);
}

/** One component line resolved to a real batch, ready to be consumed. */
interface ComponentAllocation {
  itemId: string;
  uomId: string | null;
  batchId: string;
  /** Which package the material came off, when the org runs a unit level. Null is
   * the batch's untagged remainder. */
  batchUnitId: string | null;
  qty: Prisma.Decimal;
  /** What one composite takes, snapshotted. Repeats across the several
   * allocations of one component. */
  qtyPerUnit: Prisma.Decimal;
}

/** A stock-moving line, once its item is known and its requirement computed. */
interface StockLine {
  line: AssemblyLineDto;
  itemId: string;
  name: string;
  qtyPerUnit: Prisma.Decimal;
  required: Prisma.Decimal;
}

/**
 * Which batches each component comes out of — picked, or oldest first. The rules
 * live in `allocateOutward`, shared with stock adjustments.
 */
async function allocateComponents(
  tx: TenantClient,
  organizationId: string,
  locationId: string,
  lines: readonly StockLine[],
): Promise<ComponentAllocation[]> {
  const allocations = await allocateOutward(tx, {
    organizationId,
    locationId,
    requests: lines.map((row) => ({
      itemId: row.itemId,
      name: row.name,
      required: row.required,
      picks: row.line.batches?.length
        ? row.line.batches
        : row.line.batchId
          ? [{ batchId: row.line.batchId, qty: Number(row.required) }]
          : [],
    })),
  });
  return allocations.map(({ requestIndex, ...allocation }) => ({
    ...allocation,
    qtyPerUnit: lines[requestIndex]!.qtyPerUnit,
  }));
}

export const assembliesService = {
  listWhere: (organizationId: string, opts: ListQuery): Prisma.ItemAssemblyWhereInput => {
    return {
      organizationId,
      isDeleted: false,
      ...filterWhere<Prisma.ItemAssemblyWhereInput>('item_assembly', opts.filter),
      ...searchWhere<Prisma.ItemAssemblyWhereInput>(opts.search, ['assemblyNumber', 'remarks']),
    };
  },

  findManyAssemblies: async (orgId: string, opts: ListQuery) => {
    return runAsTenant(orgId, async (tx) => {
      const records = await tx.itemAssembly.findMany({
        where: assembliesService.listWhere(orgId, opts),
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.perPage,
        take: takeForPage(opts.perPage),
        include: {
          compositeItem: {
            select: { name: true, sku: true },
          },
          lines: {
            select: {
              qty: true,
              unitValue: true,
              value: true,
              item: { select: { costPrice: true } },
            },
          },
        },
      });

      const results = records.map((record) => {
        const computedComponentValue = record.lines.reduce((sum, line) => {
          const val = Number(line.value);
          const computed = val > 0 ? val : Number(line.qty) * Number(line.item.costPrice || 0);
          return sum + computed;
        }, 0);

        return {
          ...record,
          qty: Number(record.qty),
          totalValue: computedComponentValue + Number(record.additionalCost),
          componentValue: computedComponentValue,
          additionalCost: Number(record.additionalCost),
        };
      });

      return pageSlice(results, opts.page, opts.perPage);
    });
  },

  countAssemblies: async (orgId: string, opts: ListQuery) => {
    return runAsTenant(orgId, async (tx) => {
      return tx.itemAssembly.count({
        where: assembliesService.listWhere(orgId, opts),
      });
    });
  },

  createAssembly: async (orgId: string, userId: string, data: CreateAssemblyDto) => {
    return runAsDocument(orgId, async (tx) => {
      // 1. Validate that the composite item exists and belongs to the org
      const compositeItem = await tx.item.findFirst({
        where: { id: data.compositeItemId, organizationId: orgId, itemStructure: 'composite' },
      });

      if (!compositeItem) {
        throw ApiError.notFound('Composite item not found.');
      }

      // 2. Validate location exists
      const location = await tx.location.findFirst({
        where: { id: data.locationId, organizationId: orgId },
      });

      if (!location) {
        throw ApiError.notFound('Location not found.');
      }

      // 3. Generate assembly number if not provided
      const assemblyNumber = data.assemblyNumber;
      if (!assemblyNumber) {
        throw ApiError.badRequest('Assembly number is required');
      }

      await reserveSuppliedNumber(tx, orgId, 'assembly', assemblyNumber);

      const assemblyDate = new Date(data.assemblyDate);
      await assertOnOrAfterMigration(tx, {
        organizationId: orgId,
        date: assemblyDate,
        field: 'assemblyDate',
        label: 'assembly',
      });
      const headerQty = decimal(data.qty);

      /**
       * 4. SPLIT THE LINES INTO WHAT MOVES AND WHAT DOES NOT.
       *
       * 🔴 A service has no stock, so it cannot be consumed and cannot own an
       * `item_assembly_lines` row — that table's `batch_id` is NOT NULL because
       * every row of it is a real movement. Its money is real though, and the
       * only honest place for it is `additionalCost`, which rides on the produced
       * batch exactly as labour should. Same for an item the org does not track.
       *
       * One read for every item on the document, never one per line.
       */
      const lineItemIds = [...new Set(data.lines.map((line) => line.itemId))];
      const items = await tx.item.findMany({
        where: { id: { in: lineItemIds }, organizationId: orgId, isDeleted: false },
        select: {
          id: true,
          name: true,
          itemType: true,
          itemStructure: true,
          trackInventory: true,
          stockingUomId: true,
        },
      });
      const itemById = new Map(items.map((item) => [item.id, item]));

      const stockLines = [];
      let additionalCost = decimal(0);

      for (const line of data.lines) {
        const item = itemById.get(line.itemId);
        if (!item) throw ApiError.notFound('Component item not found.');
        // A composite component is consumed from its own batches like any item
        // (landed-cost plan §6.1) — its recipe was already spent when it was made.

        const required = decimal(line.qtyRequired);
        if (required.lessThanOrEqualTo(0)) continue;

        const movesStock = item.itemType !== 'service' && item.trackInventory;
        if (!movesStock) {
          // Its cost still reaches the composite — through `additionalCost`.
          additionalCost = additionalCost.plus(required.times(decimal(line.unitValue)));
          continue;
        }

        if (!item.stockingUomId)
          throw ApiError.badRequest(`Component ${item.name} must have a stocking unit.`);

        stockLines.push({
          line,
          itemId: item.id,
          name: item.name,
          // What one composite takes, snapshotted from what this document is
          // actually doing rather than re-read from a recipe that may have moved.
          qtyPerUnit: headerQty.greaterThan(0) ? required.dividedBy(headerQty) : decimal(0),
          required,
        });
      }

      // 5. Which batches those components come out of — picked, or FIFO.
      const allocations = await allocateComponents(tx, orgId, data.locationId, stockLines);
      if (allocations.length === 0) {
        throw ApiError.badRequest(
          'Nothing on this assembly moves any stock, so there is nothing to assemble.',
        );
      }

      /**
       * 6. 🔴 EVERY COMPONENT BATCH MUST AGREE ON OWNERSHIP, and the composite
       * inherits it.
       *
       * Building our own goods out of a customer's — or one customer's out of
       * another's — is the same class of failure as a missing tenant filter: the
       * output would carry a value it has no right to, or none it should have had.
       * `postMovement` zeroes value on customer-owned stock, so a mixture would
       * also be silently mispriced.
       */
      const componentBatches = await resolveBatchesForPosting(
        tx,
        orgId,
        allocations.map((row) => row.batchId),
      );
      const owners = new Set(
        [...componentBatches.values()].map(
          (batch) => `${batch.ownership}:${batch.ownerPartyId ?? ''}`,
        ),
      );
      if (owners.size > 1) {
        throw ApiError.badRequest(
          'The components come from batches with different owners, so they cannot be assembled ' +
            'into one item. Assemble each owner’s material separately.',
        );
      }
      const anyBatch = [...componentBatches.values()][0];
      const ownership = (anyBatch?.ownership ?? 'own') as 'own' | 'customer';
      const ownerPartyId = anyBatch?.ownerPartyId ?? null;

      if (ownership === 'customer' && !additionalCost.isZero()) {
        throw ApiError.badRequest(
          'Customer-owned stock carries no value, so labour and extras cannot be added to it. ' +
            'Bill that work as a service instead.',
        );
      }

      /**
       * 7. CONSUME each allocation, costed FIFO over the component's layers AT
       * THIS LOCATION — whichever batch was physically picked (FIFO plan §3.3).
       */
      const resolvedLines: (ComponentAllocation & {
        unitValue: Prisma.Decimal;
        value: Prisma.Decimal;
      })[] = [];
      let componentValue = decimal(0);

      for (const allocation of allocations) {
        const posted = await postMovement(
          tx,
          {
            organizationId: orgId,
            batchId: allocation.batchId,
            // Off the roll it was cut from, when one was named. Partial by
            // design here — see `ComponentAllocation`.
            batchUnitId: allocation.batchUnitId,
            locationId: data.locationId,
            movementType: 'consume',
            qtyOut: allocation.qty,
            sourceDocType: ASSEMBLY_DOC_TYPE,
            postedAt: assemblyDate,
            userId,
          },
          componentBatches,
        );

        /* Taken from the row WRITTEN — `postMovement` decides the value, and zeroes
           it on customer-owned stock. */
        componentValue = componentValue.plus(posted.valueOut);
        const unitValue = posted.qtyOut.greaterThan(0)
          ? posted.valueOut.dividedBy(posted.qtyOut)
          : decimal(0);
        resolvedLines.push({ ...allocation, unitValue, value: posted.valueOut });
      }

      const totalValue = componentValue.plus(additionalCost);

      /**
       * 8. PRODUCE the composite, into a batch of its own.
       *
       * 🔴 Genealogy is written HERE or never (`inventory.prisma`). A composite is
       * a physically new thing with no number of its own, so the only record of
       * what it was made from is this parent list — and it cannot be rebuilt from
       * history that was never recorded. Every component batch is a parent, deduped.
       */
      const compositeBatch = await createBatch(tx, {
        organizationId: orgId,
        itemId: compositeItem.id,
        uomId: compositeItem.stockingUomId,
        ownership,
        ownerPartyId,
        parentBatchIds: [...new Set(allocations.map((row) => row.batchId))],
        supplierBatchRef: data.compositeBatchRef ?? null,
        sourceDocType: ASSEMBLY_DOC_TYPE,
        userId,
      });

      /**
       * 🔴 THE PACKAGES THE COMPOSITE COMES OUT AS — ten shirts boxed into two
       * cartons. Created before anything is posted, so each `produce` can name the
       * one it belongs to.
       *
       * 🔴 NAMING PACKAGES IS OPTIONAL; NAMING SOME OF THEM IS NOT (2026-09-02).
       * Name none and the whole output is untagged, exactly as before the level
       * existed. Name one and they must add up to the assembly — the same
       * equality that holds on bills, receipts and opening stock.
       */
      const compositeUnits = data.compositeUnits?.length
        ? await createBatchUnits(tx, {
            organizationId: orgId,
            batchId: compositeBatch.id,
            units: data.compositeUnits.map((unit) => ({ label: unit.label ?? '', qty: unit.qty })),
            uomId: compositeItem.stockingUomId,
            sourceDocType: ASSEMBLY_DOC_TYPE,
            userId,
          })
        : [];

      const tagged = compositeUnits.reduce((sum, unit) => sum.plus(unit.qty), decimal(0));
      if (compositeUnits.length > 0 && tagged.minus(headerQty).abs().greaterThan(QTY_EPSILON)) {
        throw ApiError.badRequest(
          `The units named on the output add up to ${tagged.toString()}, not the ` +
            `${headerQty.toString()} being assembled.`,
          {
            compositeUnits:
              'The units must account for the whole quantity assembled, or name none at all.',
          },
        );
      }

      /* Value splits across the packages by quantity, with the untagged remainder
         as the last part — so the batch's total is identical whether or not it was
         boxed. A package carries no value of its own; it inherits its batch's
         weighted average, and this is how. */
      const loose = headerQty.minus(tagged);
      const parts = [
        ...compositeUnits.map((unit) => unit.qty),
        ...(loose.greaterThan(0) ? [loose] : []),
      ];
      const shares = splitByQty(totalValue, parts);
      const postable = asResolvedBatch(compositeBatch, compositeUnits.length);

      for (const [index, unit] of compositeUnits.entries()) {
        await postMovement(
          tx,
          {
            organizationId: orgId,
            batchId: compositeBatch.id,
            batchUnitId: unit.id,
            locationId: data.locationId,
            movementType: 'produce',
            qtyIn: unit.qty,
            valueIn: shares[index] ?? decimal(0),
            sourceDocType: ASSEMBLY_DOC_TYPE,
            postedAt: assemblyDate,
            userId,
          },
          postable,
        );
      }

      // A composite boxed entirely leaves nothing behind, and a zero-quantity
      // movement is one `postMovement` refuses by design.
      if (loose.greaterThan(0)) {
        await postMovement(
          tx,
          {
            organizationId: orgId,
            batchId: compositeBatch.id,
            locationId: data.locationId,
            movementType: 'produce',
            qtyIn: loose,
            valueIn: shares[shares.length - 1] ?? decimal(0),
            sourceDocType: ASSEMBLY_DOC_TYPE,
            postedAt: assemblyDate,
            userId,
          },
          postable,
        );
      }

      // 9. The document, describing exactly what was just posted.
      const assembly = await withUniqueViolation(
        'Assembly number already exists in this organization.',
        () =>
          tx.itemAssembly.create({
            data: {
              organizationId: orgId,
              assemblyNumber,
              assemblyDate,
              compositeItemId: data.compositeItemId,
              compositeUomId: compositeItem.stockingUomId,
              compositeBatchId: compositeBatch.id,
              qty: data.qty,
              locationId: data.locationId,
              remarks: data.remarks,
              createdBy: userId,
              updatedBy: userId,
              direction: 'assemble',
              status: 'assembled',
              ownership,
              ownerPartyId,
              additionalCost,
              componentValue,
              totalValue,
              lines: {
                create: resolvedLines.map((line, index) => ({
                  organizationId: orgId,
                  seq: index + 1,
                  itemId: line.itemId,
                  uomId: line.uomId,
                  batchId: line.batchId,
                  // Which roll the material was cut off, when one was named.
                  batchUnitId: line.batchUnitId,
                  qtyPerUnit: line.qtyPerUnit,
                  qty: line.qty,
                  unitValue: line.unitValue,
                  value: line.value,
                  createdBy: userId,
                  updatedBy: userId,
                })),
              },
            },
            include: {
              lines: true,
            },
          }),
      );

      /**
       * 🔴 THE ROWS WERE POSTED BEFORE THE DOCUMENT EXISTED, so they carry no
       * `sourceDocId` yet. Stamping it now is what makes cancellation possible at
       * all: it replays "every row of this document", and there is no other way to
       * ask that question of an append-only ledger.
       *
       * Scoped to rows with a NULL id, which inside this transaction can only be
       * the ones just written — and the whole thing is one transaction, so a
       * failure anywhere above leaves neither the document nor the rows.
       */
      await tx.stockLedgerEntry.updateMany({
        where: { organizationId: orgId, sourceDocType: ASSEMBLY_DOC_TYPE, sourceDocId: null },
        data: { sourceDocId: assembly.id },
      });

      // 10. Log activity
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const performedBy = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'System';

      await tx.itemAssemblyActivity.create({
        data: {
          organizationId: orgId,
          assemblyId: assembly.id,
          title: 'Assembly Created',
          description: `Assembly ${assembly.assemblyNumber} was created.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return assembly;
    });
  },

  getAssemblyById: async (orgId: string, id: string) => {
    return runAsTenant(orgId, async (tx) => {
      const assembly = await tx.itemAssembly.findUnique({
        where: { id, organizationId: orgId },
        include: {
          compositeItem: {
            select: { name: true, sku: true },
          },
          location: {
            select: { name: true },
          },
          lines: {
            include: {
              item: {
                select: {
                  name: true,
                  sku: true,
                  itemType: true,
                  stockingUomId: true,
                  costPrice: true,
                  stockingUom: { select: { unitName: true } },
                },
              },
            },
          },
        },
      });

      if (!assembly) {
        throw ApiError.notFound('Assembly not found.');
      }

      return {
        ...assembly,
        qty: Number(assembly.qty),
        totalValue: Number(assembly.totalValue),
        componentValue: Number(assembly.componentValue),
        additionalCost: Number(assembly.additionalCost),
        /**
         * 🔴 THE STORED SNAPSHOT, not a fresh derivation.
         *
         * This used to re-price every line off the CURRENT ledger balance — one
         * query per line, and wrong twice over: the batch's cost per unit today is
         * not what this document paid, so opening an old assembly showed figures
         * that disagreed with the ledger rows it actually posted, and they changed
         * again every time anything else touched the batch. `unit_value` and
         * `value` are stored precisely so a posted document can explain itself
         * (`composite.prisma`).
         *
         * The `costPrice` fallback stays for documents written BEFORE assemblies
         * posted to the ledger at all (2026-09-02): those have a zero snapshot
         * because nothing ever computed one, and estimating is better than showing
         * them as free.
         */
        lines: assembly.lines.map((line) => {
          const stored = Number(line.value);
          const storedUnit = Number(line.unitValue);
          const legacy = storedUnit === 0 && stored === 0;
          return {
            ...line,
            qty: Number(line.qty),
            qtyPerUnit: Number(line.qtyPerUnit),
            unitValue: legacy ? Number(line.item.costPrice || 0) : storedUnit,
            value: legacy ? Number(line.qty) * Number(line.item.costPrice || 0) : stored,
          };
        }),
      };
    });
  },

  /**
   * 🔴 CANCEL AN ASSEMBLY — and put the stock back.
   *
   * This used to soft-delete the row and nothing else, which was correct only
   * while assemblies moved no stock. Now that they do, a cancellation that did
   * not reverse would destroy the components AND leave the composite on the
   * books: the exact shape of unrecoverable damage the ledger exists to prevent.
   *
   * A correction is a REVERSING ENTRY, never an edit and never a delete
   * (`inventory.prisma`). Every row this document posted gets its opposite, so
   * the history survives and the balances are right.
   */
  deleteAssembly: async (orgId: string, id: string, userId?: string) => {
    return runAsDocument(orgId, async (tx) => {
      const existing = await tx.itemAssembly.findFirst({
        where: { id, organizationId: orgId, isDeleted: false },
      });
      if (!existing) {
        throw ApiError.notFound('Assembly not found');
      }
      if (existing.status === 'cancelled') {
        throw ApiError.conflict('This assembly is already cancelled.');
      }

      /**
       * 🔴 THE COMPOSITE MUST STILL BE THERE. Cancelling un-makes it, so if any
       * of it has been sold, issued or assembled onward, there is nothing to
       * un-make and the reversal would drive the batch negative.
       *
       * The test is "has anything taken stock OUT", not "has anything touched
       * it" — a later assembly TOPPING UP the same batch is harmless, and a guard
       * that counted it would make every second assembly uncancellable. Rows this
       * document posted are excluded by `sourceDocId`, including its own
       * reversals, so a second attempt reads the same as the first.
       */
      if (existing.compositeBatchId) {
        const movedOn = await tx.stockLedgerEntry.count({
          where: {
            organizationId: orgId,
            batchId: existing.compositeBatchId,
            qtyOut: { gt: 0 },
            NOT: { sourceDocType: ASSEMBLY_DOC_TYPE, sourceDocId: id },
          },
        });
        if (movedOn > 0) {
          throw ApiError.conflict(
            'Some of what this assembly produced has already been used, so it cannot be ' +
              'cancelled. Reverse the documents that used it first.',
          );
        }
      }

      const posted = await tx.stockLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          sourceDocType: ASSEMBLY_DOC_TYPE,
          sourceDocId: id,
          movementType: { not: 'reversal' },
        },
        orderBy: { createdAt: 'asc' },
        // The package and the rest of the row's identity are copied off it by
        // `reverseMovement`, so a reversal cannot come back untagged.
        select: { id: true, batchId: true },
      });

      // A document touches the same few batches repeatedly — read once for the
      // whole cancellation, not once per reversal.
      const reversedBatches = await resolveBatchesForPosting(
        tx,
        orgId,
        posted.map((row) => row.batchId),
      );

      /* The exact opposite of what was posted: consumes give their draws back to
         the layers they came from, the produce withdraws its own layers — refused,
         naming the document, if anything has been costed against them (D3). */
      const now = new Date();
      for (const row of posted) {
        await reverseMovement(
          tx,
          orgId,
          row.id,
          {
            sourceDocType: ASSEMBLY_DOC_TYPE,
            sourceDocId: id,
            remarks: 'Cancelled.',
            postedAt: now,
            userId,
          },
          reversedBatches,
        );
      }

      const updated = await tx.itemAssembly.update({
        where: { id },
        data: {
          isDeleted: true,
          status: 'cancelled',
          updatedBy: userId ?? null,
        },
      });

      await tx.itemAssemblyActivity.create({
        data: {
          organizationId: orgId,
          assemblyId: id,
          title: 'Assembly Cancelled',
          description:
            `Assembly ${existing.assemblyNumber} was cancelled and its ${posted.length} ` +
            'stock movement(s) reversed.',
          performedBy: 'System',
        },
      });

      return updated;
    });
  },

  getAssemblyActivities: async (organizationId: string, assemblyId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.itemAssemblyActivity.findMany({
        where: { assemblyId, organizationId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  },

  getAssemblyComments: async (organizationId: string, assemblyId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.itemAssemblyComment.findMany({
        where: { assemblyId, organizationId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  },

  createAssemblyComment: async (
    organizationId: string,
    assemblyId: string,
    userId: string,
    content: string,
  ) => {
    return runAsTenant(organizationId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const performedBy = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null;

      return tx.itemAssemblyComment.create({
        data: {
          organizationId,
          assemblyId,
          content,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    });
  },

  deleteAssemblyComment: async (organizationId: string, assemblyId: string, commentId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      const existingComment = await tx.itemAssemblyComment.findFirst({
        where: { id: commentId, assemblyId, organizationId, isDeleted: false },
      });

      if (!existingComment) {
        throw ApiError.notFound('Comment not found');
      }

      return tx.itemAssemblyComment.update({
        where: { id: commentId },
        data: {
          isDeleted: true,
        },
      });
    });
  },

  getNumberPreference: async (organizationId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      let seq = await tx.numberSequence.findUnique({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { organizationId_entityType: { organizationId, entityType: 'assembly' } },
      });
      if (!seq) {
        seq = await tx.numberSequence.create({
          data: {
            organizationId,
            entityType: 'assembly',
            prefix: 'ASM-',
            nextNumber: 1,
          },
        });
      }
      return seq;
    });
  },

  updateNumberPreference: async (organizationId: string, prefix: string, nextNumber: number) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.numberSequence.upsert({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { organizationId_entityType: { organizationId, entityType: 'assembly' } },
        create: {
          organizationId,
          entityType: 'assembly',
          prefix,
          nextNumber,
        },
        update: {
          prefix,
          nextNumber,
        },
      });
    });
  },
};
