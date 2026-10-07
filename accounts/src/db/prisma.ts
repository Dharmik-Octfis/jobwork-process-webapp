import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';
import { PrismaClient } from '../../generated/prisma/client.ts';
import { env } from '../config/env.ts';

/**
 * Prisma 7 requires a driver adapter — there is no bare-connection-string mode.
 *
 * 🔴 There is deliberately no `runAsTenant` here, and there never should be. This
 * database has no tenants: every row is global, no table carries an
 * `organizationId`, and no policy exists to scope. Reaching for the app's tenant
 * helpers in this service means something has been modelled wrong.
 *
 * The pool settings mirror `backend/src/db/prisma.ts` because they solve the same
 * problem — a managed Postgres with a connection cap, reached across two clouds —
 * and the reasoning there applies unchanged. The one difference is `max`: this
 * service is on the login path only, not every API call, so it needs fewer.
 */

/**
 * `sslmode=require` means different things in different clients. psql encrypts
 * but skips certificate validation; node-postgres validates against Node's trust
 * store, which has no Amazon root CA — so RDS fails with "self-signed certificate
 * in certificate chain".
 *
 * The fix is to supply the CA, not to set `rejectUnauthorized: false`. Turning
 * verification off leaves the connection encrypted but unauthenticated, so
 * anything able to intercept the route can impersonate the database — which for
 * this database means impersonating the store of every password hash we hold.
 */
function resolveSsl(): PoolConfig['ssl'] {
  if (!env.databaseSslCaPath) return undefined;

  return {
    ca: readFileSync(resolve(process.cwd(), env.databaseSslCaPath), 'utf8'),
    rejectUnauthorized: true,
  };
}

/**
 * Strip `sslmode` before the URL reaches `pg`: it parses `sslmode` out of the
 * connection string into its own SSL config, which then REPLACES the `ssl` object
 * above, silently dropping our CA. `DATABASE_URL` keeps `sslmode=require` because
 * that is the form RDS hands you and the Prisma CLI needs.
 */
function toPoolConnectionString(databaseUrl: string): string {
  if (!env.databaseSslCaPath) return databaseUrl;

  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  return url.toString();
}

const poolConfig: PoolConfig = {
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: resolveSsl(),
  /**
   * Names every connection in `pg_stat_activity.application_name`, so "who is
   * holding these connections?" is answerable from the database alone — and so
   * this service is distinguishable from the app when they share an instance.
   */
  application_name: 'accounts',
  /**
   * Smaller than the app's. Opening a connection costs ~1.9s across two clouds, so
   * the pool exists to amortise that, but this service is reached at login and at
   * refresh-of-the-SSO-cookie only — not on every API call. Raise only with
   * evidence of contention, never reflexively.
   */
  max: process.env['VITEST'] ? 2 : 3,
  /** 0 = never close an idle connection, rather than pg's 10s default. */
  idleTimeoutMillis: 0,
  /**
   * `idleTimeoutMillis: 0` keeps the connection in OUR pool, but a NAT gateway or
   * firewall on a two-cloud path drops an idle TCP flow anyway, and we would not
   * find out until a query hung on a dead socket.
   */
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
};

const globalForDb = globalThis as unknown as {
  accountsPool?: Pool;
  accountsAdapter?: PrismaPg;
  accountsClient?: PrismaClient;
};

const pool = globalForDb.accountsPool ?? new Pool(poolConfig);

/**
 * `disposeExternalPool` is what makes `$disconnect()` close the sockets. The
 * adapter only ends a pool it created itself; hand it one of ours and, without
 * this flag, `$disconnect()` releases Prisma's handle and leaves every connection
 * open on the server.
 */
const adapter = globalForDb.accountsAdapter ?? new PrismaPg(pool, { disposeExternalPool: true });

export const prisma =
  globalForDb.accountsClient ??
  new PrismaClient({
    adapter,
    /**
     * 🔴 Never log queries in production here. The app can afford it; this service
     * cannot — its query parameters are email addresses and password hashes.
     */
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) {
  globalForDb.accountsPool = pool;
  globalForDb.accountsAdapter = adapter;
  globalForDb.accountsClient = prisma;
}

/** Live pool counters, for a diagnostics endpoint. */
export function poolStats(): { total: number; idle: number; waiting: number } {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
