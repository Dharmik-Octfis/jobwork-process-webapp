import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.ts';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { censusByOrg } from '../../../db/rls.fixtures.ts';
import { signAccessToken } from '../../../lib/jwt.ts';

/**
 * Cross-tenant isolation for the vendors module.
 *
 * These run against the dev database and read whatever real orgs are in it, so
 * they assert on *relationships* (this user is not a member of that org) rather
 * than on hardcoded ids.
 *
 * The organization is named in the URL (`/organizations/:orgId/…`), so "the
 * attack" here is simply typing someone else's id into the path. That is the
 * point: a route param is a client-supplied claim exactly like the header it
 * replaced, and it is `tenantContext` — not the URL shape — that makes it safe.
 */
const vendorsUrl = (orgId: string) => `/api/organizations/${orgId}/purchases/vendors`;
describe('vendors — cross-tenant isolation', () => {
  // The control. Without this, "everything returns 403" would look like a pass.
  it('a member CAN still read their own organisation’s vendors', async (ctx) => {
    // `where: { vendors: { some: {} } }` cannot be used to find this fixture:
    // the subquery is RLS-gated and matches nothing outside a tenant context,
    // which silently turned this control into a no-op. See db/rls.fixtures.ts.
    const census = await censusByOrg();
    const org = census.find((o) => o.vendors > 0 && o.memberIds.length > 0);
    const memberId = org?.memberIds[0];
    if (!org || !memberId) {
      ctx.skip('no organization has both vendors and a member');
      return;
    }

    const token = signAccessToken(memberId, 'session-for-test');

    const res = await request(createApp())
      .get(`${vendorsUrl(org.id)}?perPage=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // The list no longer returns a total (counting is opt-in via /count), so the
    // request above asks for a page big enough to hold them all and we count rows.
    const { results } = res.body.data;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(org.vendors);
    for (const vendor of results) expect(vendor.organizationId).toBe(org.id);
  });

  it('a malformed organization id is rejected, not 500', async () => {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) return;
    const token = signAccessToken(user.id, 'session-for-test');

    // A non-uuid would blow up the Postgres comparison and surface as a 500.
    // `tenantContext` shape-checks it first and answers as what it is: not yours.
    const res = await request(createApp())
      .get(vendorsUrl('not-a-uuid'))
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('a user cannot read the vendors of an organization they do not belong to', async (ctx) => {
    // Pick the victim FIRST — an org that actually has vendors to leak — then
    // find an outsider. Picking the user first tends to select someone who is
    // already in every org that has data, and the test skips itself.
    const census = await censusByOrg();
    const victimOrg = census.find((o) => o.vendors > 0);
    if (!victimOrg) {
      ctx.skip('no organization has vendors to leak');
      return;
    }

    // Any user who is NOT a member of that org. `memberships` carries no RLS
    // policy by design, so unlike the victim lookup this one works out here.
    const outsider = await prisma.user.findFirst({
      where: { memberships: { none: { organizationId: victimOrg.id } } },
      select: { id: true },
    });
    if (!outsider) {
      ctx.skip(`every user is already a member of "${victimOrg.name}"`);
      return;
    }

    // The attacker's own token. Legitimately issued — they really are this user.
    // `sid` is not looked up in the database by `authenticate`, only verified as
    // a claim, so any signed token for this user authenticates.
    const token = signAccessToken(outsider.id, 'session-for-test');

    const res = await request(createApp())
      // The only thing the attacker changes: someone else's organization id,
      // typed straight into the URL.
      .get(vendorsUrl(victimOrg.id))
      .set('Authorization', `Bearer ${token}`);

    // Either refuse (403/404) or return nothing. Returning another org's
    // vendors is a cross-tenant data breach.
    if (res.status === 200) {
      const { results } = res.body.data;
      expect(
        results,
        `LEAK: user ${outsider.id} is not a member of "${victimOrg.name}" ` +
          `yet read ${Array.isArray(results) ? results.length : '?'} of its ` +
          `${victimOrg.vendors} vendors by editing the URL.`,
      ).toEqual([]);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it('a user cannot create a vendor inside an organization they do not belong to', async (ctx) => {
    const membership = await prisma.membership.findFirst({
      select: { userId: true, organizationId: true },
    });
    if (!membership) {
      ctx.skip('no memberships exist');
      return;
    }

    const victimOrg = await prisma.organization.findFirst({
      where: { memberships: { none: { userId: membership.userId } } },
      select: { id: true, name: true },
    });
    if (!victimOrg) {
      ctx.skip('every organization already has this user as a member');
      return;
    }

    const token = signAccessToken(membership.userId, 'session-for-test');
    const contactNumber = `ISOLATION-TEST-${Date.now()}`;

    const res = await request(createApp())
      .post(vendorsUrl(victimOrg.id))
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendorName: 'Injected by isolation test',
        contactNumber,
        gstTreatment: 'unregistered',
        sourceOfSupply: 'Gujarat',
      });

    // Look for the row from INSIDE the victim's tenant context, which is where
    // it would have landed. `prisma.vendor.findFirst` on the global client is
    // RLS-gated: out here it returns null whether or not the write got through,
    // so `expect(written).toBeNull()` below would be an assertion that cannot
    // fail — green even on a real breach. That is what it was until 2026-07-17.
    const written = await runAsTenant(victimOrg.id, (tx) =>
      tx.vendor.findFirst({
        where: { contactNumber, organizationId: victimOrg.id },
        select: { id: true },
      }),
    );

    // Clean up if the write got through, so the test does not pollute dev data.
    if (written) {
      await runAsTenant(victimOrg.id, (tx) =>
        tx.vendor.deleteMany({ where: { id: written.id, organizationId: victimOrg.id } }),
      );
    }

    expect(
      written,
      `LEAK: user ${membership.userId} wrote a vendor into "${victimOrg.name}", ` +
        `an organization they are not a member of.`,
    ).toBeNull();
    expect([401, 403, 404]).toContain(res.status);
  });

  // Search is just another read: it must be scoped to the caller's tenant exactly
  // like the plain list. A `?search=` that reaches across tenants is the same leak.
  it('a member’s ?search= returns only their own organisation’s matching rows', async (ctx) => {
    const census = await censusByOrg();
    const org = census.find((o) => o.vendors > 0 && o.memberIds.length > 0);
    const memberId = org?.memberIds[0];
    if (!org || !memberId) {
      ctx.skip('no organization has both vendors and a member');
      return;
    }

    // A term that genuinely exists in this org — a fragment of a real vendor's
    // name — so the search is expected to match something.
    const sample = await runAsTenant(org.id, (tx) =>
      tx.vendor.findFirst({
        where: { organizationId: org.id, isDeleted: false },
        select: { contactName: true },
      }),
    );
    if (!sample?.contactName || sample.contactName.length < 2) {
      ctx.skip('no named vendor to derive a search term from');
      return;
    }
    const term = sample.contactName.slice(0, 3);
    const token = signAccessToken(memberId, 'session-for-test');

    const res = await request(createApp())
      .get(`${vendorsUrl(org.id)}?search=${encodeURIComponent(term)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { results } = res.body.data;
    expect(results.length).toBeGreaterThan(0);
    // Every hit belongs to the searcher's own org — never a match bled in from
    // another tenant that happens to share the term.
    for (const vendor of results) expect(vendor.organizationId).toBe(org.id);
  });

  it('a user cannot search another organisation’s vendors', async (ctx) => {
    const census = await censusByOrg();
    const victimOrg = census.find((o) => o.vendors > 0);
    if (!victimOrg) {
      ctx.skip('no organization has vendors to leak');
      return;
    }

    const outsider = await prisma.user.findFirst({
      where: { memberships: { none: { organizationId: victimOrg.id } } },
      select: { id: true },
    });
    if (!outsider) {
      ctx.skip(`every user is already a member of "${victimOrg.name}"`);
      return;
    }

    const token = signAccessToken(outsider.id, 'session-for-test');

    // A broad term that would match many rows if the query were not tenant-scoped.
    const res = await request(createApp())
      .get(`${vendorsUrl(victimOrg.id)}?search=a`)
      .set('Authorization', `Bearer ${token}`);

    if (res.status === 200) {
      const { results } = res.body.data;
      expect(
        results,
        `LEAK via search: outsider ${outsider.id} matched rows in "${victimOrg.name}".`,
      ).toEqual([]);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });
});
