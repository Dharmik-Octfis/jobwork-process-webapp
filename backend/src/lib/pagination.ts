import { z } from 'zod';

/**
 * Shared contract for paginated + searchable list endpoints (vendors, customers,
 * items, …). Pulling the identical, tenant-critical bits into one place means a
 * new module can't copy them wrong: the `perPage` cap, the `search` bounds, the
 * `OR`-of-`contains` shape, and the `pageContext` math live here, not re-typed per
 * module. Each service still owns its own `tx.<model>.count/findMany` (Prisma's
 * typed delegates don't generalise cleanly). See memory: list-search-pagination-pattern.
 *
 * Query params for the list. `page`/`perPage` arrive as strings on the URL, so
 * they're coerced; `perPage` is capped so a client can't ask for an unbounded
 * page. Parse this in the controller (not a `validateBody`-style middleware) —
 * Express 5's `req.query` is a read-only getter.
 */
export const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  /** Preset view key — see listFilters.catalog.ts. Omitted means "all". */
  filter: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().positive().default(1),
  // Cap mirrors the client's largest page-size option (500). It exists so a
  // hand-edited URL can't ask for the whole table in one query.
  perPage: z.coerce.number().int().positive().max(500).default(25),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * NOTE: no `total`. Counting is deliberately NOT part of a list request — on a
 * large tenant `COUNT(*)` over a filtered set is the most expensive part of the
 * page, and it is only needed when someone actually wants the number. The client
 * asks for it explicitly via each module's `/count` route (the "Total count: view"
 * link). `hasMore` is derived instead by asking for one row more than the page.
 */
export interface PageContext {
  page: number;
  perPage: number;
  hasMore: boolean;
}

/**
 * A case-insensitive `contains` OR across `columns` — or `{}` when there's no
 * term. Spread into a Prisma `where` beside `organizationId`/`isDeleted`.
 *
 * `columns` is typed `keyof TWhere`, so a removed or misspelt column is a compile
 * error at the call site — that's the whole point of centralising this.
 */
export function searchWhere<TWhere>(
  search: string | undefined,
  columns: readonly (keyof TWhere & string)[],
): TWhere {
  if (!search) return {} as TWhere;
  return {
    OR: columns.map((c) => ({ [c]: { contains: search, mode: 'insensitive' } })),
  } as TWhere;
}

/**
 * How many rows to actually fetch for a page: one more than asked. The extra row
 * is never returned — its presence is what tells us another page exists, which is
 * why the list needs no COUNT at all.
 */
export function takeForPage(perPage: number): number {
  return perPage + 1;
}

/** Split the `perPage + 1` rows into the page and its `hasMore` flag. */
export function pageSlice<T>(
  rows: T[],
  page: number,
  perPage: number,
): { results: T[]; pageContext: PageContext } {
  const hasMore = rows.length > perPage;
  return {
    results: hasMore ? rows.slice(0, perPage) : rows,
    pageContext: { page, perPage, hasMore },
  };
}
