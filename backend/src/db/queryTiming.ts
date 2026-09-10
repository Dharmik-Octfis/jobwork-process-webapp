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
export type DbTally = { ms: number; queries: number };

const tallies = new AsyncLocalStorage<DbTally>();

/** Run `fn` with a fresh tally that `recordDbTime` will accumulate into. */
export function runWithDbTally<T>(tally: DbTally, fn: () => T): T {
  return tallies.run(tally, fn);
}

/**
 * Add one query's duration to the tally of whichever request is in scope.
 *
 * No store means this query belongs to no request — the boot probe, a test, a
 * future cron. Those are simply not counted rather than being an error.
 */
export function recordDbTime(ms: number): void {
  const tally = tallies.getStore();
  if (!tally) return;
  tally.ms += ms;
  tally.queries += 1;
}
