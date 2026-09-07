import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything on screen that is DERIVED FROM THE STOCK LEDGER, invalidated in one
 * call.
 *
 * 🔴 The jobwork screens each knew about their own two keys and nothing else, so
 * a posted challan left the Item page's Stock Locations tab (`itemOpeningStock`)
 * showing the balance from before it. Nothing was wrong with the number — the
 * server recomputes it off `stock_ledger` every time — but with `staleTime` at 30s
 * a cache nobody invalidated is served without a refetch, and 30s is exactly how
 * long it takes to issue a challan and click back to the item. It shows up worst
 * on the draft flow, which sends you to that tab twice: once to check the draft
 * moved nothing, then again after posting, well inside the window.
 *
 * Keys are matched as PREFIXES, so `['itemOpeningStock', orgId]` covers every
 * item's entry without knowing which items the document touched.
 */
export function invalidateStockQueries(queryClient: QueryClient, orgId: string | undefined) {
  if (!orgId) return;
  const LEDGER_DERIVED = [
    'available-batches', // the Issue / Receive batch pickers
    'stock-locations', // which godowns hold an item, and how much
    'itemOpeningStock', // Item → Stock Locations, and the bill line's stock display
    'itemBatches', // Item → Batches
    'item', // the item header's own figures
    'items', // the list's stock column
  ];
  for (const key of LEDGER_DERIVED) {
    queryClient.invalidateQueries({ queryKey: [key, orgId] });
  }
}
