import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.ts';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { censusByOrg } from '../../db/rls.fixtures.ts';
import { signAccessToken } from '../../lib/jwt.ts';

/**
 * Cross-tenant isolation for the items module — the sibling of
 * vendors/customers `*.tenant-isolation.test.ts`. Same reasoning applies: the
 * organization is named in the URL (`/organizations/:orgId/items`), so "the
 * attack" is typing someone else's id into the path, and it is `tenantContext`
 * — not the URL shape — that makes it safe. These read whatever real orgs are in
 * the dev database and assert on relationships, not hardcoded ids.
 */
const itemsUrl = (orgId: string) => `/api/organizations/${orgId}/items`;

describe('items — cross-tenant isolation', () => {
  // The control. Without this, "everything returns 403" would look like a pass.
  it('a member CAN still read their own organisation’s items', async (ctx) => {
    const census = await censusByOrg();
    const org = census.find((o) => o.items > 0 && o.memberIds.length > 0);
    const memberId = org?.memberIds[0];
    if (!org || !memberId) {
      ctx.skip('no organization has both items and a member');
      return;
    }

    const token = signAccessToken(memberId, 'session-for-test');

    const res = await request(createApp())
      .get(`${itemsUrl(org.id)}?perPage=100&filter=all_items`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // The list no longer returns a total (counting is opt-in via /count), so the
    // request above asks for a page big enough to hold them all and we count rows.
    // `filter=all_items` is what makes that count comparable to the census: unlike
    // vendors and customers, whose default preset is `where: {}`, the item list
    // defaults to "Active Items" (LIST_FILTERS.item[0]), so the bare request hides
    // every inactive item and the control silently reads short.
    const { results } = res.body.data;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(org.items);
    for (const item of results) expect(item.organizationId).toBe(org.id);
  });

  it('a malformed organization id is rejected, not 500', async () => {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) return;
    const token = signAccessToken(user.id, 'session-for-test');

    // A non-uuid would blow up the Postgres comparison and surface as a 500.
    // `tenantContext` shape-checks it first and answers as what it is: not yours.
    const res = await request(createApp())
      .get(itemsUrl('not-a-uuid'))
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('a user cannot read the items of an organization they do not belong to', async (ctx) => {
    const census = await censusByOrg();
    const victimOrg = census.find((o) => o.items > 0);
    if (!victimOrg) {
      ctx.skip('no organization has items to leak');
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

    const res = await request(createApp())
      .get(itemsUrl(victimOrg.id))
      .set('Authorization', `Bearer ${token}`);

    // Either refuse (403/404) or return nothing. Returning another org's items
    // is a cross-tenant data breach.
    if (res.status === 200) {
      const { results } = res.body.data;
      expect(
        results,
        `LEAK: user ${outsider.id} is not a member of "${victimOrg.name}" ` +
          `yet read ${Array.isArray(results) ? results.length : '?'} of its ` +
          `${victimOrg.items} items by editing the URL.`,
      ).toEqual([]);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it('a user cannot create an item inside an organization they do not belong to', async (ctx) => {
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
    const name = `ISOLATION-TEST-${Date.now()}`;

    const res = await request(createApp())
      .post(itemsUrl(victimOrg.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ name, sku: name, unit: 'pcs', type: 'Goods' });

    // Look for the row from INSIDE the victim's tenant context, which is where
    // it would have landed. A global `prisma.item.findFirst` is RLS-gated: out
    // here it returns null whether or not the write got through, so the assertion
    // could not fail. Read it as the tenant to make the check real.
    const written = await runAsTenant(victimOrg.id, (tx) =>
      tx.item.findFirst({
        where: { name, organizationId: victimOrg.id },
        select: { id: true },
      }),
    );

    // Clean up if the write got through, so the test does not pollute dev data.
    if (written) {
      await runAsTenant(victimOrg.id, (tx) =>
        tx.item.deleteMany({ where: { id: written.id, organizationId: victimOrg.id } }),
      );
    }

    expect(
      written,
      `LEAK: user ${membership.userId} wrote an item into "${victimOrg.name}", ` +
        `an organization they are not a member of.`,
    ).toBeNull();
    expect([401, 403, 404]).toContain(res.status);
  });

  // Search is just another read: it must be scoped to the caller's tenant exactly
  // like the plain list. A `?search=` that reaches across tenants is the same leak.
  it('a member’s ?search= returns only their own organisation’s matching rows', async (ctx) => {
    const census = await censusByOrg();
    const org = census.find((o) => o.items > 0 && o.memberIds.length > 0);
    const memberId = org?.memberIds[0];
    if (!org || !memberId) {
      ctx.skip('no organization has both items and a member');
      return;
    }

    const sample = await runAsTenant(org.id, (tx) =>
      tx.item.findFirst({
        where: { organizationId: org.id, isDeleted: false },
        select: { name: true },
      }),
    );
    if (!sample?.name || sample.name.length < 2) {
      ctx.skip('no named item to derive a search term from');
      return;
    }
    const term = sample.name.slice(0, 3);
    const token = signAccessToken(memberId, 'session-for-test');

    const res = await request(createApp())
      .get(`${itemsUrl(org.id)}?search=${encodeURIComponent(term)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const { results } = res.body.data;
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) expect(item.organizationId).toBe(org.id);
  });

  it('a user cannot search another organisation’s items', async (ctx) => {
    const census = await censusByOrg();
    const victimOrg = census.find((o) => o.items > 0);
    if (!victimOrg) {
      ctx.skip('no organization has items to leak');
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

    const res = await request(createApp())
      .get(`${itemsUrl(victimOrg.id)}?search=a`)
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
