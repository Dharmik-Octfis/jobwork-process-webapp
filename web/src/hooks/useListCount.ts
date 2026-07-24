import { useQuery } from '@tanstack/react-query';

/**
 * The list's total row count, fetched ONLY when asked for — the "Total count:
 * view" link.
 *
 * A list request deliberately doesn't return a total, because `COUNT(*)` over a
 * filtered set is the most expensive part of the page and most of the time nobody
 * reads the number. `enabled: false` keeps the query dormant until `request()`
 * refetches it.
 *
 * Because the key includes search/filter, changing either gives a fresh key whose
 * data is undefined — so a stale count can never be shown next to a different
 * result set; the user simply clicks "view" again.
 */
export function useListCount(queryKey: unknown[], fetcher: () => Promise<number>) {
  const { data, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: fetcher,
    enabled: false,
  });

  /** Returns the total so a caller can act on it, not just display it. */
  const request = async (): Promise<number> => {
    const result = await refetch();
    return result.data ?? 0;
  };

  return { total: data, isCounting: isFetching, request };
}
