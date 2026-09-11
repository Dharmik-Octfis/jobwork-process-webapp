import type { ItemOpeningStockLocationRowDto } from './items.schemas';

/**
 * 🔴 TWO DIFFERENT NUMBERS live on every opening-stock row, and screens kept reading
 * one for the other — the order below was flipped three times between 2026-08-12
 * and 2026-09-11, each flip fixing one label by breaking the rest.
 *
 *   · `stockOnHand` — the LIVE ledger balance. Moves with every bill, issue,
 *     receipt and assembly. This is "Stock on Hand" wherever it is shown.
 *   · `openingStock` — the figure DECLARED at go-live. Never moves. This is
 *     "Opening Stock" and nothing else.
 *
 * Read through these two helpers rather than inline, so a screen cannot show the
 * declared figure under a "Stock on Hand" heading again.
 */

/** Live stock at this location. Nullish checks, not truthiness: a location
 * drained to 0 must read 0, not fall back to what it opened with. */
export function stockOnHandOf(row: ItemOpeningStockLocationRowDto): number {
  const batchTotal = (row.batches ?? []).reduce((acc, b) => acc + (Number(b.quantityIn) || 0), 0);
  return Number(row.stockOnHand ?? row.openingStock ?? batchTotal) || 0;
}

/** What can actually be issued from this location: on hand, less opening stock not
 * yet assigned to a batch (the server leaves that out of `availableForSale`), less
 * what is committed. */
export function availableOf(row: ItemOpeningStockLocationRowDto): number {
  const committed = Number(row.committedStock ?? 0) || 0;
  const issuable = Number(row.availableForSale ?? stockOnHandOf(row)) || 0;
  return issuable - committed;
}

/** The opening figure declared for this location; 0 where none was declared (a
 * location the item only reached through a document). */
export function declaredOpeningOf(row: ItemOpeningStockLocationRowDto): number {
  return Number(row.openingStock ?? 0) || 0;
}
