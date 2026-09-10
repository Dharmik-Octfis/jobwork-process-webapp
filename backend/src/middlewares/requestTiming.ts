import type { NextFunction, Request, Response } from 'express';
import { poolStats } from '../db/prisma.ts';
import { runWithDbTally, type DbTally } from '../db/queryTiming.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *   GET /api/organizations 200 170ms db=11ms/2q app=159ms up=2s pool=1/5 idle=1 waiting=0
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
 *  - `db=…/Nq` — round-trip count alongside the time, so an N+1 is visible as a
 *    statement count rather than inferred from a duration.
 *
 * Deliberately unconditional: no env flag, no production-only branch. The
 * previous version of this middleware was never committed and the diagnostic was
 * simply gone the next time it was needed. One line per API request is a price
 * worth paying to never be blind again.
 */
export function requestTiming(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  const tally: DbTally = { ms: 0, queries: 0 };

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
      const pool = poolStats();
      // Query string dropped, not just redacted — it is never needed for timing
      // and is where tokens and emails turn up.
      const path = safePath(req.originalUrl.split('?')[0] ?? req.originalUrl);
      console.log(
        `${req.method} ${path} ${res.statusCode} ${Math.round(total)}ms ` +
          `db=${Math.round(tally.ms)}ms/${tally.queries}q ` +
          `app=${Math.round(total - tally.ms)}ms ` +
          `up=${Math.round(process.uptime())}s ` +
          `pool=${pool.total}/${pool.max} idle=${pool.idle} waiting=${pool.waiting}`,
      );
    } catch (error) {
      console.error('requestTiming failed (request itself was unaffected):', error);
    }
  });

  runWithDbTally(tally, next);
}
