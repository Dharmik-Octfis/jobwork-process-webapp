import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../../generated/prisma/client.ts';
import { env } from '../config/env.ts';

/**
 * Prisma 7 requires a driver adapter — there is no bare-connection-string mode.
 * `@prisma/adapter-pg` wraps a `pg.Pool`, which is what lets us cap connections
 * per instance. AppSail runs many short-lived instances of this app (§6), and
 * each one holding a large pool is how a managed Postgres runs out of
 * connections.
 *
 * `runAsTenant()` (RLS context, §3.10) will wrap this client once organizations
 * and tenant-scoped tables exist. `users` is deliberately not tenant-scoped:
 * a user row exists before any organization does.
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

const adapter = new PrismaPg({
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: resolveSsl(),
  max: 5,
});

export const prisma = new PrismaClient({
  adapter,
  log: env.isProduction ? ['warn', 'error'] : ['query', 'warn', 'error'],
});
