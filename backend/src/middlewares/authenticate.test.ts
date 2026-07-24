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

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    // `authenticate` lets them through — it never asks the database. `/auth/me`
    // then 401s only because `getUserById` filters on ACTIVE_USER; a route that
    // does not happen to re-read the user would serve them normally for 15m.
    const res = await request(createApp()).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe('refresh — the only place an account is re-examined', () => {
  it('rotates for a healthy account', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);

    const result = await authService.refresh(refreshToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.user.id).toBe(user.id);
  });

  it('refuses a deactivated account and revokes every session', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(authService.refresh(refreshToken)).rejects.toMatchObject({ status: 403 });

    const left = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(left, 'sessions must be revoked, not left to expire').toBe(0);
  });

  it('refuses a soft-deleted account', async () => {
    const user = await makeUser();
    const refreshToken = await issueRefreshToken(user.id);
    // The flag `refresh` did not check before 2026-07-24 — a soft-deleted user
    // rotated tokens indefinitely.
    await prisma.user.update({ where: { id: user.id }, data: { isDeleted: true } });

    await expect(authService.refresh(refreshToken)).rejects.toMatchObject({ status: 403 });
  });

  it('treats a validly signed token that is not in the database as theft', async () => {
    const user = await makeUser();
    const live = await issueRefreshToken(user.id);

    // NOT `signRefreshToken(user.id)`: its payload is `{}` + `sub` + a
    // second-resolution `iat`, so calling it twice inside the same second
    // returns a byte-identical token — which would find `live` and rotate
    // happily. `jwtid` forces a distinct string with a valid signature.
    const orphan = jwt.sign({}, env.jwt.refreshSecret, {
      subject: user.id,
      expiresIn: '7d',
      jwtid: 'orphan',
    });

    await expect(authService.refresh(orphan)).rejects.toMatchObject({ status: 401 });

    // Reuse detection must nuke every session for the user, including the live one.
    const left = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(left, 'reuse detection must revoke all sessions').toBe(0);
    expect(live).toBeTruthy();
  });
});
