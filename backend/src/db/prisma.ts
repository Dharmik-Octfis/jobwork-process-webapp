import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as PgClient, Pool, type PoolConfig } from 'pg';
import { PrismaClient } from '../../generated/prisma/client.ts';
import { env } from '../config/env.ts';

/**
 * Prisma 7 requires a driver adapter — there is no bare-connection-string mode.
 * `@prisma/adapter-pg` wraps a `pg.Pool`, which is what lets us cap connections
 * per instance. AppSail runs many short-lived instances of this app (§6), and
 * each one holding a large pool is how a managed Postgres runs out of
 * connections.
 *
 * `runAsTenant()` (RLS context, §3.10) is defined at the bottom of this file.
 * `users` is deliberately not tenant-scoped: a user row exists before any
 * organization does.
 */

/**
 * `sslmode=require` means different things in different clients. psql encrypts
 * but skips certificate validation; node-postgres validates against Node's
 * trust store, which has no Amazon root CA — so RDS fails with "self-signed
 * certificate in certificate chain".
 *
 * The fix is to supply the CA, not to set `rejectUnauthorized: false`. Turning
 * verification off leaves the connection encrypted but unauthenticated, so
 * anything able to intercept the route can impersonate the database.
 *
 * `certs/rds-*-bundle.pem` is Amazon's public bundle; it holds no secrets and
 * is committed. Refresh it from https://truststore.pki.rds.amazonaws.com/.
 */
function resolveSsl(): PoolConfig['ssl'] {
  if (!env.databaseSslCaPath) return undefined;

  return {
    ca: readFileSync(resolve(process.cwd(), env.databaseSslCaPath), 'utf8'),
    rejectUnauthorized: true,
  };
}

/**
 * Strip `sslmode` before the URL reaches `pg`.
 *
 * `pg` parses `sslmode` out of the connection string into its own SSL config,
 * which then REPLACES the `ssl` object above — silently dropping our CA, so
 * verification fails against Node's trust store. Verified: with `sslmode` the
 * connection is refused, without it (and with the CA passed explicitly) it
 * succeeds.
 *
 * `DATABASE_URL` keeps `sslmode=require` because that is the form RDS hands
 * you, psql expects, and the Prisma CLI (`migrate`, `db pull`) needs — the CLI
 * uses its own engine, not this adapter.
 */
function toPoolConnectionString(databaseUrl: string): string {
  if (!env.databaseSslCaPath) return databaseUrl;

  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  return url.toString();
}

/**
 * 🔴 **Opening a connection to RDS costs ~1.9s from AppSail** — measured
 * 2026-07-28 via `/api/diagnostics/latency`, against ~255ms for one round trip.
 * It is a TCP handshake, a TLS handshake with full certificate-chain validation,
 * and SCRAM-SHA-256 auth (PBKDF2, 4096 iterations), all across two clouds.
 *
 * That number is why the two timeout settings below are not defaults to leave
 * alone. `pg` closes an idle connection after **10 seconds** unless told
 * otherwise, and this app's traffic is bursty — so with the default, a large
 * share of real requests arrive to an empty pool and pay that ~1.9s before their
 * first query is even sent. `server.ts` warms one connection at boot; without
 * `idleTimeoutMillis` that connection is gone ten seconds later.
 */
const poolConfig: PoolConfig = {
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: resolveSsl(),
  /**
   * Deliberately small: AppSail runs many short-lived instances (§6) against one
   * managed Postgres with a connection cap, and `max` is per instance — so this
   * multiplies by the instance count. Raise it only with evidence of contention
   * (`waiting > 0` in `poolStats()`), never reflexively.
   */
  max: 5,
  /**
   * 0 = never close an idle connection, rather than pg's 10s default. Correct
   * here because `max` is already low, so an idle connection costs one slot on
   * the server and saves ~1.9s the next time traffic arrives.
   */
  idleTimeoutMillis: 0,
  /**
   * `idleTimeoutMillis: 0` keeps the connection in OUR pool, but a NAT gateway
   * or firewall on a two-cloud path will silently drop an idle TCP flow anyway.
   * We would not find out until a query hung on a dead socket. Keepalive probes
   * hold the path open and surface a genuinely broken connection quickly.
   */
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
};

const pool = new Pool(poolConfig);

const adapter = new PrismaPg(pool);

/**
 * Live pool counters, for the diagnostics endpoint.
 *
 * `total` is open connections, `idle` those not currently checked out, and
 * `waiting` requests queued because all `max` are busy. A non-zero `waiting`
 * under light load means the pool — not the network — is the bottleneck.
 */
export function poolStats(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: poolConfig.max ?? 0,
  };
}

/**
 * Open a connection OUTSIDE the pool, time it, and close it again.
 *
 * This is the cost the pool exists to amortise: TCP handshake + TLS handshake
 * with certificate-chain validation + SCRAM-SHA-256 auth (PBKDF2, 4096
 * iterations). It is several round trips plus real CPU on both ends, so
 * comparing it against a pooled `SELECT 1` tells you whether a slow request is
 * paying for distance or for a connection it should not have had to open.
 *
 * Deliberately builds from `poolConfig`, so it measures the SAME endpoint, TLS
 * settings, and credentials the app actually uses — a hand-rolled client here
 * would measure a connection nothing else in the process makes.
 */
export async function timeFreshConnection(): Promise<number> {
  const client = new PgClient(poolConfig);
  const startedAt = performance.now();
  try {
    await client.connect();
    return performance.now() - startedAt;
  } finally {
    await client.end().catch(() => {
      // Already closed, or the connect() above threw. Nothing to salvage — the
      // caller only wanted the timing, and a failed connect surfaces as a throw.
    });
  }
}

export const prisma = new PrismaClient({
  adapter,
  log: env.isProduction ? ['warn', 'error'] : ['query', 'warn', 'error'],
});

/** Transaction-scoped Prisma client handed to `runAsTenant` callbacks. */
export type TenantClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * Run `fn` with Postgres' row-level security scoped to one organization
 * (architecture §3.10).
 *
 * Every RLS policy compares `organization_id` against `app.current_tenant`, so
 * inside this callback the database itself refuses to return, update, or delete
 * another organization's rows — even for a query that forgets its `where`. The
 * app-layer `organizationId` filters stay; this is the net under them, not a
 * replacement for them.
 *
 * Three details are load-bearing:
 *
 * 1. **`set_config(..., true)`, not `SET LOCAL`.** `SET` cannot take a bind
 *    parameter, so `SET LOCAL app.current_tenant = '${id}'` would be string
 *    interpolation straight into SQL — an injection hole in the one function
 *    that exists to enforce security. `set_config()` is the parameterised
 *    equivalent and its third argument, `is_local = true`, is what makes it
 *    `LOCAL`.
 *
 * 2. **It must be a transaction.** `is_local` means "until this transaction
 *    ends". That is what stops the setting leaking to the next request that
 *    borrows this pooled connection. A non-local `set_config` would pin one
 *    tenant's id to a connection and hand it to whoever gets it next — a
 *    cross-tenant leak built out of the thing meant to prevent one.
 *
 * 3. **Use the `tx` handed to the callback**, never the global `prisma`. The
 *    setting lives on the transaction's connection; a query issued on the
 *    global client borrows a *different* connection with no tenant set, and
 *    every RLS-protected table returns zero rows.
 */
export async function runAsTenant<T>(
  tenantId: string,
  fn: (tx: TenantClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx as TenantClient);
  }, options);
}
