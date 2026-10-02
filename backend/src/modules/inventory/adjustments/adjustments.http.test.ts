import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.ts';
import { prisma, runAsTenant } from '../../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../../db/testTenant.ts';
import { signAccessToken } from '../../../lib/jwt.ts';

/**
 * The HTTP surface of stock adjustments: the envelope, tenant isolation, and the
 * permission gate on every route (docs/STOCK_ADJUSTMENT_PLAN.md §6, 12–13).
 *
 * Own fixtures throughout, hard-deleted afterwards — two organizations, so "the
 * attack" is a real member of one typing the other's id into the URL.
 */

const unique = () => process.hrtime.bigint().toString(36);
const url = (orgId: string, id = '') =>
  `/api/organizations/${orgId}/inventory/adjustments${id ? `/${id}` : ''}`;

let orgA: string;
let orgB: string;
let itemId: string;
let godownId: string;
const userIds: string[] = [];

/** Bearer tokens, by what the holder may do in org A. */
const token = { owner: '', none: '', readOnly: '', createOnly: '', outsider: '' };

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `adj-http-${label}-${unique()}@example.test`,
      passwordHash: 'x',
      firstName: label,
      fullName: `${label} Tester`,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function join(
  userId: string,
  organizationId: string,
  access: { isOwner?: boolean; permissions?: string[] },
) {
  const template = access.permissions
    ? await runAsTenant(organizationId, (tx) =>
        tx.permissionTemplate.create({
          data: {
            organizationId,
            name: `adj-${unique()}`,
            permissions: access.permissions,
          },
          select: { id: true },
        }),
      )
    : null;
  await prisma.membership.create({
    data: {
      userId,
      organizationId,
      firstName: 'Adj',
      lastName: 'Tester',
      fullName: 'Adj Tester',
      isOwner: access.isOwner ?? false,
      permissionTemplateId: template?.id ?? null,
    },
  });
  return signAccessToken(userId, 'session-for-test');
}

const body = (extra: Record<string, unknown> = {}) => ({
  itemId,
  locationId: godownId,
  adjustmentDate: new Date().toISOString(),
  quantityAdjusted: 5,
  costPrice: 100,
  reason: 'found',
  ...extra,
});

const as = (bearer: string) => ({
  get: (path: string) => request(createApp()).get(path).set('Authorization', `Bearer ${bearer}`),
  post: (path: string, payload: unknown) =>
    request(createApp())
      .post(path)
      .set('Authorization', `Bearer ${bearer}`)
      .send(payload as object),
  delete: (path: string) =>
    request(createApp()).delete(path).set('Authorization', `Bearer ${bearer}`),
});

const countIn = (orgId: string) =>
  runAsTenant(orgId, (tx) => tx.stockAdjustment.count({ where: { organizationId: orgId } }));

beforeAll(async () => {
  orgA = await createTestOrganization('adj-http-a');
  orgB = await createTestOrganization('adj-http-b');

  token.owner = await join(await makeUser('owner'), orgA, { isOwner: true });
  token.none = await join(await makeUser('none'), orgA, { permissions: [] });
  token.readOnly = await join(await makeUser('read'), orgA, {
    permissions: ['stock_adjustment:read'],
  });
  token.createOnly = await join(await makeUser('create'), orgA, {
    permissions: ['stock_adjustment:create'],
  });
  // A real member — and owner — of ANOTHER organization.
  token.outsider = await join(await makeUser('outsider'), orgB, { isOwner: true });

  await runAsTenant(orgA, async (tx) => {
    const uom = await tx.unitOfMeasurement.create({
      data: { organizationId: orgA, unitName: 'Metre', symbol: 'MTR' },
      select: { id: true },
    });
    godownId = (
      await tx.location.create({
        data: { organizationId: orgA, name: 'Main Godown', type: 'godown' },
        select: { id: true },
      })
    ).id;
    itemId = (
      await tx.item.create({
        data: {
          organizationId: orgA,
          name: `Adj http ${unique()}`,
          sku: `ADJH-${unique()}`,
          unit: 'Metre',
          stockingUomId: uom.id,
          itemType: 'goods',
          trackInventory: true,
          inventoryTracking: 'none',
        },
        select: { id: true },
      })
    ).id;
  });
});

afterAll(async () => {
  if (orgA) {
    await runAsTenant(orgA, async (tx) => {
      await tx.stockAdjustmentBatch.deleteMany({ where: { organizationId: orgA } });
      await tx.stockAdjustment.deleteMany({ where: { organizationId: orgA } });
      await tx.stockLedgerEntry.deleteMany({ where: { organizationId: orgA } });
      await tx.batch.deleteMany({ where: { organizationId: orgA } });
      await tx.item.deleteMany({ where: { organizationId: orgA } });
      await tx.location.deleteMany({ where: { organizationId: orgA } });
      await tx.unitOfMeasurement.deleteMany({ where: { organizationId: orgA } });
      await tx.numberSequence.deleteMany({ where: { organizationId: orgA } });
    });
  }
  if (userIds.length) await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  for (const orgId of [orgA, orgB]) {
    if (!orgId) continue;
    await runAsTenant(orgId, (tx) =>
      tx.permissionTemplate.deleteMany({ where: { organizationId: orgId } }),
    );
    await deleteTestOrganization(orgId);
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe('stock adjustments — HTTP', { timeout: 60_000 }, () => {
  let adjustmentId: string;

  it('an owner creates, lists and reads one, in the envelope', async () => {
    const created = await as(token.owner).post(url(orgA), body());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ statusCode: 201, message: 'Stock adjusted.' });
    adjustmentId = created.body.data.id;
    expect(created.body.data.adjustmentNumber).toMatch(/^ADJ-\d{5}$/);
    expect(created.body.data.organizationId).toBe(orgA);

    const list = await as(token.owner).get(url(orgA));
    expect(list.status).toBe(200);
    expect(list.body.data.results.map((row: { id: string }) => row.id)).toContain(adjustmentId);
    expect(list.body.data.pageContext).toBeDefined();
    expect(list.body.data.count).toBeUndefined();
    expect((await as(token.owner).get(`${url(orgA)}?count=true`)).body.data.count).toBe(1);

    const one = await as(token.owner).get(url(orgA, adjustmentId));
    expect(one.status).toBe(200);
    expect(one.body.data.batches).toHaveLength(1);
  });

  it('a bad body is a 400 with field details, and posts nothing', async () => {
    const before = await countIn(orgA);
    const res = await as(token.owner).post(
      url(orgA),
      body({ quantityAdjusted: 0, reason: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.data).toBeNull();
    expect(Object.keys(res.body.details)).toEqual(
      expect.arrayContaining(['quantityAdjusted', 'reason']),
    );
    expect(await countIn(orgA)).toBe(before);
  });

  it('an id that is not a uuid is a 404, not a 500', async () => {
    expect((await as(token.owner).get(url(orgA, 'not-a-uuid'))).status).toBe(404);
    expect((await as(token.owner).delete(url(orgA, 'not-a-uuid'))).status).toBe(404);
  });

  it('no token is refused', async () => {
    expect((await request(createApp()).get(url(orgA))).status).toBe(401);
  });

  describe('tenant isolation', () => {
    it('a member of another organization cannot reach this one by its URL', async () => {
      const before = await countIn(orgA);

      expect((await as(token.outsider).get(url(orgA))).status).toBe(403);
      expect((await as(token.outsider).get(url(orgA, adjustmentId))).status).toBe(403);
      expect((await as(token.outsider).post(url(orgA), body())).status).toBe(403);
      expect((await as(token.outsider).delete(url(orgA, adjustmentId))).status).toBe(403);

      expect(await countIn(orgA)).toBe(before);
    });

    it('nor by asking their OWN organization for the other one’s adjustment', async () => {
      // The outsider owns org B, so every gate passes — only the query's own
      // tenant scope (and RLS under it) stands between them and org A's row.
      expect((await as(token.outsider).get(url(orgB, adjustmentId))).status).toBe(404);
      expect((await as(token.outsider).delete(url(orgB, adjustmentId))).status).toBe(404);
      expect((await as(token.outsider).get(url(orgB))).body.data.results).toEqual([]);

      // Another organization's item and location are not theirs to adjust either.
      const res = await as(token.outsider).post(url(orgB), body());
      expect(res.status).toBe(404);
      expect(await countIn(orgB)).toBe(0);

      const still = await as(token.owner).get(url(orgA, adjustmentId));
      expect(still.body.data.status).toBe('adjusted');
    });
  });

  describe('permissions', () => {
    it('a member with no permissions is refused on every route', async () => {
      const before = await countIn(orgA);
      expect((await as(token.none).get(url(orgA))).status).toBe(403);
      expect((await as(token.none).get(url(orgA, adjustmentId))).status).toBe(403);
      expect((await as(token.none).post(url(orgA), body())).status).toBe(403);
      expect((await as(token.none).delete(url(orgA, adjustmentId))).status).toBe(403);
      expect(await countIn(orgA)).toBe(before);
    });

    it('read-only may read, and neither create nor cancel', async () => {
      const before = await countIn(orgA);
      expect((await as(token.readOnly).get(url(orgA))).status).toBe(200);
      expect((await as(token.readOnly).get(url(orgA, adjustmentId))).status).toBe(200);
      expect((await as(token.readOnly).post(url(orgA), body())).status).toBe(403);
      expect((await as(token.readOnly).delete(url(orgA, adjustmentId))).status).toBe(403);
      expect(await countIn(orgA)).toBe(before);
    });

    it('create implies read, and still may not cancel', async () => {
      expect((await as(token.createOnly).get(url(orgA))).status).toBe(200);
      expect((await as(token.createOnly).delete(url(orgA, adjustmentId))).status).toBe(403);
      const still = await as(token.owner).get(url(orgA, adjustmentId));
      expect(still.body.data.status).toBe('adjusted');
    });
  });

  it('an owner cancels it, and it stays listed as cancelled', async () => {
    const res = await as(token.owner).delete(url(orgA, adjustmentId));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');

    const list = await as(token.owner).get(url(orgA));
    const row = list.body.data.results.find((one: { id: string }) => one.id === adjustmentId);
    expect(row?.status).toBe('cancelled');

    expect((await as(token.owner).delete(url(orgA, adjustmentId))).status).toBe(409);
  });
});
