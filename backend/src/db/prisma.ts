import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';
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

const pool = new Pool({
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: resolveSsl(),
  max: 5,
});

const adapter = new PrismaPg(pool);

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
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx as TenantClient);
  });
}
