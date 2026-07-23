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
 * context the policy compares `organization_id` against a NULL
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
  /** Vendors visible from inside this organization's own tenant context. */
  vendors: number;
  customers: number;
  /** Ids of the users holding a membership in this organization. */
  memberIds: string[];
}

/**
 * Every organization, each with its vendor count measured inside its own tenant
 * context. This is the only honest way to ask "who has vendors?" under RLS.
 */
export async function censusByOrg(): Promise<OrgCensus[]> {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, memberships: { select: { userId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const census: OrgCensus[] = [];

  // Sequential on purpose: each runAsTenant holds a transaction, and the pool
  // caps at 5 (db/prisma.ts). Fanning these out with Promise.all wedges on any
  // database with more organizations than connections.
  for (const org of orgs) {
    const vendors = await runAsTenant(org.id, (tx) =>
      // Both layers, exactly as the app does it: runAsTenant for the policy,
      // `where` for the app filter. The `where` also keeps this count honest if
      // it ever runs as a role that bypasses RLS, where the bare count would
      // silently return every tenant's rows.
      tx.vendor.count({ where: { organizationId: org.id } }),
    );
    const customers = await runAsTenant(org.id, (tx) =>
      tx.customer.count({ where: { organizationId: org.id } }),
    );

    census.push({
      id: org.id,
      name: org.name,
      vendors,
      customers,
      memberIds: org.memberships.map((m) => m.userId),
    });
  }

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
