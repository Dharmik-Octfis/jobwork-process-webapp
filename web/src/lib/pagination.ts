import { z } from 'zod';

/**
 * Shared client-side shape for paginated + searchable list endpoints, mirroring
 * `backend/src/lib/pagination.ts`. One page-context schema and one wrapper factory
 * so each module doesn't re-type them. See memory: list-search-pagination-pattern.
 */
export const pageContextSchema = z.object({
  page: z.number(),
  perPage: z.number(),
  total: z.number(),
  hasMore: z.boolean(),
});
export type PageContext = z.infer<typeof pageContextSchema>;

/** Wrap a row schema into the list payload `{ results, pageContext }`. */
export function paginatedSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({ results: z.array(row), pageContext: pageContextSchema });
}

export type Paginated<T> = { results: T[]; pageContext: PageContext };

/** Query params a list fetcher accepts. */
export interface PageParams {
  search?: string;
  page?: number;
  perPage?: number;
}
