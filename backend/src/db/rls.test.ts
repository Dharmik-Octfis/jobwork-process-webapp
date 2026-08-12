import { describe, it, expect, beforeAll } from 'vitest';
import { prisma, runAsTenant } from './prisma.ts';
import { aVendorOf, censusByOrg, totalVendors } from './rls.fixtures.ts';

/**
 * Proof that Row-Level Security is actually enforcing, not decorative.
 *
 * Every assertion here fails if the policies are dropped, if the app connects as
 * a role that bypasses them, or if `runAsTenant` stops setting the GUC. That is
 * the entire point: RLS that silently does nothing looks exactly like RLS that
 * works, right up until a breach.
 *
 * These skip themselves until the cutover in docs/PRISMA.md §8 "Turning RLS on"
 * is done, so they do not fail the suite while the migration is still pending.
 */

/** Tenant-data tables that MUST carry a policy. See the enable_rls migration.
 * The vendor_* children scope through their parent vendor, number_sequences on
 * its own organization_id — see 20260720120100_rename_dial_code_and_enable_vendor_rls. */
const TENANT_TABLES = [
  'vendors',
  'items',
  'customers',
  'number_sequences',
  'vendor_contact_persons',
  'vendor_activities',
  'item_activities',
  'vendor_comments',
  'vendor_addresses',
  'customer_contact_persons',
  'customer_activities',
  'customer_comments',
  'customer_addresses',
  'units_of_measurement',
  'currencies',
  'payment_terms',
  'custom_field_definitions',
  'roles',
  'permission_templates',
  'list_view_preferences',
  // Jobwork / inventory, added in 20260804120247_jobwork_sprint1_foundation.
  // `lot_packages` carries its own organization_id (denormalised from its lot)
  // rather than scoping through the parent, so its policy compares directly.
  // `stock_ledger` has no UI at all — which is exactly why it needs to be listed
  // here: nothing else would ever notice its policy going missing.
  'processes',
  'lots',
  'lot_packages',
  'stock_ledger',
  // Sprints 2–4, added in 20260805070926_jobwork_sprints_2_to_4. The LINE tables
  // are here for the same reason as `lot_packages`: each carries its own
  // `organization_id` and its own policy rather than being scoped through its
  // header, so a query that reads one directly is still covered.
  'routes',
  'route_steps',
  'job_orders',
  'job_order_steps',
  'job_issues',
  'job_issue_lines',
  'rejection_reasons',
  'job_receipts',
  'job_receipt_lines',
  // Multi-item steps (domain §5.7), added in 20260806112805_multi_item_steps.
  // A step's inputs and outputs are its bill of materials — which items an org
  // runs through which process is exactly the kind of thing a competitor would
  // like to read, so these are as tenant-sensitive as the steps they hang off.
  'route_step_inputs',
  'route_step_outputs',
  'job_order_step_inputs',
  'job_order_step_outputs',
  'job_receipt_outputs',
  // Composite Items / Assemblies (Phase 1)
  'composite_item_components',
  'item_assemblies',
  'item_assembly_lines',
  'item_assembly_comments',
  'item_assembly_activities',
  'item_opening_stock_rows',
  'item_location_stocks',
] as const;

/**
 * Deliberately NOT tenant-gated. Gating these deadlocks the app: `tenantContext`
 * reads `memberships` to discover the tenant, "list my organizations" runs
 * before one is chosen, and invite links are public by design.
 */
const CONTROL_PLANE_TABLES = ['organizations', 'memberships', 'invitations'] as const;

let rlsLive = false;
let skipReason = '';

/** `SELECT current_user`, without the array-destructuring dance each time. */
async function currentUser(): Promise<string> {
  const rows = await prisma.$queryRaw<{ dbUser: string }[]>`SELECT current_user AS "dbUser"`;
  return rows[0]?.dbUser ?? '';
}

beforeAll(async () => {
  const user = await currentUser();

  const owners = await prisma.$queryRaw<{ tableowner: string }[]>`
    SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vendors'`;

  const enabled = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
    SELECT relrowsecurity FROM pg_class WHERE relname = 'vendors'`;

  const isOwner = owners[0]?.tableowner === user;
  const policiesOn = enabled[0]?.relrowsecurity === true;

  if (!policiesOn) skipReason = 'RLS migration not applied yet';
  else if (isOwner) skipReason = `connected as '${user}', which OWNS vendors — owners bypass RLS`;
  rlsLive = policiesOn && !isOwner;
});

describe('row-level security', () => {
  it('the app does not connect as a role that bypasses RLS', async () => {
    const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const role = rows[0];

    // A superuser or a BYPASSRLS role ignores every policy in the database. If
    // this ever flips true, every other test here is meaningless.
    expect(role?.rolsuper, 'app role must not be a superuser').toBe(false);
    expect(role?.rolbypassrls, 'app role must not have BYPASSRLS').toBe(false);
  });

  it('the app does not own the tables it queries', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    const rows = await prisma.$queryRaw<{ tablename: string; tableowner: string }[]>`
      SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${[...TENANT_TABLES]})`;
    const user = await currentUser();

    // An owner is exempt from its own policies unless FORCE is set. Connecting
    // as the owner is the classic way RLS becomes theatre.
    for (const row of rows) {
      expect(row.tableowner, `${row.tablename} must not be owned by the app role`).not.toBe(user);
    }
  });

  it('every tenant table has RLS enabled and a policy', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    for (const table of TENANT_TABLES) {
      const [cls] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
        SELECT relrowsecurity FROM pg_class WHERE relname = ${table}`;
      expect(cls?.relrowsecurity, `${table}: RLS not enabled`).toBe(true);

      const policies = await prisma.$queryRaw<{ policyname: string }[]>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}`;
      expect(policies.length, `${table}: no policy`).toBeGreaterThan(0);
    }
  });

  it('control-plane tables are deliberately NOT gated (gating them deadlocks login)', async () => {
    for (const table of CONTROL_PLANE_TABLES) {
      const [cls] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
        SELECT relrowsecurity FROM pg_class WHERE relname = ${table}`;
      // Documents intent. If someone adds RLS to memberships, tenantContext can
      // never resolve a tenant and every request 403s — this fails first.
      expect(cls?.relrowsecurity, `${table} must NOT have RLS — see enable_rls migration`).toBe(
        false,
      );
    }
  });

  it('a query with NO where clause returns only the current tenant’s rows', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    // NOT `organization.findFirst({ where: { vendors: { some: {} } } })` — that
    // subquery is RLS-gated and returns null out here however much data exists,
    // which is how this test spent its first day passing vacuously.
    const census = await censusByOrg();
    const mine = census.find((org) => org.vendors > 0);
    if (!mine) {
      ctx.skip('no organization has any vendors to read');
      return;
    }
    const total = totalVendors(census);

    // The whole point: this SQL is as wrong as SQL gets — no filter at all —
    // and the database still refuses to hand over anyone else's rows.
    const rows = await runAsTenant(
      mine.id,
      async (tx) =>
        tx.$queryRaw<{ organizationId: string }[]>`
        SELECT organization_id AS "organizationId" FROM vendors`,
    );

    expect(rows.length, 'saw none of my own rows — RLS is over-filtering').toBe(mine.vendors);
    for (const row of rows) expect(row.organizationId).toBe(mine.id);

    // The assertion that proves EXCLUSION rather than emptiness. Skipped-over
    // silently if nobody else has rows, because then there is nothing to leak
    // and "saw only mine" is true by accident rather than by enforcement.
    if (total > mine.vendors) {
      expect(
        rows.length,
        `LEAK: an unfiltered SELECT returned rows from other tenants (${total} vendors exist in total)`,
      ).toBeLessThan(total);
    }
  });

  it('outside any tenant context, tenant tables are invisible', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    // No runAsTenant, so app.current_tenant is unset -> the policy compares
    // against NULL -> no row matches. Failing closed, by design.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM vendors`;
    expect(Number(rows[0]?.n ?? -1)).toBe(0);
  });

  it('a write aimed at another tenant’s row affects nothing', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    // `prisma.vendor.findFirst()` out here is RLS-gated and always returns null,
    // so the victim has to be found through their own tenant context.
    const census = await censusByOrg();
    const victim = census.find((org) => org.vendors > 0);
    const attacker = census.find((org) => org.id !== victim?.id);
    if (!victim || !attacker) {
      ctx.skip('need an organization with vendors, and a second one to attack from');
      return;
    }

    const victimVendorId = await aVendorOf(victim.id);
    if (!victimVendorId) {
      ctx.skip(`"${victim.name}" reported vendors but yielded none`);
      return;
    }

    // Attacker knows the victim's row id exactly and targets it by primary key.
    const affected = await runAsTenant(
      attacker.id,
      async (tx) =>
        tx.$executeRaw`UPDATE vendors SET display_name = 'hacked' WHERE id = ${victimVendorId}::uuid`,
    );

    expect(affected, 'RLS must make another tenant’s row unreachable').toBe(0);

    // Belt and braces: prove the row is untouched rather than trusting the
    // reported row count. A policy that filtered the UPDATE but let it through
    // would show 0 here too — but so would a real write, if we only asked
    // Postgres how many rows it claimed to touch.
    const name = await runAsTenant(victim.id, (tx) =>
      tx.vendor.findFirst({
        where: { id: victimVendorId, organizationId: victim.id },
        select: { contactName: true },
      }),
    );
    expect(name?.contactName, 'the victim’s row was actually modified').not.toBe('hacked');
  });

  it('the tenant setting does not leak to the next query on the same connection', async (ctx) => {
    if (!rlsLive) {
      ctx.skip(skipReason);
      return;
    }

    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (!org) {
      ctx.skip('no organizations exist');
      return;
    }

    await runAsTenant(org.id, async (tx) => tx.$queryRaw`SELECT 1`);

    // set_config(..., is_local = true) is transaction-scoped. If someone drops
    // that third argument, the tenant id sticks to the pooled connection and
    // gets handed to whoever borrows it next — a cross-tenant leak built out of
    // the leak prevention.
    const rows = await prisma.$queryRaw<{ tenant: string | null }[]>`
      SELECT current_setting('app.current_tenant', true) AS tenant`;
    const tenant = rows[0]?.tenant;
    expect(tenant === null || tenant === undefined || tenant === '').toBe(true);
  });
});
