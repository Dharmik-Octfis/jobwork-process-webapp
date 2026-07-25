import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from '../lib/pagination';

/**
 * List-page search + filter + page-size + pagination state, in one place.
 *
 * The search term (`?search=`, written by the top-bar GlobalSearch box), the
 * preset view (`?filter=`) and the page size (`?perPage=`) all live in the URL —
 * bookmarkable, shareable, and they survive a refresh. The page cursor resets
 * whenever any of them changes, since each produces a different result set.
 */
export function useListSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const filter = searchParams.get('filter') ?? 'all';

  // Only honour a page size we actually offer — a hand-edited `?perPage=9999`
  // falls back to the default rather than being sent to the server.
  const rawPerPage = Number(searchParams.get('perPage'));
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPerPage)
    ? rawPerPage
    : DEFAULT_PER_PAGE;

  const [page, setPage] = useState(1);

  // A new term / view / page size is a new result set — back to page 1. Adjusting
  // state during render (guarded by the previous value) is React's recommended
  // pattern for "reset when a value changes" — no effect, so no setState-in-effect.
  const resetToken = `${search}|${filter}|${perPage}`;
  const [prevToken, setPrevToken] = useState(resetToken);
  if (resetToken !== prevToken) {
    setPrevToken(resetToken);
    setPage(1);
  }

  const setParam = (key: string, value: string | null) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value) params.set(key, value);
        else params.delete(key);
        // Opening a record is a separate concern; changing the view clears it.
        params.delete('id');
        return params;
      },
      { replace: true },
    );
  };

  /** Switch preset view. `all` is the default, so it is dropped from the URL. */
  const setFilter = (next: string) => setParam('filter', next && next !== 'all' ? next : null);

  /** Change page size. The default is dropped from the URL. */
  const setPerPage = (next: number) =>
    setParam('perPage', next === DEFAULT_PER_PAGE ? null : String(next));

  return { search, filter, setFilter, perPage, setPerPage, page, setPage };
}
