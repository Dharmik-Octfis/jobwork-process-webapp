import { prisma, runAsTenant } from './prisma.ts';

/**
 * Fixture discovery for the tenant-isolation suites.
 *
 * WHY THIS FILE EXISTS
 *
 * The obvious way to find test data is the wrong one:
 *
 *   prisma.organization.findFirst({ where: { vendors: { some: {} } } })   // -> null. always.
 *
 * That subquery reads `vendors`, and `vendors` is RLS-gated. Outside a tenant
 * context the policy compares `organizationId` against a NULL
 * `app.current_tenant`, so no vendor matches, so no organization matches —
 * however much data exists. The lookup returns null, and a test guarded by
 * `if (!org) return` then passes without asserting anything.
 *
 * That is not hypothetical. Between the RLS cutover and 2026-07-17 it is exactly
 * what these suites did: four tests green while asserting nothing, including the
 * one whose entire job is proving RLS blocks a cross-tenant read. The suite that
 * exists to catch "RLS silently does nothing" was silently doing nothing.
 *
 * The rule this file encodes: **tenant data can only be found from inside a
 * tenant context.** `organizations` and `memberships` carry no policy (on
 * purpose — see the enable_rls migration), so they can be listed directly; each
 * org's vendors are then counted from inside that org's own context, where the
 * policy admits them.
 */

export interface OrgCensus {
  id: string;
  name: string;
  /** Rows visible from inside this org's context, matching the list endpoints
   *  (which all filter `isDeleted: false`). */
  vendors: number;
  customers: number;
  items: number;
  /** Ids of the users holding a membership in this organization. */
  memberIds: string[];
}

/**
 * Memoised for the life of the worker. Vitest forks one process per test file, so
 * this is a per-file cache — and every suite that uses it calls it three to five
 * times while only ever *reading*. The one write in these suites is a probe that
 * is expected to be refused, and it deletes its own row; nothing re-reads a count
 * afterwards. Call `resetCensus()` if a future test does mutate tenant data.
 */
let cachedCensus: OrgCensus[] | null = null;

/** Drop the memoised census — for a test that deliberately changes tenant data. */
export function resetCensus(): void {
  cachedCensus = null;
}

/**
 * Every organization, each with its row counts measured inside its own tenant
 * context. This is the only honest way to ask "who has vendors?" under RLS.
 *
 * 🔴 **The cost here is transactions, not rows.** `runAsTenant` is an interactive
 * transaction — BEGIN, `set_config`, the query, COMMIT — so it costs ~148ms against
 * the dev database where a pooled round trip costs ~27ms. This used to open THREE
 * of them per organization; at 26 organizations that was 78 transactions and 7.6s,
 * which blew vitest's 5s default and made four suites look flaky. Worse, it grew
 * with the dev data, so it got slower every time someone added an organization.
 *
 * One transaction per org, one statement inside it, and the result cached. The
 * per-org transaction cannot be collapsed further without giving up the doctrine
 * this file exists to enforce: `app.current_tenant` holds one tenant at a time, so
 * counting another org's rows honestly requires another transaction.
 */
export async function censusByOrg(): Promise<OrgCensus[]> {
  if (cachedCensus) return cachedCensus;

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, memberships: { select: { userId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const census: OrgCensus[] = [];

  // Sequential on purpose: each runAsTenant holds a transaction and the pool caps
  // at 2 under vitest (db/prisma.ts). Fanning these out with Promise.all wedges on
  // any database with more organizations than connections.
  for (const org of orgs) {
    // All three counts in ONE transaction, as one statement. Both layers are still
    // here exactly as the app does it: runAsTenant for the policy, an explicit
    // `organization_id` for the app filter. That filter also keeps the count honest
    // if this ever runs as a role that bypasses RLS, where a bare count would
    // silently total every tenant's rows.
    //
    // `is_deleted = false` mirrors the list endpoints, but this is NOT what a
    // default list read returns: a module whose first LIST_FILTERS preset narrows
    // (items default to "Active Items") answers with fewer rows. Compare against
    // such a list only with the matching `?filter=`.
    //
    // `::uuid` on every parameter — `organization_id` is uuid and the bind arrives
    // as text, which Postgres rejects with "operator does not exist: uuid = text".
    const [counts] = await runAsTenant(
      org.id,
      (tx) => tx.$queryRaw<{ vendors: bigint; customers: bigint; items: bigint }[]>`
        SELECT
          (SELECT count(*) FROM vendors
            WHERE organization_id = ${org.id}::uuid AND is_deleted = false) AS vendors,
          (SELECT count(*) FROM customers
            WHERE organization_id = ${org.id}::uuid AND is_deleted = false) AS customers,
          (SELECT count(*) FROM items
            WHERE organization_id = ${org.id}::uuid AND is_deleted = false) AS items`,
    );

    census.push({
      id: org.id,
      name: org.name,
      // count(*) is bigint, which the driver hands back as a BigInt — every
      // consumer here compares it against a plain number.
      vendors: Number(counts?.vendors ?? 0),
      customers: Number(counts?.customers ?? 0),
      items: Number(counts?.items ?? 0),
      memberIds: org.memberships.map((m) => m.userId),
    });
  }

  cachedCensus = census;
  return census;
}

/** Total vendors across every tenant — what an unfiltered query would leak. */
export function totalVendors(census: OrgCensus[]): number {
  return census.reduce((n, org) => n + org.vendors, 0);
}

/** One vendor id belonging to `organizationId`, read inside its tenant context. */
export async function aVendorOf(organizationId: string): Promise<string | undefined> {
  const vendor = await runAsTenant(organizationId, (tx) =>
    tx.vendor.findFirst({ where: { organizationId }, select: { id: true } }),
  );
  return vendor?.id;
}

export async function aCustomerOf(organizationId: string): Promise<string | undefined> {
  const customer = await runAsTenant(organizationId, (tx) =>
    tx.customer.findFirst({ where: { organizationId }, select: { id: true } }),
  );
  return customer?.id;
}
