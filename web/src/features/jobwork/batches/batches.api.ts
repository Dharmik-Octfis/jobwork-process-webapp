import { z } from 'zod';
import { apiClient } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';

/**
 * Batches — read only.
 *
 * 🔴 `fetchAvailableBatches` IS THE PICKER, AND IT IS A LEDGER QUERY. It is not "the
 * batches list filtered". A batch row exists from the moment it is created and goes on
 * existing after the last metre of it has been issued, so a picker built on the
 * `batches` table offers material that has been at the dyer's for a fortnight
 * (field-sources §10). There is no create/update/delete here because a batch is
 * born from the document that physically brought material in, never from a form.
 */

export const availableBatchSchema = z.object({
  batchId: z.string(),
  /**
   * 🔴 A ROW IS A BATCH AT A GODOWN (2026-08-14), not a batch. One challan may
   * draw from every godown in a dispatch site, and the same batch can sit in two
   * of them with two independent balances — so this is sent back on the line and
   * the ledger takes the stock out of exactly here.
   */
  locationId: z.string(),
  /** Null only if the location vanished between the query and the render. */
  locationName: z.string().nullable(),
  /**
   * 🔴 THE LABEL. What is on the physical tag, and since 2026-08-14 the only
   * batch identifier a user ever sees — `batchNumber` is internal and is not
   * rendered anywhere. Required on batch-tracked items, so it is null only for
   * untracked stock, whose batches nobody is meant to be looking at.
   */
  supplierBatchRef: z.string().nullable(),
  /** The maker's own number, which is NOT the supplier's — a trader passes on
   * goods the manufacturer marked differently from the trader's docket. */
  manufacturerBatch: z.string().nullable(),
  /** When the batch came onto the books. On screen because the label is NOT
   * unique — two live rows can both read `jv2`, and this is one of the few things
   * that separates them. */
  createdAt: z.string(),
  /** Read-only on the Add Batches grid. `yyyy-mm-dd`, not an instant — these are
   * `@db.Date` columns and an ISO timestamp renders a day early behind UTC. */
  manufacturedDate: z.string().nullable().default(null),
  expiryDate: z.string().nullable().default(null),
  mrp: z.string().nullable().default(null),
  sellingPrice: z.string().nullable().default(null),
  itemId: z.string(),
  uomId: z.string().nullable(),
  ownership: z.string(),
  ownerPartyId: z.string().nullable(),
  availableQty: z.string(),
  accumulatedValue: z.string(),
  costPerUnit: z.string().nullable(),
  inventoryTracking: z.string(),
});

export type AvailableBatch = z.infer<typeof availableBatchSchema>;

export const stockLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** Set when the location belongs to a vendor — i.e. it is a PROCESSOR’s own
   * place. The Issue dialog uses it to drop the party it is issuing to. */
  vendorId: z.string().nullable().optional(),
  /**
   * 🔴 WHICH OF THE ASKED-FOR ITEMS THIS LOCATION ACTUALLY HOLDS, and how much of
   * each. Only items with a positive balance appear, so the length of this array
   * IS the coverage count the dropdown shows.
   */
  items: z.array(z.object({ itemId: z.string(), availableQty: z.string() })).default([]),
  /** The total across those items. Display-only, and only meaningful for a
   * single-item question — quantities never add up across items (§6.5). */
  availableQty: z.string(),
});

export type StockLocation = z.infer<typeof stockLocationSchema>;

/**
 * `search` and `limit` narrow the ROWS, never the balances behind them — an item
 * with three hundred live batches is normal in a mill and a dialog cannot render
 * them, so the picker types to narrow instead of paging. The server caps at
 * `limit` (200 by default); the picker says so when it hits the ceiling rather
 * than quietly showing a slice as if it were everything.
 */
export async function fetchAvailableBatches(
  orgId: string,
  params: {
    itemId: string;
    locationId?: string;
    ownership?: string;
    withPackages?: boolean;
    search?: string;
    limit?: number;
  },
): Promise<AvailableBatch[]> {
  const response = await apiClient.get(endpoints.inventory.availableBatches(orgId), {
    params: {
      ...params,
      search: params.search?.trim() || undefined,
      withPackages: params.withPackages ? 'true' : undefined,
    },
  });
  return z.array(availableBatchSchema).parse(response.data);
}

/**
 * The same picker query for SEVERAL items at once — the Issue dialog's opening
 * load (2026-09-01).
 *
 * 🔴 Why this exists: the dialog used to call `fetchAvailableBatches` once per
 * input item. Each of those paid a membership read, its own `runAsTenant`
 * transaction and its own pooled connection, so a five-item step held five
 * connections to answer one dialog — and the dev database's ceiling is 79.
 *
 * `limit` is still PER ITEM on the server, so adding items never shrinks any one
 * item's picker. Rows come back FLAT and carry `itemId`; the caller groups them.
 *
 * There is deliberately no `search` here: each item has its own search box, so a
 * search is a one-item question and stays on `fetchAvailableBatches` — which also
 * keeps this cached answer alive while the user types in one row.
 */
export async function fetchAvailableBatchesForItems(
  orgId: string,
  params: { itemIds: string[]; locationId?: string; ownership?: string; limit?: number },
): Promise<AvailableBatch[]> {
  if (params.itemIds.length === 0) return [];
  const response = await apiClient.get(endpoints.inventory.availableBatches(orgId), {
    params: {
      itemIds: params.itemIds.join(','),
      locationId: params.locationId,
      ownership: params.ownership,
      limit: params.limit,
    },
  });
  return z.array(availableBatchSchema).parse(response.data);
}

/**
 * 🔴 Also a ledger query, not a location list: offering a godown that holds none
 * of these items is how users get stuck on the Issue dialog (§5.1).
 *
 * Asks about EVERY item on the challan at once (2026-08-19). It used to ask about
 * the principal item alone and apply that answer to the rest, so an item stocked
 * in a different godown got a picker that was silently empty.
 */
export async function fetchStockLocations(
  orgId: string,
  params: { itemIds: string[]; ownership?: string },
): Promise<StockLocation[]> {
  if (params.itemIds.length === 0) return [];
  const response = await apiClient.get(endpoints.inventory.stockLocations(orgId), {
    params: { itemIds: params.itemIds.join(','), ownership: params.ownership },
  });
  return z.array(stockLocationSchema).parse(response.data);
}
