import { Prisma } from '../../../generated/prisma/client.ts';
import { prisma } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import {
  ACTIVE_USER,
  isUsableAccount,
  revokeUserSessions,
  type RevokeReason,
} from '../../lib/authGuards.ts';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from '../../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import type {
  LoginInput,
  SignupInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from './auth.schemas.ts';
import { sendOtpEmail } from '../../lib/mailer.ts';
import type { AuthResult, PublicUser } from './auth.types.ts';
import { env } from '../../config/env.ts';
import ms from 'ms';

import { uploadFile, getFileUrl } from '../../lib/storage.ts';

/** Postgres unique-constraint violation, surfaced by Prisma. */
const UNIQUE_VIOLATION = 'P2002';

const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  userAgent: true,
} as const;

async function resolveAvatarUrl(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl) return null;
  if (
    avatarUrl.startsWith('http://') ||
    avatarUrl.startsWith('https://') ||
    avatarUrl.startsWith('data:')
  ) {
    return avatarUrl;
  }
  try {
    return await getFileUrl(avatarUrl);
  } catch (err) {
    console.warn(`Failed to resolve signed URL for avatar key "${avatarUrl}":`, err);
    return avatarUrl;
  }
}

export async function formatPublicUser(user: {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  userAgent?: string | null;
}): Promise<PublicUser> {
  const signedAvatarUrl = await resolveAvatarUrl(user.avatarUrl);
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    avatar_url: signedAvatarUrl,
    userAgent: user.userAgent ?? 'unknown',
  };
}

export async function updateProfile(
  userId: string,
  input: { firstName: string; lastName: string },
): Promise<PublicUser> {
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  const user = await prisma.user.update({
    where: { id: userId },
    data: { firstName: input.firstName, lastName: input.lastName, fullName },
    select: publicUserSelect,
  });
  return await formatPublicUser(user);
}

export async function uploadAvatar(userId: string, file: Express.Multer.File): Promise<PublicUser> {
  const timestamp = Date.now();
  const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `users/${userId}/avatar-${timestamp}-${cleanName}`;

  let storedKey = key;
  try {
    await uploadFile({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      overwrite: true,
    });
  } catch (err) {
    console.warn('Catalyst Stratus avatar upload failed:', err);
    storedKey = key;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: storedKey },
    select: publicUserSelect,
  });

  return await formatPublicUser(updatedUser);
}

export async function deleteAvatar(userId: string): Promise<PublicUser> {
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: publicUserSelect,
  });

  return await formatPublicUser(updatedUser);
}

let decoyHash: Promise<string> | undefined;
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword('a-password-that-is-never-correct');
  return decoyHash;
}

export async function signup(input: SignupInput, userAgent: string): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  const fullName = `${input.firstName} ${input.lastName}`.trim();

  try {
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        fullName,
        email: input.email,
        passwordHash,
        userAgent,
      },
      select: publicUserSelect,
    });

    return await issueTokens(await formatPublicUser(user), { userAgent });
  } catch (error) {
    // Checking `findUnique` first would still race: two concurrent signups for
    // the same email both see "available", and one loses at the index. The
    // constraint is the only real guard, so we catch its violation.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      throw ApiError.conflict('An account with that email already exists.');
    }
    throw error;
  }
}

export async function login(input: LoginInput, userAgent: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true, isActive: true, isDeleted: true },
  });

  if (!user?.passwordHash) {
    // Burn the same time as a real verification before failing.
    await verifyPassword(await getDecoyHash(), input.password);
    throw ApiError.unauthorized();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  if (!passwordMatches) {
    throw ApiError.unauthorized();
  }

  // Persist the latest browser/device agent so account details stay current,
  // even for users created before this column was introduced.
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { userAgent: userAgent || 'unknown' },
    select: publicUserSelect,
  });

  // Checked after the password so a disabled account can't be distinguished
  // from a wrong password by anyone who doesn't already know the password.
  // Both flags, via the shared predicate — `isActive` alone used to let a
  // soft-deleted user log in normally.
  if (!isUsableAccount(user)) {
    throw new ApiError(403, 'This account has been disabled.');
  }

  return await issueTokens(await formatPublicUser(updatedUser), { userAgent });
}

/**
 * Where this session was started from. Recorded once, at login, because that is
 * the only moment the answer is meaningful — `users.user_agent` is overwritten on
 * every login and so can never say which of your three devices a session is.
 */
export interface SessionMeta {
  userAgent?: string | null;
}

/**
 * Shared helper to generate and store tokens. Exported so the invitation-accept
 * flow can sign a brand-new invited user straight in after they set a password.
 *
 * This is the ONLY place a `refresh_tokens` row is created. Since rotation was
 * removed, one row here means exactly one login, for the life of that session —
 * which is what makes `created_at` a login timestamp a report can trust.
 */
export async function issueTokens(user: PublicUser, meta: SessionMeta = {}): Promise<AuthResult> {
  const refreshToken = signRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshTtl as ms.StringValue));

  // Create the session row first: its id becomes the access token's `sid`,
  // so logout can find and end this exact session by primary key.
  const session = await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
      userAgent: meta.userAgent ?? null,
    },
    select: { id: true },
  });

  const accessToken = signAccessToken(user.id, session.id);

  return { accessToken, refreshToken, user, refreshTokenExpiresAt: expiresAt };
}

/**
 * Exchange a live refresh token for a new access token.
 *
 * 🔴 **The refresh token is NOT rotated** (changed 2026-07-31). The same token
 * goes back out, the same session row stays live, and only the short-lived access
 * token is new.
 *
 * Rotation was removed because it cannot be made correct across a network. The
 * old code deleted the presented token and created a replacement, then sent that
 * replacement in the response — so the database was already committed by the time
 * the browser had a chance to receive it. Any interrupted refresh (page reload,
 * dropped connection, closed lid) left the browser holding a token the server had
 * destroyed, and the next attempt landed in reuse detection, which deleted EVERY
 * session the user had. Reproduced 2026-07-31: replaying an already-rotated
 * cookie returned 401 and killed a second, healthy device's session too.
 *
 * The trade is explicit: a stolen refresh token now works until the session
 * expires or someone revokes it, instead of being caught the second time it is
 * used. Revocation is the mitigation — logout, password reset and deactivation
 * all end sessions immediately, and every one of them is checked right here.
 *
 * The other consequence of not rotating: a session's expiry is **absolute**. The
 * refresh JWT's `exp` is fixed when it is signed and cannot be extended without
 * issuing a new token (which would be rotation), so a session ends exactly
 * `JWT_REFRESH_TTL` after login however active the user is. The old code slid
 * that window forward on every refresh, which meant an active session never
 * ended at all.
 */
export async function refresh(refreshToken: string): Promise<AuthResult> {
  // 1. Verify the signature and expiry before touching the database.
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(refreshToken); // throws if invalid/expired
  } catch (_error) {
    // A genuine token that has simply aged out still has a row, and that row is
    // this login's record — so it is marked ended, never deleted. A tampered
    // token matches nothing and this is a no-op.
    await markSessionRevoked({ token: refreshToken }, 'expired');
    throw new ApiError(401, 'Invalid or expired refresh token.');
  }

  // 2. Resolve the session. `revokedAt: null` is load-bearing: it is what makes
  //    logout, password reset and deactivation take effect, now that the row
  //    survives them instead of being deleted.
  const session = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: { select: { ...publicUserSelect, isActive: true, isDeleted: true } } },
  });

  if (!session || session.revokedAt !== null) {
    // Unknown or already-ended session. Nothing is revoked here on purpose:
    // without rotation there is no legitimate way for a live session's token to
    // go missing, so there is no honest user to punish — and the blanket
    // `deleteMany WHERE userId` this replaced was exactly what logged people out
    // of every device on one dropped response.
    throw new ApiError(401, 'Your session has ended. Please sign in again.');
  }

  // 3. The row must belong to the subject the token names. Cannot happen through
  //    any code path here — `token` is unique and written alongside its user — so
  //    if it ever does, the row is not trustworthy and this one session ends.
  if (session.userId !== payload.sub) {
    await markSessionRevoked({ id: session.id }, 'token_mismatch');
    throw new ApiError(401, 'Token mismatch detected.');
  }

  // 4. Expiry, checked against the row as well as the JWT. Belt and braces: the
  //    two are written together, but only the row can be shortened by an admin.
  if (session.expiresAt < new Date()) {
    await markSessionRevoked({ id: session.id }, 'expired');
    throw new ApiError(401, 'Refresh token has expired.');
  }

  // 5. Same predicate as `login`. This and `login` are the whole enforcement
  //    surface for account standing, because `authenticate` never reads the
  //    database — so a deactivated user must lose every session here.
  if (!isUsableAccount(session.user)) {
    await revokeUserSessions(payload.sub, prisma, 'account_disabled').catch(() => {});
    throw new ApiError(403, 'This account has been disabled.');
  }

  const publicUser = await formatPublicUser(session.user);

  // 6. No rotation: stamp activity and hand back the SAME token. `sid` still
  //    names this row, so logout-by-`sid` and session reporting both keep
  //    pointing at the login this session actually started from.
  await prisma.refreshToken.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  const accessToken = signAccessToken(publicUser.id, session.id);

  return {
    accessToken,
    refreshToken,
    user: publicUser,
    refreshTokenExpiresAt: session.expiresAt,
  };
}

/**
 * End one session by stamping the row, never deleting it.
 *
 * `revokedAt: null` in the `where` keeps the FIRST ending authoritative — a
 * second logout, or an expiry check running against an already-revoked row, must
 * not overwrite why and when the session actually ended.
 *
 * Swallows its errors: every caller is already on a path that is failing the
 * request, and losing the bookkeeping must not turn a clean 401 into a 500.
 */
async function markSessionRevoked(
  where: { id: string } | { token: string },
  reason: RevokeReason,
): Promise<void> {
  await prisma.refreshToken
    .updateMany({
      where: { ...where, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch(() => {});
}

/**
 * End one device's session. `sessionId` is the `sid` claim carried in the access
 * token (the `refresh_tokens` row id), so we end exactly that row and leave the
 * user's other devices signed in.
 *
 * Stamps rather than deletes: the row is this login's record, and a report that
 * loses every session the moment someone signs out is not a report. `revoked_at`
 * is also what turns a logout into "session lasted 4h 12m".
 */
export async function logout(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await markSessionRevoked({ id: sessionId }, 'logout');
}

/**
 * Fallback used when the client presents no access token at logout: end the
 * session identified by the refresh token itself (from the httpOnly cookie).
 */
export async function logoutByToken(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await markSessionRevoked({ token: refreshToken }, 'logout');
}

/**
 * Every session this user has ever held, newest first — the login report.
 *
 * Reads the whole history, revoked rows included: that is the point of keeping
 * them. `lastUsedAt` minus `createdAt` is how long the session was actually in
 * use; a null `lastUsedAt` means they logged in and never came back.
 */
export async function listUserSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    // `token` is deliberately absent — it is a live credential, and this list is
    // the one place a session row would otherwise leave the server.
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      userAgent: true,
    },
  });
}

export async function getUserById(userId: string): Promise<PublicUser> {
  // `findFirst`, not `findUnique`: the `ACTIVE_USER` flags are not part of the
  // unique key. Without them a soft-deleted user still resolved here, so
  // `/auth/me` kept returning a profile for an account that no longer exists.
  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER },
    select: publicUserSelect,
  });

  if (!user) {
    throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
  }

  return await formatPublicUser(user);
}

export async function requestPasswordReset(email: string): Promise<void> {
  // A disabled or soft-deleted account gets no OTP — and, as with an unknown
  // address, no hint that it was refused. Silent to prevent email enumeration.
  const user = await prisma.user.findFirst({ where: { email, ...ACTIVE_USER } });
  if (!user) return;

  // Generate a random 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Upsert to only keep one active OTP per email
  await prisma.passwordResetToken.deleteMany({ where: { email } });
  await prisma.passwordResetToken.create({
    data: { email, otp, expiresAt },
  });

  await sendOtpEmail(email, otp);
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const token = await prisma.passwordResetToken.findFirst({
    where: { email: input.email, otp: input.otp },
  });

  if (!token) {
    throw new ApiError(400, 'Invalid or expired OTP.');
  }

  if (token.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: token.id } });
    throw new ApiError(400, 'OTP has expired. Please request a new one.');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    // 1. Update user password
    const user = await tx.user.update({
      where: { email: input.email },
      data: { passwordHash },
      select: { id: true },
    });

    // 2. End all existing sessions — in the same transaction as the credential
    //    change, so no session can outlive the password it was established with.
    //    The rows stay, stamped `password_reset`, so the report still shows those
    //    logins and why they ended.
    await revokeUserSessions(user.id, tx, 'password_reset');

    // 3. Delete the used OTP token
    await tx.passwordResetToken.delete({ where: { id: token.id } });
  });
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER },
    select: { id: true, passwordHash: true },
  });

  if (!user || !user.passwordHash) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const isValidPassword = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!isValidPassword) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash },
  });
}
