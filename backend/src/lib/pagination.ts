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
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface PageContext {
  page: number;
  perPage: number;
  total: number;
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

/** Pagination metadata to return beside `results`. */
export function pageContext(page: number, perPage: number, total: number): PageContext {
  return { page, perPage, total, hasMore: page * perPage < total };
}
