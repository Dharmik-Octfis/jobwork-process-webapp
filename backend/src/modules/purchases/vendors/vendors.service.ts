import { runAsTenant } from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

/**
 * Every query runs inside `runAsTenant`, which sets `app.current_tenant` for the
 * transaction so Postgres' row-level security policies apply (architecture
 * §3.10, migration 20260716183126_enable_rls).
 *
 * The `where: { organizationId }` filters stay. RLS is the net under them, not a
 * replacement: the app filter is what the query *means*, and RLS is what saves
 * us when someone forgets it.
 *
 * `runAsTenant` wraps each service call rather than the whole request. A Prisma
 * transaction holds a pooled connection for its entire life, and the pool is 5
 * per instance (db/prisma.ts) — a request-long transaction would hold that
 * connection through validation, serialization, and any slow I/O. One query,
 * one short transaction.
 *
 * Forgetting `runAsTenant` on a new function is not a leak: with no tenant set,
 * the policy compares against NULL and the query returns nothing. It fails
 * closed and loudly, which is the point of having both layers.
 */

export async function getVendorsList(organizationId: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createNewVendor(
  organizationId: string,
  data: Omit<Prisma.VendorUncheckedCreateInput, 'organizationId'>,
) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.create({
      data: {
        ...data,
        organizationId,
      },
    }),
  );
}
