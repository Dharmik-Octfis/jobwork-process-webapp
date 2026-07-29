import { prisma, poolStats, runAsTenant, timeFreshConnection } from '../../db/prisma.ts';
import { cacheDelete, cacheGet, cacheSet, cacheEnabled } from '../../lib/catalystCache.ts';

/**
 * Latency probe for the AppSail → RDS path.
 *
 * WHY THIS EXISTS
 * The app runs on Zoho Catalyst AppSail and Postgres is Amazon RDS in
 * `ap-south-1` — different clouds, so every query leaves Zoho's network. How
 * *much* that costs decides the entire optimisation strategy, and the two
 * possibilities call for opposite work:
 *
 *   - ~200-300ms per round trip → distance is the problem. Cut the number of
 *     trips (a `runAsTenant` costs four) and cache aggressively.
 *   - ~5-20ms per round trip → distance is NOT the problem, and caching buys
 *     almost nothing. A slow request is then cold instance start or connection
 *     setup, and the fix is pooling and warm-up.
 *
 * Guessing between those two wastes weeks. This endpoint measures it from
 * inside AppSail, which is the only place the number is real — latency from a
 * developer's laptop to RDS says nothing about the path that actually matters.
 *
 * 🔴 **Reads nothing but `SELECT 1`.** No tenant table is touched, so this can
 * never expose customer data, and it needs no organization or membership.
 */

/** How many times each probe runs. Enough for a stable `min` without stalling. */
const SAMPLES = 8;

/**
 * A tenant id for `runAsTenant` that belongs to nobody.
 *
 * `set_config('app.current_tenant', ...)` just sets a string — the probe query
 * is `SELECT 1`, which touches no RLS-protected table, so the value is never
 * compared against anything. A syntactically valid UUID that matches no real
 * organization makes it structurally impossible for this probe to read tenant
 * data even if someone later edits the query.
 */
const NOBODY = '00000000-0000-0000-0000-000000000000';

export interface Stat {
  minMs: number;
  medianMs: number;
  maxMs: number;
  samples: number;
}

/**
 * `min` is the number to trust, and the reason is worth stating: every sample
 * is one true round trip plus whatever noise it happened to collect (GC, a busy
 * event loop, a scheduler hiccup). Noise only ever *adds*, so the fastest
 * sample is the closest estimate of the floor. A median far above the min means
 * the path is jittery; a max far above both usually means GC or CPU contention,
 * not the network.
 */
function summarise(samplesMs: number[]): Stat {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    minMs: round(sorted[0]!),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]!),
    maxMs: round(sorted[sorted.length - 1]!),
    samples: sorted.length,
  };
}

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await fn();
  return performance.now() - startedAt;
}

async function sample(fn: () => Promise<unknown>, times = SAMPLES): Promise<Stat> {
  const results: number[] = [];
  for (let i = 0; i < times; i += 1) {
    // Sequential on purpose. Run in parallel and they queue on the pool's five
    // connections, so you would be timing contention rather than the network.
    results.push(await timeIt(fn));
  }
  return summarise(results);
}

export interface DiagnosticsReport {
  instance: {
    uptimeSeconds: number;
    nodeVersion: string;
    /** Distinguishes samples taken from different AppSail instances. */
    pid: number;
  };
  /**
   * Pool state sampled BEFORE this probe touches the database — i.e. what the
   * idle gap since the last request actually left behind.
   *
   * This is the field that answers "are we re-opening connections?", and it has
   * to be read first: every other number here is taken after a warm-up query, by
   * which point a connection trivially exists. Leave the app idle for a minute,
   * call this, and read `total`:
   *   total >= 1 → the connection survived; the pool is doing its job
   *   total == 0 → every request after an idle gap pays a fresh connect (~1.9s
   *                from AppSail), which is what `idleTimeoutMillis: 0` prevents
   */
  poolBeforeWarmup: ReturnType<typeof poolStats>;
  pool: ReturnType<typeof poolStats>;
  timings: {
    /** One `SELECT 1` on a pooled connection ≈ exactly one round trip. */
    bareSelect: Stat;
    /** BEGIN + set_config + SELECT 1 + COMMIT ≈ four round trips. */
    runAsTenantEmpty: Stat;
    /** TCP + TLS + SCRAM auth. What the pool exists to avoid paying. */
    freshConnectionMs: number | null;
    /** Catalyst Cache put/get/delete, or null when L2 is not configured. */
    catalystCache: { putMs: number; getMs: number; deleteMs: number } | null;
  };
  derived: {
    estimatedRoundTripMs: number;
    /** Trips 2-4 of a `runAsTenant`: the protocol tax on every tenant query. */
    runAsTenantOverheadMs: number;
    /** How many round trips the transaction wrapper actually costs. */
    impliedTripsPerTransaction: number;
    verdict: string[];
  };
}

export async function collectDiagnostics(): Promise<DiagnosticsReport> {
  // 🔴 FIRST, before anything touches the database. This is the only moment the
  // pool still reflects the idle gap since the last real request; one query from
  // here on makes `total >= 1` regardless of how it got there.
  const poolBeforeWarmup = poolStats();

  // Warm the pool so the first sample is not paying for a connection the steady
  // state would already have had. `freshConnectionMs` measures that separately
  // and on purpose.
  await prisma.$queryRaw`SELECT 1`;

  const bareSelect = await sample(() => prisma.$queryRaw`SELECT 1`);
  const runAsTenantEmpty = await sample(() => runAsTenant(NOBODY, (tx) => tx.$queryRaw`SELECT 1`));

  let freshConnectionMs: number | null = null;
  try {
    freshConnectionMs = Math.round((await timeFreshConnection()) * 100) / 100;
  } catch {
    // A blocked outbound connection or exhausted RDS connection slots. The rest
    // of the report is still useful, so degrade rather than fail the request —
    // `freshConnectionMs` just stays null from its initialiser above.
  }

  let catalystCache: DiagnosticsReport['timings']['catalystCache'] = null;
  if (cacheEnabled) {
    const key = `diag:latency-probe:${process.pid}`;
    const putMs = await timeIt(() => cacheSet(key, JSON.stringify({ t: 1 }), 1));
    const getMs = await timeIt(() => cacheGet(key));
    const deleteMs = await timeIt(() => cacheDelete(key));
    const round = (n: number) => Math.round(n * 100) / 100;
    catalystCache = { putMs: round(putMs), getMs: round(getMs), deleteMs: round(deleteMs) };
  }

  const rtt = bareSelect.minMs;
  const overhead = Math.round((runAsTenantEmpty.minMs - rtt) * 100) / 100;

  return {
    instance: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
    },
    poolBeforeWarmup,
    pool: poolStats(),
    timings: { bareSelect, runAsTenantEmpty, freshConnectionMs, catalystCache },
    derived: {
      estimatedRoundTripMs: rtt,
      runAsTenantOverheadMs: overhead,
      impliedTripsPerTransaction:
        rtt > 0 ? Math.round((runAsTenantEmpty.minMs / rtt) * 10) / 10 : 0,
      verdict: buildVerdict({
        rtt,
        runAsTenantEmpty,
        freshConnectionMs,
        catalystCache,
        poolBeforeWarmup,
        uptimeSeconds: process.uptime(),
      }),
    },
  };
}

/**
 * Turn the numbers into the conclusion they actually support.
 *
 * This is the part that stops the report being another thing to interpret by
 * eye. The thresholds are coarse on purpose — the decision it feeds ("cut round
 * trips" vs "fix connection reuse") does not turn on 10ms.
 */
function buildVerdict(input: {
  rtt: number;
  runAsTenantEmpty: Stat;
  freshConnectionMs: number | null;
  catalystCache: DiagnosticsReport['timings']['catalystCache'];
  poolBeforeWarmup: ReturnType<typeof poolStats>;
  uptimeSeconds: number;
}): string[] {
  const { rtt, runAsTenantEmpty, freshConnectionMs, catalystCache, poolBeforeWarmup } = input;
  const out: string[] = [];

  // Only meaningful once the process has been up long enough for pg's default
  // 10s idle reaper to have fired at least once — before that, an empty pool
  // says nothing.
  if (input.uptimeSeconds > 30) {
    if (poolBeforeWarmup.total === 0) {
      out.push(
        'Pool was EMPTY before this request: connections are not surviving idle gaps, so requests after a quiet period pay a full connect. Set idleTimeoutMillis (pg closes idle connections after 10s by default) and keepAlive.',
      );
    } else {
      out.push(
        `Pool held ${poolBeforeWarmup.total} connection(s) before this request — connections ARE surviving idle gaps, so requests are not paying to reconnect.`,
      );
    }
  }

  if (poolBeforeWarmup.waiting > 0) {
    out.push(
      `${poolBeforeWarmup.waiting} request(s) were queued waiting for a connection — max=${poolBeforeWarmup.max} is a bottleneck under this load.`,
    );
  }

  if (rtt >= 100) {
    out.push(
      `Round trip is ${rtt}ms — the database is genuinely far away. Distance IS the problem: cut the number of trips (a runAsTenant costs ~${runAsTenantEmpty.minMs}ms) and cache hot reads.`,
    );
  } else if (rtt >= 30) {
    out.push(
      `Round trip is ${rtt}ms — moderate. Round-trip count matters, but it cannot alone explain a multi-second response.`,
    );
  } else {
    out.push(
      `Round trip is ${rtt}ms — the database is NOT far away. Distance is not your problem, and caching will buy far less than expected. Look at cold starts and connection reuse.`,
    );
  }

  if (freshConnectionMs !== null) {
    const ratio = rtt > 0 ? freshConnectionMs / rtt : 0;
    if (freshConnectionMs >= 300 || ratio >= 10) {
      out.push(
        `Opening a NEW connection costs ${freshConnectionMs}ms (${Math.round(ratio)}x one round trip). If the pool is dropping idle connections, requests pay this repeatedly — set idleTimeoutMillis and keepAlive on the pg Pool.`,
      );
    } else {
      out.push(`Opening a new connection costs ${freshConnectionMs}ms — not a major factor.`);
    }
  }

  if (catalystCache) {
    const worst = Math.max(catalystCache.getMs, catalystCache.putMs);
    if (catalystCache.getMs < rtt) {
      out.push(
        `Catalyst Cache get is ${catalystCache.getMs}ms vs ${rtt}ms for one database round trip — L2 is worth using for hot reads.`,
      );
    } else {
      out.push(
        `Catalyst Cache get is ${catalystCache.getMs}ms, which is NOT faster than one database round trip (${rtt}ms). L2 would add latency here; prefer the in-process L1 cache.`,
      );
    }
    if (worst >= 100) {
      out.push(`Catalyst Cache is slow in absolute terms (${worst}ms worst of put/get).`);
    }
  } else {
    out.push(
      'Catalyst Cache is not configured (ZC_CACHE_SEGMENT_ID unset), so L2 was not measured.',
    );
  }

  return out;
}
