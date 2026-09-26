import type Provider from 'oidc-provider';
import { prisma } from '../db/prisma.ts';

/**
 * Mirror the provider's session into `sso_sessions` / `session_grants`.
 *
 * 🔴 These tables are a DURABLE RECORD, not the logout mechanism. It is worth being
 * exact about this, because §7.3's wording ("without it, logout has to notify every
 * registered app") reads as though back-channel logout depends on them. It does
 * not: `oidc-provider` sends logout tokens from its own Session's `authorizations`
 * map, entirely inside the library. What these tables add is what
 * `oidc_payloads` cannot give us — rows that survive the session they describe.
 *
 * That is the same reasoning as `refresh_tokens` in the app: the provider deletes
 * its Session row on logout, so "when did this person sign in, from what device,
 * how did the session end" has nowhere to live unless we keep it ourselves.
 *
 * 🔴 A failure here must never break a sign-in. Mirroring is reporting, and the
 * authentication path does not depend on it, so every listener swallows its own
 * errors after logging them. A login that succeeds with a missing report row is
 * strictly better than an outage; the log is how the gap gets noticed.
 */

/**
 * 🔴 Keyed on `session.uid`, never on `session.id`.
 *
 * They are different identifiers with different lifetimes. `id` aliases `jti`, and
 * `resetIdentifier()` rotates it — which the library does on a per-client logout,
 * where one app signs out but the browser stays signed in to the others. Keying
 * this table on `jti` would therefore orphan the row and start a second one every
 * time someone logs out of a single app, quietly turning one session's history into
 * several. `uid` is stable for the life of the browser session.
 */

/** Seconds-since-epoch, as the library stores expiry. */
function toDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000);
}

export function installSessionMirror(provider: Provider): void {
  provider.on('session.saved', (session) => {
    void mirrorSession(session).catch((err: unknown) => {
      console.error('session mirror: failed to record session', session.uid, err);
    });
  });

  provider.on('session.destroyed', (session) => {
    void revokeSession(session.uid).catch((err: unknown) => {
      console.error('session mirror: failed to record logout', session.uid, err);
    });
  });
}

async function mirrorSession(session: {
  uid: string;
  accountId?: string | undefined;
  exp?: number | undefined;
  authorizations?: Record<string, { sid?: string | undefined }> | undefined;
}): Promise<void> {
  // A session with no account is the anonymous one the library keeps while an
  // interaction is in flight. There is nothing to report until someone signs in.
  if (!session.accountId) return;

  const expiresAt = session.exp ? toDate(session.exp) : new Date(Date.now() + 14 * 864e5);

  await prisma.ssoSession.upsert({
    where: { id: session.uid },
    create: { id: session.uid, userId: session.accountId, expiresAt, lastUsedAt: new Date() },
    // `createdAt` is deliberately untouched: it is the real login time and must stay
    // stable for the life of the session, exactly like refresh_tokens.created_at.
    update: { expiresAt, lastUsedAt: new Date() },
  });

  // One grant row per app this browser has signed in to — and one `sid` each,
  // because the library issues a different sid per client so that two apps cannot
  // correlate the same user.
  for (const [clientId, authorization] of Object.entries(session.authorizations ?? {})) {
    const sid = authorization?.sid;
    if (!sid) continue;

    await prisma.sessionGrant.upsert({
      where: { sessionId_clientId: { sessionId: session.uid, clientId } },
      create: { sessionId: session.uid, clientId, sid },
      update: { sid },
    });
  }
}

/**
 * Stamp the session as ended. The row stays — same rule as `refresh_tokens`, and
 * the same reason: deleting it destroys the login history it exists to hold.
 *
 * ⚠️ `session.destroyed` fires on an explicit logout, not on expiry — nothing
 * sweeps a session that simply ran out, so those rows keep `revoked_at` null past
 * their `expires_at`. Any read of "live sessions" must therefore filter on BOTH
 * `revokedAt: null` and `expiresAt > now()`, not on `revokedAt` alone.
 */
async function revokeSession(uid: string): Promise<void> {
  await prisma.ssoSession.updateMany({
    where: { id: uid, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'logout' },
  });
}
