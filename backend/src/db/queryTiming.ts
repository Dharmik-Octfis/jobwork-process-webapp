import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request database tally, so one API request can report how much of its time
 * went to Postgres and how much stayed in this process.
 *
 * Its own module because `db/prisma.ts` writes to it and
 * `middlewares/requestTiming.ts` reads it — importing either from the other
 * would be a cycle.
 *
 * `AsyncLocalStorage` rather than a counter on `req`: the queries are issued
 * deep inside service code that never sees the request object, and the store
 * follows the async context automatically — including across `await`s inside a
 * `runAsTenant` transaction.
 */
export type DbOp = { op: string; ms: number };
export type DbTally = {
  ms: number;
  queries: number;
  /** Worst single operation, for the one-line summary. Always accurate. */
  slowest: DbOp | null;
  /** Per-operation totals, for the slow-request breakdown. Capped — see below. */
  byOp: Map<string, { count: number; ms: number }>;
};

const tallies = new AsyncLocalStorage<DbTally>();

/**
 * Distinct operation names one request may track. A request issuing more shapes
 * than this is already the finding; the cap exists so a runaway loop cannot grow
 * this map without bound. Repeat calls to the SAME shape are free — they fold
 * into an existing entry, which is what makes an N+1 legible as `×50`.
 */
const MAX_TRACKED_SHAPES = 64;

export function newDbTally(): DbTally {
  return { ms: 0, queries: 0, slowest: null, byOp: new Map() };
}

/** Run `fn` with a fresh tally that `recordDbTime` will accumulate into. */
export function runWithDbTally<T>(tally: DbTally, fn: () => T): T {
  return tallies.run(tally, fn);
}

/**
 * Add one query's duration to the tally of whichever request is in scope.
 *
 * No store means this query belongs to no request — the boot probe, a test, a
 * future cron. Those are simply not counted rather than being an error.
 *
 * 🔴 `op` is what makes the tally diagnostic rather than just a total. This
 * replaced six `console.time('order')`-style pairs in `jobOrders.service.ts`:
 * those labels are process-GLOBAL, so with two concurrent overview requests one
 * request's `timeEnd` closed the other's timer and printed the gap between two
 * unrelated moments. The 2026-09-11 logs caught it — `allTotalsMap: 18.401s`
 * next to a `Warning: Label 'allTotalsMap' already exists for console.time()`.
 * A tally in `AsyncLocalStorage` cannot collide across requests by construction.
 */
export function recordDbTime(ms: number, op = 'unknown'): void {
  const tally = tallies.getStore();
  if (!tally) return;
  tally.ms += ms;
  tally.queries += 1;

  if (!tally.slowest || ms > tally.slowest.ms) tally.slowest = { op, ms };

  const existing = tally.byOp.get(op);
  if (existing) {
    existing.count += 1;
    existing.ms += ms;
  } else if (tally.byOp.size < MAX_TRACKED_SHAPES) {
    tally.byOp.set(op, { count: 1, ms });
  }
}
