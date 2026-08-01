import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { createApp } from '../app.ts';
import { env } from '../config/env.ts';
import { prisma } from '../db/prisma.ts';
import { signAccessToken, signRefreshToken } from '../lib/jwt.ts';
import * as authService from '../modules/auth/auth.service.ts';

/**
 * What `authenticate` does, and — just as importantly — what it deliberately
 * does NOT do.
 *
 * On 2026-07-24 the session lookup was removed from the request path for query
 * throughput, making `authenticate` a pure signature check again. The cost is a
 * window of up to `JWT_ACCESS_TTL` (15m) in which a deactivated, soft-deleted or
 * logged-out user's access token still works. That is an accepted trade, not a
 * defect — so it is pinned here rather than left to be rediscovered in
 * production. The "still passes" cases below are the shape of that trade.
 *
 * Because the request path no longer checks, `auth.service.refresh` is the whole
 * enforcement surface, and the second describe block guards it. If those tests
 * ever go red, a disabled account can use the API **forever**, not for 15
 * minutes — that is the failure mode this file exists to catch.
 *
 * 🔴 Every user here is created by this file and hard-deleted afterwards. These
 * suites run against the dev database *in parallel with each other*, so a test
 * that flips `isActive` on a user it merely *found* will break whatever the
 * vendors or items suite is doing with that same user at that moment.
 */
const ME = '/api/auth/me';

const created: string[] = [];

async function makeUser(flags: { isActive?: boolean; isDeleted?: boolean } = {}) {
  const unique = process.hrtime.bigint().toString(36);
  const user = await prisma.user.create({
    data: {
      email: `authenticate-test-${unique}@example.invalid`,
      firstName: 'Session',
      lastName: 'Probe',
      fullName: 'Session Probe',
      userAgent: 'unknown',
      ...flags,
    },
    select: { id: true },
  });
  created.push(user.id);
  return user;
}

/** A refresh token plus the `refresh_tokens` row that backs it, as `login` would. */
async function issueRefreshToken(userId: string) {
  const token = signRefreshToken(userId);
  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + ms(env.jwt.refreshTtl as ms.StringValue)),
    },
  });
  return token;
}

afterAll(async () => {
  // Hard delete — `refresh_tokens.user_id` cascades, so sessions go with them.
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe('authenticate — signature only', () => {
  it('accepts a validly signed, unexpired token', async () => {
    const user = await makeUser();
    const token = signAccessToken(user.id, 'any-session-id');

    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('rejects a missing Authorization header', async () => {
    const res = await request(createApp()).get(ME);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const user = await makeUser();
    const forged = jwt.sign({ sid: 'any-session-id' }, 'not-the-access-secret', {
      subject: user.id,
      expiresIn: '15m',
    });

    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const user = await makeUser();
    const expired = jwt.sign({ sid: 'any-session-id' }, env.jwt.accessSecret, {
      subject: user.id,
      expiresIn: '-1s',
    });

    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
  });

  it('ACCEPTED TRADE: a token whose session row never existed still passes', async () => {
    const user = await makeUser();
    // `sid` is a claim, never resolved against `refresh_tokens` on this path —
    // which is also why logout cannot take effect before the token expires.
    const token = signAccessToken(user.id, 'no-such-session');

    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('ACCEPTED TRADE: a deactivated user keeps working until the token expires', async () => {
    const user = await makeUser();
    const token = signAccessToken(user.id, 'any-session-id');

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
      select: { id: true },
    });

    // `authenticate` lets them through — it never asks the database. `/auth/me`
    // then 401s only because `getUserById` filters on ACTIVE_USER; a route that
    // does not happen to re-read the user would serve them normally for 15m.
    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe('refresh — the only place an account is re-examined', () => {
  it('returns a new access token and the SAME refresh token', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);

    const result = await authService.refresh(refreshToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.user.id).toBe(user.id);
    expect(result.refreshToken, 'the refresh token must NOT rotate').toBe(refreshToken);
  });

  /**
   * 🔴 The regression this whole change exists to prevent.
   *
   * While tokens rotated, the server destroyed the presented token before the
   * browser could receive its replacement — so any interrupted response (reload,
   * dropped wifi, closed lid) left the browser holding a dead token. The next
   * attempt was read as theft and deleted EVERY session the user had, on every
   * device. Reproduced against a live server on 2026-07-31.
   *
   * Not rotating is what makes the same token work twice. If this test ever goes
   * red, someone has reintroduced rotation and users are being logged out at
   * random again.
   */
  it('accepts the same token twice — a lost response must not end the session', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);

    const first = await authService.refresh(refreshToken);
    const second = await authService.refresh(refreshToken);

    expect(first.accessToken).toBeTruthy();
    expect(second.accessToken).toBeTruthy();

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live, 'the session must still be live').toBe(1);
  });

  it('does not touch a second device when one session is rejected', async () => {
    const user = await makeUser();
    const phone = await issueRefreshToken(user.id);

    // A validly signed token with no row — the case that used to nuke everything.
    const orphan = jwt.sign({}, env.jwt.refreshSecret, {
      subject: user.id,
      expiresIn: '7d',
      jwtid: 'orphan',
    });

    await expect(authService.refresh(orphan)).rejects.toMatchObject({ status: 401 });

    // The other device is untouched, and still works.
    const stillLive = await authService.refresh(phone);
    expect(stillLive.accessToken).toBeTruthy();
  });

  it('refuses a session that was logged out, and keeps the row', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    const session = await prisma.refreshToken.findUniqueOrThrow({
      where: { token: refreshToken },
      select: { id: true },
    });

    await authService.logout(session.id);

    await expect(authService.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });

    const row = await prisma.refreshToken.findUniqueOrThrow({ where: { id: session.id } });
    expect(
      row.revokedAt,
      'logout must stamp, not delete — the row is the login record',
    ).not.toBeNull();
    expect(row.revokedReason).toBe('logout');
  });

  it('refuses a deactivated account and ends every session', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
      select: { id: true },
    });

    await expect(authService.refresh(refreshToken)).rejects.toMatchObject({ status: 403 });

    const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live, 'sessions must be revoked, not left to expire').toBe(0);

    const [row] = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(row?.revokedReason, 'and the history must survive the revocation').toBe(
      'account_disabled',
    );
  });

  it('refuses a soft-deleted account', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    // The flag `refresh` did not check before 2026-07-24 — a soft-deleted user
    // refreshed indefinitely.
    await prisma.user.update({
      where: { id: user.id },
      data: { isDeleted: true },
      select: { id: true },
    });

    await expect(authService.refresh(refreshToken)).rejects.toMatchObject({ status: 403 });
  });
});

describe('session records', () => {
  /**
   * `signRefreshToken` used to sign `{ sub, iat, exp }` and nothing else. `iat` is
   * second-resolution, so two tokens for one user in the same second came out
   * byte-identical and the second insert failed `refresh_tokens.token`'s unique
   * index — a 500 on a perfectly ordinary "log in on my phone too". `jti` is what
   * makes them distinct.
   */
  it('issues distinct tokens for two logins in the same second', async () => {
    const user = await makeUser();

    const [a, b] = await Promise.all([issueRefreshToken(user.id), issueRefreshToken(user.id)]);

    expect(a).not.toBe(b);
    const rows = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(rows, 'both logins must produce a session row').toBe(2);
  });

  it('keeps login time stable across refreshes, and records activity', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    const atLogin = await prisma.refreshToken.findUniqueOrThrow({
      where: { token: refreshToken },
      select: { id: true, createdAt: true, lastUsedAt: true },
    });
    expect(atLogin.lastUsedAt, 'never used yet').toBeNull();

    await authService.refresh(refreshToken);

    const afterUse = await prisma.refreshToken.findUniqueOrThrow({ where: { id: atLogin.id } });
    // This is the property the report depends on: `created_at` is the LOGIN, for
    // the life of the session. Under rotation it moved every 15 minutes, so a
    // user signed in since Monday looked like they signed in moments ago.
    expect(afterUse.createdAt.getTime()).toBe(atLogin.createdAt.getTime());
    expect(afterUse.lastUsedAt).not.toBeNull();
  });

  it("lists a user's sessions without leaking the token", async () => {
    const user = await makeUser();
    await issueRefreshToken(user.id);

    const sessions = await authService.listUserSessions(user.id);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).not.toHaveProperty('token');
    expect(sessions[0]?.createdAt).toBeInstanceOf(Date);
  });
});
