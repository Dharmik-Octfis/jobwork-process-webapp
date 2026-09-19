import { Prisma } from '../../../../generated/prisma/client.ts';
import type { TenantClient } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';

/**
 * 🔴 FIFO COST LAYERS — the engine behind `postMovement` (docs/FIFO_COSTING_PLAN.md).
 *
 * Only `stockLedger.service.ts` calls into this file. A caller never prices stock
 * that is leaving: it says WHICH layers the row may draw on (a `LayerScope`), and
 * the value is whatever those layers cost, oldest first. That is what makes the
 * ledger's own `value_in − value_out` the valuation, with nothing replayed later.
 *
 * One queue per (item, location), own stock, accounting axis (D1). A batch is
 * traceability and never picks a layer — except a legacy layer, which has no
 * other identity (see `is_legacy`).
 */

const ZERO = new Prisma.Decimal(0);

/** Which layers an outward row may draw on. */
export type LayerScope =
  /** Plain FIFO over the untagged layers of the item at the location. Layers
   * that belong to a challan line are never touched — they are that job's. */
  | { kind: 'fifo' }
  /**
   * Plain FIFO, except this batch's own layers go first. Only for a REWORK
   * challan: the pieces going back are the ones that failed, and their layer
   * carries material alone, while the accepted pieces from the same receipt
   * carry the processing charge too. Costing the rework at the accepted cost
   * would charge those pieces twice (landed-cost R7).
   */
  | { kind: 'batchFirst'; batchId: string }
  /** Processor stock (§3.4): only the layers these challan lines brought, plus
   * legacy layers of this batch (stock that was there before FIFO). */
  | { kind: 'job'; issueLineIds: readonly string[]; batchId: string }
  /**
   * Taking back part of what an INWARD document put on the books (opening-stock
   * reduction, a bill's net reversal). The document's own layers at this place,
   * `preferEntryIds` first, newest first; then legacy layers of this batch.
   */
  | {
      kind: 'withdraw';
      sourceDocType: string;
      sourceDocId: string;
      preferEntryIds: readonly string[];
      batchId: string;
      /** Only `preferEntryIds`' layers (then legacy) — never another line's. A bill
       * edit takes back exactly the position it changes. */
      strict?: boolean;
    }
  /** Reversing ONE inward row: exactly the layers it created (legacy: its batch's). */
  | { kind: 'entry'; entryId: string; batchId: string };

export interface LayerDraw {
  layerId: string;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  inDate: Date;
}

interface LockedLayer {
  id: string;
  remainingQty: Prisma.Decimal;
  remainingValue: Prisma.Decimal;
  inDate: Date;
}

interface QueueKey {
  organizationId: string;
  itemId: string;
  locationId: string;
}

/** The legacy fallback shared by every scope that names a batch. */
function legacyOf(batchId: string): Prisma.Sql {
  return Prisma.sql`(l.is_legacy AND l.source_doc_line_id IS NULL AND l.batch_id = ${batchId}::uuid)`;
}

/** The WHERE for one scope — without the `remaining_qty > 0` test, so the refusal
 * path can ask who consumed what the scope used to hold. */
function scopeCondition(scope: Exclude<LayerScope, { kind: 'entry' }>): Prisma.Sql {
  switch (scope.kind) {
    case 'fifo':
    case 'batchFirst':
      return Prisma.sql`l.source_doc_line_id IS NULL`;
    case 'job':
      return Prisma.sql`(l.source_doc_line_id = ANY(${[...scope.issueLineIds]}::uuid[]) OR ${legacyOf(scope.batchId)})`;
    case 'withdraw':
      return scope.strict
        ? Prisma.sql`(l.in_ledger_entry_id = ANY(${[...scope.preferEntryIds]}::uuid[]) OR ${legacyOf(scope.batchId)})`
        : Prisma.sql`((e.source_doc_type = ${scope.sourceDocType} AND e.source_doc_id = ${scope.sourceDocId}::uuid) OR ${legacyOf(scope.batchId)})`;
  }
}

function scopeOrder(scope: Exclude<LayerScope, { kind: 'entry' }>): Prisma.Sql {
  switch (scope.kind) {
    case 'fifo':
      return Prisma.sql`l.in_date, l.in_seq`;
    case 'batchFirst':
      return Prisma.sql`(l.batch_id = ${scope.batchId}::uuid) DESC, l.in_date, l.in_seq`;
    // The job's own layers before stock that predates FIFO.
    case 'job':
      return Prisma.sql`l.is_legacy, l.in_date, l.in_seq`;
    // A correction takes back the newest of what the document put here first.
    case 'withdraw':
      return Prisma.sql`CASE WHEN l.in_ledger_entry_id = ANY(${[...scope.preferEntryIds]}::uuid[]) THEN 0
                             WHEN l.is_legacy THEN 2 ELSE 1 END, l.in_seq DESC`;
  }
}

/**
 * The layers a draw may take from, LOCKED, in the order it takes them.
 *
 * 🔴 `FOR UPDATE` is the concurrency guarantee: two challans posting against one
 * item+location queue serialise here, and the second re-reads each layer after
 * the first commits — so no layer is ever drawn below zero.
 */
async function lockLayers(
  tx: TenantClient,
  key: QueueKey,
  scope: LayerScope,
): Promise<LockedLayer[]> {
  const base = Prisma.sql`
    l.organization_id = ${key.organizationId}::uuid
    AND l.item_id = ${key.itemId}::uuid
    AND l.location_id = ${key.locationId}::uuid`;

  if (scope.kind === 'entry') {
    // Every layer the row created, spent or not — "has it any" decides legacy.
    const own = await tx.$queryRaw<LockedLayer[]>`
      SELECT l.id, l.remaining_qty AS "remainingQty", l.remaining_value AS "remainingValue", l.in_date AS "inDate"
      FROM stock_cost_layers l
      WHERE ${base} AND l.in_ledger_entry_id = ${scope.entryId}::uuid
      ORDER BY l.in_seq
      FOR UPDATE`;
    if (own.length > 0) return own.filter((layer) => layer.remainingQty.greaterThan(0));
    return tx.$queryRaw<LockedLayer[]>`
      SELECT l.id, l.remaining_qty AS "remainingQty", l.remaining_value AS "remainingValue", l.in_date AS "inDate"
      FROM stock_cost_layers l
      WHERE ${base} AND l.remaining_qty > 0 AND ${legacyOf(scope.batchId)}
      ORDER BY l.in_date, l.in_seq
      FOR UPDATE`;
  }

  return tx.$queryRaw<LockedLayer[]>`
    SELECT l.id, l.remaining_qty AS "remainingQty", l.remaining_value AS "remainingValue", l.in_date AS "inDate"
    FROM stock_cost_layers l
    LEFT JOIN stock_ledger e ON e.id = l.in_ledger_entry_id
    WHERE ${base} AND l.remaining_qty > 0 AND ${scopeCondition(scope)}
    ORDER BY ${scopeOrder(scope)}
    FOR UPDATE OF l`;
}

/**
 * Take `qty` out of the layers `scope` allows, and return what was taken.
 *
 * 🔴 Refuses when the layers hold less than `qty` — it never costs a shortfall at
 * zero, and it is also what stops the ledger going negative: every costed
 * outward row, reversals included, needs layers to draw on.
 *
 * Rounding: a draw that empties a layer takes exactly its `remaining_value`, never
 * `qty × unit cost`, so no paisa is left stranded on an empty layer.
 */
export async function drawLayers(
  tx: TenantClient,
  key: QueueKey,
  qty: Prisma.Decimal,
  scope: LayerScope,
): Promise<{ draws: LayerDraw[]; value: Prisma.Decimal }> {
  const layers = await lockLayers(tx, key, scope);

  let need = qty;
  const draws: LayerDraw[] = [];
  for (const layer of layers) {
    if (!need.greaterThan(0)) break;
    const take = Prisma.Decimal.min(need, layer.remainingQty);
    const value = take.equals(layer.remainingQty)
      ? layer.remainingValue
      : Prisma.Decimal.min(
          layer.remainingValue.times(take).dividedBy(layer.remainingQty).toDecimalPlaces(4),
          layer.remainingValue,
        );
    draws.push({ layerId: layer.id, qty: take, value, inDate: layer.inDate });
    need = need.minus(take);
  }

  if (need.greaterThan(0)) {
    await refuseShortfall(tx, key, qty, qty.minus(need), scope);
  }

  // One UPDATE per layer touched — a draw spans one or two layers in practice.
  for (const draw of draws) {
    await tx.stockCostLayer.update({
      where: { id: draw.layerId },
      data: {
        remainingQty: { decrement: draw.qty },
        remainingValue: { decrement: draw.value },
      },
    });
  }

  return { draws, value: draws.reduce((sum, draw) => sum.plus(draw.value), ZERO) };
}

export async function recordDraws(
  tx: TenantClient,
  organizationId: string,
  outLedgerEntryId: string,
  draws: readonly LayerDraw[],
) {
  if (draws.length === 0) return;
  await tx.stockLayerDraw.createMany({
    data: draws.map((draw) => ({
      organizationId,
      layerId: draw.layerId,
      outLedgerEntryId,
      qty: draw.qty,
      value: draw.value,
    })),
  });
}

export interface NewLayer {
  itemId: string;
  locationId: string;
  batchId: string;
  inLedgerEntryId: string | null;
  originLayerId?: string | null;
  sourceDocLineId?: string | null;
  isLegacy?: boolean;
  inDate: Date;
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
}

export async function createLayers(
  tx: TenantClient,
  organizationId: string,
  layers: readonly NewLayer[],
) {
  if (layers.length === 0) return;
  await tx.stockCostLayer.createMany({
    data: layers.map((layer) => ({
      organizationId,
      itemId: layer.itemId,
      locationId: layer.locationId,
      batchId: layer.batchId,
      inLedgerEntryId: layer.inLedgerEntryId,
      originLayerId: layer.originLayerId ?? null,
      sourceDocLineId: layer.sourceDocLineId ?? null,
      isLegacy: layer.isLegacy ?? false,
      inDate: layer.inDate,
      qty: layer.qty,
      value: layer.value,
      remainingQty: layer.qty,
      remainingValue: layer.value,
    })),
  });
}

/**
 * Give an outward row's draws back to the layers they came from — the cost half of
 * reversing it. Returns what was restored, or `null` when the row has no draws at
 * all (it predates FIFO), so the caller can fall back.
 */
export async function restoreDraws(
  tx: TenantClient,
  organizationId: string,
  outLedgerEntryId: string,
): Promise<{ qty: Prisma.Decimal; value: Prisma.Decimal } | null> {
  const draws = await tx.stockLayerDraw.findMany({
    where: { organizationId, outLedgerEntryId },
    select: { id: true, layerId: true, qty: true, value: true, reversedAt: true },
  });
  if (draws.length === 0) return null;

  const live = draws.filter((draw) => draw.reversedAt === null);
  if (live.length === 0) {
    throw ApiError.conflict('This stock movement has already been reversed.');
  }

  for (const draw of live) {
    await tx.stockCostLayer.update({
      where: { id: draw.layerId },
      data: {
        remainingQty: { increment: draw.qty },
        remainingValue: { increment: draw.value },
      },
    });
  }
  await tx.stockLayerDraw.updateMany({
    where: { id: { in: live.map((draw) => draw.id) } },
    data: { reversedAt: new Date() },
  });

  return {
    qty: live.reduce((sum, draw) => sum.plus(draw.qty), ZERO),
    value: live.reduce((sum, draw) => sum.plus(draw.value), ZERO),
  };
}

/**
 * The refusal, worded for whoever has to fix it. A correction of an inward
 * document (D3) names the documents that consumed its layers; anything else says
 * how much is on the books there.
 */
async function refuseShortfall(
  tx: TenantClient,
  key: QueueKey,
  qty: Prisma.Decimal,
  available: Prisma.Decimal,
  scope: LayerScope,
): Promise<never> {
  const item = await tx.item.findFirst({ where: { id: key.itemId }, select: { name: true } });
  const location = await tx.location.findFirst({
    where: { id: key.locationId },
    select: { name: true },
  });
  const itemName = item?.name ?? 'this item';
  const place = location?.name ?? 'this location';

  if (scope.kind === 'withdraw' || scope.kind === 'entry') {
    const consumers = await consumersOfScope(tx, key, scope);
    const named = consumers.length ? consumers.join(', ') : 'another document';
    throw ApiError.conflict(
      `Stock of ${itemName} this document put into ${place} has already been costed to ` +
        `${named}, so its quantity can no longer be changed. Reverse ${named} first.`,
    );
  }

  const where = scope.kind === 'job' ? `against these challans at ${place}` : `at ${place}`;
  throw ApiError.conflict(
    `Only ${available.toString()} of ${itemName} is on the books ${where}, but ` +
      `${qty.toString()} is leaving. Nothing has been posted.`,
  );
}

/** The documents whose outward rows still hold draws on the scope's layers. */
async function consumersOfScope(
  tx: TenantClient,
  key: QueueKey,
  scope: Extract<LayerScope, { kind: 'withdraw' | 'entry' }>,
): Promise<string[]> {
  const condition =
    scope.kind === 'entry'
      ? Prisma.sql`l.in_ledger_entry_id = ${scope.entryId}::uuid`
      : scopeCondition(scope);
  const rows = await tx.$queryRaw<{ sourceDocType: string; sourceDocId: string | null }[]>`
    SELECT DISTINCT o.source_doc_type AS "sourceDocType", o.source_doc_id AS "sourceDocId"
    FROM stock_cost_layers l
    LEFT JOIN stock_ledger e ON e.id = l.in_ledger_entry_id
    JOIN stock_layer_draws d ON d.layer_id = l.id AND d.reversed_at IS NULL
    JOIN stock_ledger o ON o.id = d.out_ledger_entry_id
    WHERE l.organization_id = ${key.organizationId}::uuid
      AND l.item_id = ${key.itemId}::uuid
      AND l.location_id = ${key.locationId}::uuid
      AND ${condition}
    LIMIT 5`;
  return describeDocuments(
    tx,
    key.organizationId,
    rows.map((row) => ({ type: row.sourceDocType, id: row.sourceDocId })),
  );
}

/**
 * The OTHER documents that have drawn on the layers these inward rows created —
 * empty means that stock is untouched by anyone but the document itself (its own
 * earlier corrections do not count). Named, for the refusal message.
 */
export async function consumersOfEntries(
  tx: TenantClient,
  organizationId: string,
  entryIds: readonly string[],
  self: { sourceDocType: string; sourceDocId: string },
): Promise<string[]> {
  if (entryIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ sourceDocType: string; sourceDocId: string | null }[]>`
    SELECT DISTINCT o.source_doc_type AS "sourceDocType", o.source_doc_id AS "sourceDocId"
    FROM stock_cost_layers l
    JOIN stock_layer_draws d ON d.layer_id = l.id AND d.reversed_at IS NULL
    JOIN stock_ledger o ON o.id = d.out_ledger_entry_id
    WHERE l.organization_id = ${organizationId}::uuid
      AND l.in_ledger_entry_id = ANY(${[...entryIds]}::uuid[])
      AND NOT (o.source_doc_type = ${self.sourceDocType}
               AND o.source_doc_id IS NOT DISTINCT FROM ${self.sourceDocId}::uuid)
    LIMIT 5`;
  return describeDocuments(
    tx,
    organizationId,
    rows.map((row) => ({ type: row.sourceDocType, id: row.sourceDocId })),
  );
}

/** "challan JI-00116", "receipt JR-00012" — what a user can find on a screen. */
export async function describeDocuments(
  tx: TenantClient,
  organizationId: string,
  refs: readonly { type: string; id: string | null }[],
): Promise<string[]> {
  const idsOf = (type: string) => [
    ...new Set(refs.filter((ref) => ref.type === type && ref.id).map((ref) => ref.id!)),
  ];
  const label = new Map<string, string>();

  // Error path only, and one table per document type actually named.
  const issueIds = idsOf('job_issue');
  if (issueIds.length) {
    for (const row of await tx.jobIssue.findMany({
      where: { organizationId, id: { in: issueIds } },
      select: { id: true, challanNumber: true },
    })) {
      label.set(row.id, `challan ${row.challanNumber}`);
    }
  }
  const receiptIds = idsOf('job_receipt');
  if (receiptIds.length) {
    for (const row of await tx.jobReceipt.findMany({
      where: { organizationId, id: { in: receiptIds } },
      select: { id: true, receiptNumber: true },
    })) {
      label.set(row.id, `receipt ${row.receiptNumber}`);
    }
  }
  const billIds = idsOf('bill');
  if (billIds.length) {
    for (const row of await tx.bill.findMany({
      where: { organizationId, id: { in: billIds } },
      select: { id: true, billNumber: true },
    })) {
      label.set(row.id, `bill ${row.billNumber}`);
    }
  }
  const assemblyIds = idsOf('item_assembly');
  if (assemblyIds.length) {
    for (const row of await tx.itemAssembly.findMany({
      where: { organizationId, id: { in: assemblyIds } },
      select: { id: true, assemblyNumber: true },
    })) {
      label.set(row.id, `assembly ${row.assemblyNumber}`);
    }
  }
  const stepIds = idsOf('job_order_step');
  if (stepIds.length) {
    for (const row of await tx.jobOrderStep.findMany({
      where: { organizationId, id: { in: stepIds } },
      select: { id: true, jobOrder: { select: { jobOrderNumber: true } } },
    })) {
      label.set(row.id, `the write-off on job order ${row.jobOrder.jobOrderNumber}`);
    }
  }

  return [
    ...new Set(
      refs.map((ref) =>
        ref.type === 'item_opening_stock'
          ? 'opening stock'
          : ((ref.id && label.get(ref.id)) ?? ref.type.replaceAll('_', ' ')),
      ),
    ),
  ];
}

export interface OpenLayer {
  qty: Prisma.Decimal;
  value: Prisma.Decimal;
  inDate: Date;
}

/**
 * What each challan line still holds at its processor, as cost layers in the order
 * a receipt consumes them — ONE query for every line, plus one for the legacy
 * fallback when some line has no tagged layers (stock issued before FIFO).
 *
 * The receipt's bulk walk orders lines by their first layer's date, and the Receive
 * screen's cost preview walks exactly these layers, so the preview is the posting.
 */
export async function openLayersByIssueLine(
  tx: TenantClient,
  organizationId: string,
  lines: readonly { id: string; batchId: string; locationId: string }[],
): Promise<Map<string, OpenLayer[]>> {
  const byLine = new Map<string, OpenLayer[]>();
  if (lines.length === 0) return byLine;

  const tagged = await tx.stockCostLayer.findMany({
    where: {
      organizationId,
      sourceDocLineId: { in: lines.map((line) => line.id) },
      remainingQty: { gt: 0 },
    },
    orderBy: [{ inDate: 'asc' }, { inSeq: 'asc' }],
    select: { sourceDocLineId: true, remainingQty: true, remainingValue: true, inDate: true },
  });
  for (const layer of tagged) {
    const list = byLine.get(layer.sourceDocLineId!) ?? [];
    list.push({ qty: layer.remainingQty, value: layer.remainingValue, inDate: layer.inDate });
    byLine.set(layer.sourceDocLineId!, list);
  }

  const untagged = lines.filter((line) => !byLine.has(line.id));
  if (untagged.length === 0) return byLine;
  const legacy = await tx.stockCostLayer.findMany({
    where: {
      organizationId,
      isLegacy: true,
      sourceDocLineId: null,
      remainingQty: { gt: 0 },
      batchId: { in: [...new Set(untagged.map((line) => line.batchId))] },
      locationId: { in: [...new Set(untagged.map((line) => line.locationId))] },
    },
    orderBy: [{ inDate: 'asc' }, { inSeq: 'asc' }],
    select: {
      batchId: true,
      locationId: true,
      remainingQty: true,
      remainingValue: true,
      inDate: true,
    },
  });
  for (const line of untagged) {
    const list = legacy
      .filter((layer) => layer.batchId === line.batchId && layer.locationId === line.locationId)
      .map((layer) => ({
        qty: layer.remainingQty,
        value: layer.remainingValue,
        inDate: layer.inDate,
      }));
    if (list.length) byLine.set(line.id, list);
  }
  return byLine;
}

/**
 * Oldest stock first: challan lines ordered by their first open layer's date.
 * Stable — ties, and lines with no open layer (which sort last), keep the order
 * they came in, which is the challan's own oldest-first order.
 */
export function fifoLineOrder<T>(
  entries: readonly T[],
  layersOf: (entry: T) => readonly OpenLayer[] | undefined,
): T[] {
  const firstDate = (entry: T) => layersOf(entry)?.[0]?.inDate.getTime() ?? Infinity;
  return entries
    .map((entry, index) => ({ entry, index, at: firstDate(entry) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1))
    .map(({ entry }) => entry);
}

export interface CutoverPlan {
  /** Positions that block the cut-over: negative, or value with no quantity. */
  problems: {
    itemId: string;
    batchId: string;
    locationId: string;
    qty: Prisma.Decimal;
    value: Prisma.Decimal;
  }[];
  /** One legacy layer per (batch, location) with stock, for item-locations with none yet. */
  layers: NewLayer[];
  /** Item-locations that already had layers and were left alone. */
  alreadyCovered: number;
}

/**
 * The FIFO cut-over (plan D4) for one organization: a legacy layer per (batch,
 * location) of own stock, at its current quantity and value, dated at the batch's
 * first inward `posted_at`. Used by `scripts/fifo-cutover.ts`; writes nothing.
 */
export async function planLegacyLayers(
  tx: TenantClient,
  organizationId: string,
): Promise<CutoverPlan> {
  const positions = await tx.$queryRaw<
    {
      itemId: string;
      batchId: string;
      locationId: string;
      qty: Prisma.Decimal;
      value: Prisma.Decimal;
      firstIn: Date | null;
    }[]
  >`
    SELECT l.item_id AS "itemId", l.batch_id AS "batchId", l.location_id AS "locationId",
           SUM(l.qty_in - l.qty_out) AS qty,
           SUM(l.value_in - l.value_out) AS value,
           (SELECT MIN(f.posted_at) FROM stock_ledger f
             WHERE f.batch_id = l.batch_id AND f.qty_in > 0 AND f.movement_type <> 'reversal') AS "firstIn"
    FROM stock_ledger l
    WHERE l.organization_id = ${organizationId}::uuid
      AND l.ownership = 'own' AND l.stock_effect IN ('both', 'accounting')
    GROUP BY l.item_id, l.batch_id, l.location_id`;

  const covered = new Set(
    (
      await tx.stockCostLayer.groupBy({
        by: ['itemId', 'locationId'],
        where: { organizationId },
      })
    ).map((row) => `${row.itemId}@${row.locationId}`),
  );

  return {
    problems: positions
      .filter((p) => p.qty.isNegative() || (p.qty.isZero() && !p.value.isZero()))
      .map(({ firstIn: _firstIn, ...p }) => p),
    layers: positions
      .filter((p) => p.qty.greaterThan(0) && !covered.has(`${p.itemId}@${p.locationId}`))
      .map((p) => ({
        itemId: p.itemId,
        locationId: p.locationId,
        batchId: p.batchId,
        inLedgerEntryId: null,
        isLegacy: true,
        inDate: p.firstIn ?? new Date(0),
        qty: p.qty,
        value: p.value,
      })),
    alreadyCovered: covered.size,
  };
}

export interface LayerMismatch {
  itemId: string;
  locationId: string;
  ledgerQty: Prisma.Decimal;
  layerQty: Prisma.Decimal;
  ledgerValue: Prisma.Decimal;
  layerValue: Prisma.Decimal;
}

/**
 * 🔴 THE INVARIANT, as a query: per (item, location), own stock on the accounting
 * axis, the layers' remaining quantity and value equal the ledger's balance.
 * Empty means they tie. Used by tests and by the cut-over script.
 */
export async function checkLayerInvariant(
  tx: TenantClient,
  organizationId: string,
  filter: { itemId?: string } = {},
): Promise<LayerMismatch[]> {
  const itemLedger = filter.itemId
    ? Prisma.sql`AND item_id = ${filter.itemId}::uuid`
    : Prisma.empty;
  const rows = await tx.$queryRaw<
    {
      itemId: string;
      locationId: string;
      ledgerQty: Prisma.Decimal;
      layerQty: Prisma.Decimal;
      ledgerValue: Prisma.Decimal;
      layerValue: Prisma.Decimal;
    }[]
  >`
    WITH ledger AS (
      SELECT item_id, location_id,
             SUM(qty_in - qty_out) AS qty, SUM(value_in - value_out) AS value
      FROM stock_ledger
      WHERE organization_id = ${organizationId}::uuid
        AND ownership = 'own' AND stock_effect IN ('both', 'accounting') ${itemLedger}
      GROUP BY item_id, location_id
    ), layers AS (
      SELECT item_id, location_id,
             SUM(remaining_qty) AS qty, SUM(remaining_value) AS value
      FROM stock_cost_layers
      WHERE organization_id = ${organizationId}::uuid ${itemLedger}
      GROUP BY item_id, location_id
    )
    SELECT COALESCE(g.item_id, c.item_id) AS "itemId",
           COALESCE(g.location_id, c.location_id) AS "locationId",
           COALESCE(g.qty, 0) AS "ledgerQty", COALESCE(c.qty, 0) AS "layerQty",
           COALESCE(g.value, 0) AS "ledgerValue", COALESCE(c.value, 0) AS "layerValue"
    FROM ledger g
    FULL JOIN layers c ON c.item_id = g.item_id AND c.location_id = g.location_id
    WHERE COALESCE(g.qty, 0) <> COALESCE(c.qty, 0)
       OR COALESCE(g.value, 0) <> COALESCE(c.value, 0)`;

  return rows.map((row) => ({
    itemId: row.itemId,
    locationId: row.locationId,
    ledgerQty: new Prisma.Decimal(row.ledgerQty),
    layerQty: new Prisma.Decimal(row.layerQty),
    ledgerValue: new Prisma.Decimal(row.ledgerValue),
    layerValue: new Prisma.Decimal(row.layerValue),
  }));
}
