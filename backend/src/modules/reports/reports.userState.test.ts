import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.ts';
import { prisma, runAsTenant } from '../../db/prisma.ts';
import { createTestOrganization, deleteTestOrganization } from '../../db/testTenant.ts';
import { signAccessToken } from '../../lib/jwt.ts';
import { REPORTS } from './reports.catalog.ts';
import { listReports, recordReportVisit, setReportFavorite } from './reports.service.ts';

/**
 * Last visited + favourite are per USER and per ORGANIZATION. Every row here is
 * created by this file and hard-deleted afterwards — suites share the dev
 * database and run in parallel.
 */

const unique = process.hrtime.bigint().toString(36);

let orgAId: string | undefined;
let orgBId: string | undefined;
let userId = '';
let otherUserId = '';

async function makeUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `report-state-${label}-${unique}@example.invalid`, userAgent: 'unknown' },
    select: { id: true },
  });
  return user.id;
}

function entry(rows: Awaited<ReturnType<typeof listReports>>, key: string) {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`${key} missing from the list`);
  return row;
}

beforeAll(async () => {
  orgAId = await createTestOrganization('report-state-a');
  orgBId = await createTestOrganization('report-state-b');
  userId = await makeUser('subject');
  otherUserId = await makeUser('other');

  // Owner → every permission; the other user is a member with no template → none.
  // Both cascade away with the organization.
  await prisma.membership.createMany({
    data: [
      {
        userId,
        organizationId: orgAId,
        firstName: 'Owner',
        lastName: 'A',
        fullName: 'Owner A',
        isOwner: true,
      },
      {
        userId: otherUserId,
        organizationId: orgAId,
        firstName: 'Plain',
        lastName: 'A',
        fullName: 'Plain A',
      },
    ],
  });
});

afterAll(async () => {
  // report_user_states cascades from both organization and user.
  await deleteTestOrganization(orgAId);
  await deleteTestOrganization(orgBId);
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
});

describe('report user state', () => {
  it('lists every catalog report, unvisited and unstarred, before any activity', async () => {
    const rows = await listReports(orgAId!, userId);
    expect(rows.map((r) => r.key)).toEqual(REPORTS.map((r) => r.key));
    for (const row of rows) {
      expect(row.lastVisitedAt).toBeNull();
      expect(row.isFavorite).toBe(false);
    }
  });

  it('records a visit with the server clock, and a second visit moves it forward', async () => {
    const before = Date.now();
    const first = await recordReportVisit(orgAId!, userId, 'fifo_cost_lot_tracking');
    expect(first.lastVisitedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const second = await recordReportVisit(orgAId!, userId, 'fifo_cost_lot_tracking');
    expect(second.lastVisitedAt!.getTime()).toBeGreaterThanOrEqual(first.lastVisitedAt!.getTime());

    const rows = await listReports(orgAId!, userId);
    expect(entry(rows, 'fifo_cost_lot_tracking').lastVisitedAt).toEqual(second.lastVisitedAt);
    expect(entry(rows, 'stock_summary').lastVisitedAt).toBeNull();

    // Still one row — the upsert keys on (user, org, report).
    const count = await runAsTenant(orgAId!, (tx) =>
      tx.reportUserState.count({ where: { userId, reportKey: 'fifo_cost_lot_tracking' } }),
    );
    expect(count).toBe(1);
  });

  it('a visit and a favourite live on the same row without overwriting each other', async () => {
    await recordReportVisit(orgAId!, userId, 'stock_summary');
    await setReportFavorite(orgAId!, userId, 'stock_summary', true);

    let row = entry(await listReports(orgAId!, userId), 'stock_summary');
    expect(row.isFavorite).toBe(true);
    expect(row.lastVisitedAt).not.toBeNull();

    await setReportFavorite(orgAId!, userId, 'stock_summary', false);
    row = entry(await listReports(orgAId!, userId), 'stock_summary');
    expect(row.isFavorite).toBe(false);
    expect(row.lastVisitedAt).not.toBeNull();
  });

  it('is per user — another member of the same organization sees none of it', async () => {
    await setReportFavorite(orgAId!, userId, 'inventory_valuation_summary', true);
    const rows = await listReports(orgAId!, otherUserId);
    for (const row of rows) {
      expect(row.lastVisitedAt).toBeNull();
      expect(row.isFavorite).toBe(false);
    }
  });

  it('is per organization — the same user in another organization starts clean', async () => {
    const rows = await listReports(orgBId!, userId);
    for (const row of rows) {
      expect(row.lastVisitedAt).toBeNull();
      expect(row.isFavorite).toBe(false);
    }
  });

  it('ignores a stored key that is no longer in the catalog', async () => {
    await runAsTenant(orgAId!, (tx) =>
      tx.reportUserState.create({
        data: { organizationId: orgAId!, userId, reportKey: 'retired_report', isFavorite: true },
      }),
    );
    const rows = await listReports(orgAId!, userId);
    expect(rows.map((r) => r.key)).toEqual(REPORTS.map((r) => r.key));
  });
});

describe('report user state — HTTP', () => {
  const url = (orgId: string, rest = '') => `/api/organizations/${orgId}/reports${rest}`;
  const auth = (uid: string) => `Bearer ${signAccessToken(uid, 'session-for-test')}`;

  it('records a visit and returns it in the list, inside the envelope', async () => {
    const app = createApp();
    const visit = await request(app)
      .post(url(orgAId!, '/inventory_valuation_summary/visit'))
      .set('Authorization', auth(userId));
    expect(visit.status).toBe(200);
    expect(visit.body.data.reportKey).toBe('inventory_valuation_summary');

    const list = await request(app).get(url(orgAId!)).set('Authorization', auth(userId));
    expect(list.status).toBe(200);
    const row = list.body.data.find(
      (r: { key: string }) => r.key === 'inventory_valuation_summary',
    );
    expect(row.lastVisitedAt).toBe(visit.body.data.lastVisitedAt);
    expect(row.path).toBe('inventory-valuation-summary');
  });

  it('sets a favourite through the API', async () => {
    const res = await request(createApp())
      .put(url(orgAId!, '/fifo_cost_lot_tracking/favorite'))
      .set('Authorization', auth(userId))
      .send({ isFavorite: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isFavorite).toBe(true);
  });

  it('rejects a report key that is not in the catalog with 400, writing nothing', async () => {
    const res = await request(createApp())
      .post(url(orgAId!, '/no_such_report/visit'))
      .set('Authorization', auth(userId));
    expect(res.status).toBe(400);
    const count = await runAsTenant(orgAId!, (tx) =>
      tx.reportUserState.count({ where: { reportKey: 'no_such_report' } }),
    );
    expect(count).toBe(0);
  });

  it('rejects a favourite body that is not a boolean', async () => {
    const res = await request(createApp())
      .put(url(orgAId!, '/stock_summary/favorite'))
      .set('Authorization', auth(userId))
      .send({ isFavorite: 'yes' });
    expect(res.status).toBe(400);
  });

  it('is gated on reports:read — a member without it gets 403', async () => {
    const res = await request(createApp())
      .get(url(orgAId!))
      .set('Authorization', auth(otherUserId));
    expect(res.status).toBe(403);
  });

  it('does not shadow the individual report endpoints mounted under /reports/*', async () => {
    const res = await request(createApp())
      .get(url(orgAId!, '/stock-summary'))
      .set('Authorization', auth(userId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.results)).toBe(true);
  });

  it('refuses an organization the caller is not a member of', async () => {
    const res = await request(createApp()).get(url(orgBId!)).set('Authorization', auth(userId));
    expect(res.status).toBe(403);
  });
});
