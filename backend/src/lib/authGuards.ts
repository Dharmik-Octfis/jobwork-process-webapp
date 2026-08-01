import { Prisma } from '../../generated/prisma/client.ts';
import { prisma } from '../db/prisma.ts';

/**
 * The single definition of "an account that may currently use the API".
 *
 * Two independent flags mean two chances to check only one. Before this existed,
 * `login` and `refresh` each checked `isActive` and neither checked `isDeleted`,
 * so soft-deleting a user did nothing at all: they kept logging in and kept
 * rotating tokens forever. Import this instead of spelling the condition out —
 * a third flag later then lands everywhere at once.
 *
 * 🔴 `authenticate` does NOT apply this — it is a signature check with no
 * database access (see its header). The only places an account's standing is
 * ever re-examined are `login` and `refresh`, so those two are the whole
 * enforcement surface: weaken either and a disabled account keeps working
 * indefinitely rather than for one access-token lifetime.
 */
export const ACTIVE_USER = { isActive: true, isDeleted: false } as const;

/** The flags a caller must `select` before it can ask `isUsableAccount`. */
export type AccountFlags = Record<keyof typeof ACTIVE_USER, boolean>;

/**
 * `ACTIVE_USER` applied to a row already in hand, for the paths that cannot put
 * it in the `where` — `login` deliberately reads the user *before* checking the
 * password, so a disabled account is indistinguishable from a wrong one.
 *
 * Derived from the constant rather than restating it: adding a flag to
 * `ACTIVE_USER` widens `AccountFlags`, which fails the typecheck at every call
 * site whose `select` does not yet include it.
 */
export function isUsableAccount(user: AccountFlags): boolean {
  return (Object.keys(ACTIVE_USER) as (keyof typeof ACTIVE_USER)[]).every(
    (key) => user[key] === ACTIVE_USER[key],
  );
}

/** Why a session ended. Stored on the row, and read by session reporting. */
export type RevokeReason =
  'logout' | 'expired' | 'password_reset' | 'account_disabled' | 'token_mismatch';

/**
 * End every live session this user holds, on every device.
 *
 * 🔴 Call this in the same transaction as any write that flips `isActive` to
 * false or `isDeleted` to true on a `User`. `onDelete: Cascade` on
 * `refresh_tokens.user_id` only fires on a hard delete, and this codebase
 * soft-deletes everywhere — so without this the rows survive their owner.
 *
 * Because `authenticate` never reads the database, this is the *only* thing that
 * shortens a disabled user's remaining access — and even then only from their
 * next refresh, not their next request. Their current access token keeps working
 * until it expires regardless.
 *
 * 🔴 This stamps `revoked_at`; it does NOT delete. The row is the login record —
 * destroying it on logout would erase the history the table now exists to keep.
 * `revokedAt: null` in the `where` is what stops a re-revoke from overwriting the
 * original reason and timestamp of a session that already ended.
 */
export async function revokeUserSessions(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  reason: RevokeReason = 'account_disabled',
): Promise<void> {
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
