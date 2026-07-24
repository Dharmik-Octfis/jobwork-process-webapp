import { z } from 'zod';

/**
 * Shared client-side shape for paginated + searchable list endpoints, mirroring
 * `backend/src/lib/pagination.ts`. One page-context schema and one wrapper factory
 * so each module doesn't re-type them. See memory: list-search-pagination-pattern.
 */
/**
 * No `total` — counting is opt-in (the "Total count: view" link hits each
 * module's `/count`), so a list request never pays for a COUNT(*). `hasMore`
 * comes from the server fetching one row beyond the page.
 */
export const pageContextSchema = z.object({
  page: z.number(),
  perPage: z.number(),
  hasMore: z.boolean(),
});

/** Page sizes offered by the pagination bar. Mirrors the backend `perPage` cap. */
export const PER_PAGE_OPTIONS = [10, 25, 50, 100, 500] as const;
export const DEFAULT_PER_PAGE = 25;
export type PageContext = z.infer<typeof pageContextSchema>;

/** Wrap a row schema into the list payload `{ results, pageContext }`. */
export function paginatedSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({ results: z.array(row), pageContext: pageContextSchema });
}

export type Paginated<T> = { results: T[]; pageContext: PageContext };

/** Query params a list fetcher accepts. */
export interface PageParams {
  search?: string;
  /** Preset view key ("active", "goods", …). Omitted means "all". */
  filter?: string;
  page?: number;
  perPage?: number;
}
