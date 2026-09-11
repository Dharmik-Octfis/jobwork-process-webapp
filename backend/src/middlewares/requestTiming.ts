import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { poolStats } from '../db/prisma.ts';
import { newDbTally, runWithDbTally, type DbTally } from '../db/queryTiming.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Above this — or on any 5xx — the request logs a second line breaking `db` down
 * per operation.
 *
 * Set above the slowest routinely-healthy request in production (the jobwork
 * list endpoints land near 1s) so a breakdown marks a request out instead of
 * shadowing every line with a second one. 5xx is included unconditionally
 * because the P2028 failures this was built for abort early and can come back
 * *faster* than the threshold.
 */
const SLOW_REQUEST_MS = 1500;

/**
 * `db` per operation shape, worst first: `JobOrder.findFirst ×1 4009ms`.
 *
 * Grouped rather than chronological, because the shape that matters most here is
 * a repeat count: an N+1 reads as `×50` on one entry instead of scrolling past
 * fifty near-identical entries. One line, not one per operation — Catalyst's log
 * viewer renders every newline as its own row, which is what makes a stack trace
 * there forty rows deep.
 */
function formatBreakdown(tally: DbTally): string {
  return [...tally.byOp.entries()]
    .sort(([, a], [, b]) => b.ms - a.ms)
    .map(([op, { count, ms }]) => `${op} ×${count} ${Math.round(ms)}ms`)
    .join(' · ');
}

/**
 * 🔴 **Some path segments are credentials, and a log line is forever.**
 *
 * `GET /api/invitations/:token` and `POST /api/invitations/:token/accept` carry a
 * `randomBytes(32).toString('base64url')` invite token in the URL, and
 * `invitations.routes.ts` says it plainly: "holding the token is the entire
 * credential". Logging the raw path would put a working invitation accept into
 * every log reader's hands.
 *
 * Resource ids are kept, because a timing line that cannot tell you *which*
 * record was slow is much less useful — and a uuid is an identifier, not a
 * secret. Everything else long enough to be a token is redacted: no real route
 * segment, slug or document number here comes near 24 characters.
 */
function safePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (UUID.test(segment) || segment.length <= 24 ? segment : ':redacted'))
    .join('/');
}

/**
 * One line per API request, to stdout — which is what Catalyst captures.
 *
 *   GET /api/organizations 200 170ms db=11ms/2q app=159ms up=2s rss=221MB busy=12% pool=1/5 idle=1 waiting=0
 *
 * 🔴 **`app` is the number this exists for.** A fixed query shape costs a fixed
 * amount, so time that is NOT `db` is time spent in this process: GC, JIT on a
 * cold instance, or an event loop that cannot get scheduled. On 2026-09-08 that
 * was how `GET /api/modules` — which issues **zero** queries — was caught taking
 * 183ms, and how `app=690ms` against `db=203ms` ruled out query shape as the
 * cause of production slowness.
 *
 * The supporting fields each answer one competing theory:
 *  - `up` — seconds since this process started. A large number on a slow request
 *    means the instance was warm, so a cold start is not the explanation; a tiny
 *    one means it is.
 *  - `waiting` — requests queued for a pooled connection. Non-zero under light
 *    load means the pool is the bottleneck; zero is what disproved pool
 *    contention last time. `total`/`max` show how close the pool came to its cap.
 *  - `db=…/Nq` — operation count alongside the time, so an N+1 is visible as a
 *    statement count rather than inferred from a duration. It counts Prisma
 *    *operations*, not SQL round trips: one `findFirst` carrying a nested
 *    `include` is 1q here and one query per relation on the wire, which is why
 *    `8q` can hide twenty round trips.
 *  - `slow=` — the single worst operation, named. This is what replaced the
 *    `console.time` pairs in `jobOrders.service.ts`, whose process-global labels
 *    collided across concurrent requests and printed nonsense (`allTotalsMap:
 *    18.401s`). Above `SLOW_REQUEST_MS`, or on a 5xx, a second `↳ db` line
 *    breaks the whole tally down per operation.
 *  - `rss` — the process's resident memory when the request finished. AppSail
 *    runs this at 256MB, and the process sits at ~220MB before its first request
 *    (measured 2026-09-11), so a slow request near that ceiling points at GC.
 *  - `busy` — share of this request's wall time the event loop was NOT idle
 *    (Node's event loop utilization). `db` includes time a Postgres reply waited
 *    for the loop, so it cannot tell a slow database from a stalled process on
 *    its own: high `db` with low `busy` is the database; high `busy` is this
 *    process. Utilization rather than a delay sampler because it is attributable
 *    per request even when requests overlap, which is exactly the burst case.
 *
 * Deliberately unconditional: no env flag, no production-only branch. The
 * previous version of this middleware was never committed and the diagnostic was
 * simply gone the next time it was needed. One line per API request is a price
 * worth paying to never be blind again.
 */
export function requestTiming(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  const loopAtStart = performance.eventLoopUtilization();
  const tally = newDbTally();

  // `finish` fires when the last byte is handed to the socket, so it captures
  // the whole handler including serialisation — and it fires exactly once,
  // unlike wrapping `res.end`.
  res.once('finish', () => {
    // 🔴 A diagnostic must never be able to kill the process. This handler runs
    // on an event emitter, outside any request's error path, so anything thrown
    // here is an uncaught exception — which is exactly how a broken `poolStats()`
    // took the server down on 2026-09-10 the first time this was wired up.
    try {
      const total = performance.now() - startedAt;
      const busy = performance.eventLoopUtilization(loopAtStart).utilization;
      const rssMb = process.memoryUsage.rss() / 1_048_576;
      const pool = poolStats();
      // Query string dropped, not just redacted — it is never needed for timing
      // and is where tokens and emails turn up.
      const path = safePath(req.originalUrl.split('?')[0] ?? req.originalUrl);
      const slowest = tally.slowest;
      console.log(
        `${req.method} ${path} ${res.statusCode} ${Math.round(total)}ms ` +
          `db=${Math.round(tally.ms)}ms/${tally.queries}q ` +
          `app=${Math.round(total - tally.ms)}ms ` +
          `up=${Math.round(process.uptime())}s ` +
          `rss=${Math.round(rssMb)}MB busy=${Math.round(busy * 100)}% ` +
          `pool=${pool.total}/${pool.max} idle=${pool.idle} waiting=${pool.waiting}` +
          (slowest ? ` slow=${slowest.op}:${Math.round(slowest.ms)}ms` : ''),
      );

      // Second line, only when it earns its place — see SLOW_REQUEST_MS.
      if (tally.byOp.size > 0 && (total >= SLOW_REQUEST_MS || res.statusCode >= 500)) {
        console.log(`↳ db ${req.method} ${path} ${res.statusCode} — ${formatBreakdown(tally)}`);
      }
    } catch (error) {
      console.error('requestTiming failed (request itself was unaffected):', error);
    }
  });

  runWithDbTally(tally, next);
}
