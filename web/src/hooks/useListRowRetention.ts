import { useEffect } from 'react';
import { replaceEqualDeep, useQueryClient, type QueryClient } from '@tanstack/react-query';

/**
 * 🔴 A ROW THE USER JUST CHANGED STAYS IN THE LIST THEY CHANGED IT FROM.
 *
 * Most list presets filter on `status` (Open Job Orders, Active Vendors, Drafts…),
 * so any refetch after a status change DELETES the row from the view the user is
 * acting in — Mark as Completed and the order vanishes from "Open Job Orders",
 * which reads as it having been removed. Patching the cache alone is not enough:
 * the next focus refetch (`refetchOnWindowFocus` once `staleTime` has passed) or
 * any invalidation brings the server's filtered page back without it.
 *
 * So a patched row is RETAINED: every refetch of that list merges it back in at
 * the position it had, carrying its patched status. It leaves only when the view
 * itself changes — another filter, search, page or page size — when the list
 * unmounts, or on a page reload (this state is module memory, never persisted).
 */
const retained = new Map<string, Set<string>>();

type Row = { id: string };
type Page = { results: Row[] };

const rootOf = (listKey: readonly unknown[]) => String(listKey[0]);

const isPage = (data: unknown): data is Page =>
  typeof data === 'object' && data !== null && Array.isArray((data as Page).results);

/**
 * Patch one row in every open copy of a list and keep it on screen until the
 * view changes. `listKey` is the list's key prefix, e.g. `['job-orders', orgId]`.
 * Handles both shapes that live under a list key: the paginated page and a plain
 * array (the unfiltered per-step reads under `job-issues` / `job-receipts`).
 */
export function patchListRow<T extends Row>(
  queryClient: QueryClient,
  listKey: readonly unknown[],
  id: string,
  patch: Partial<T>,
) {
  const swap = (rows: T[]) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row));

  const root = rootOf(listKey);
  if (!retained.has(root)) retained.set(root, new Set());
  retained.get(root)!.add(id);

  queryClient.setQueriesData(
    { queryKey: listKey, type: 'active' },
    (old: { results: T[] } | T[] | undefined) => {
      if (!old) return old;
      if (Array.isArray(old)) return swap(old);
      if (!old.results) return old;
      return { ...old, results: swap(old.results) };
    },
  );
  // Pages nobody is looking at are refetched instead — nothing is on screen for
  // the row to disappear from, and they must be right when next opened.
  queryClient.invalidateQueries({ queryKey: listKey, type: 'inactive' });
}

/** A deleted row must not be merged back in. Call from every delete's onSuccess. */
export function releaseListRow(listKey: readonly unknown[], id: string) {
  retained.get(rootOf(listKey))?.delete(id);
}

/**
 * `structuralSharing` for a list query: a refetch that no longer returns a
 * retained row gets it back at its old index. Same-view only — React Query calls
 * this with the previous data of the SAME query key.
 */
function mergeRetained(root: string) {
  return (oldData: unknown, newData: unknown): unknown => {
    const ids = retained.get(root);
    if (ids?.size && isPage(oldData) && isPage(newData)) {
      const present = new Set(newData.results.map((row) => row.id));
      const results = [...newData.results];
      oldData.results.forEach((row, index) => {
        if (ids.has(row.id) && !present.has(row.id)) {
          results.splice(Math.min(index, results.length), 0, row);
        }
      });
      if (results.length !== newData.results.length) newData = { ...newData, results };
    }
    return replaceEqualDeep(oldData, newData);
  };
}

/**
 * Wire a list page into retention. `viewToken` is everything that makes a
 * different result set (search, filter, page, page size): when it changes, or the
 * list unmounts, the retained rows are let go and the list's cached pages marked
 * stale, so coming back to that view shows what the server says.
 *
 * Returns the `structuralSharing` option for the list's `useQuery`.
 */
export function useListRowRetention(listKey: readonly unknown[], viewToken: string) {
  const queryClient = useQueryClient();
  const root = rootOf(listKey);
  const keyHash = JSON.stringify(listKey);

  useEffect(() => {
    // A row patched while this list was not on screen (a challan cancelled from
    // the job order page) has no place in the view being opened.
    retained.delete(root);
    return () => {
      if (!retained.get(root)?.size) return;
      retained.delete(root);
      queryClient.invalidateQueries({
        queryKey: JSON.parse(keyHash) as unknown[],
        refetchType: 'none',
      });
    };
  }, [queryClient, root, keyHash, viewToken]);

  return mergeRetained(root);
}
