import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List-page search + pagination state, in one place. Reads the term from the URL
 * (`?search=`, written by the top-bar GlobalSearch box — the box owns the input
 * and the min-length/debounce) and manages the page cursor, resetting to page 1
 * whenever the term changes. Every module's list uses this instead of re-wiring it.
 */
export function useListSearch() {
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const [page, setPage] = useState(1);

  // A new term is a new result set — back to page 1. Adjusting state during render
  // (guarded by the previous value) is React's recommended pattern for "reset when
  // a value changes" — no effect, so no setState-in-effect and no extra paint.
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setPage(1);
  }

  return { search, page, setPage };
}
