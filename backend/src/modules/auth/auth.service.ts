import { Prisma } from '../../../generated/prisma/client.ts';
import { prisma } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import { ACTIVE_USER, isUsableAccount, revokeUserSessions } from '../../lib/authGuards.ts';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from '../../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import type { LoginInput, SignupInput, ResetPasswordInput, ChangePasswordInput } from './auth.schemas.ts';
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
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://') || avatarUrl.startsWith('data:')) {
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

export async function uploadAvatar(
  userId: string,
  file: Express.Multer.File,
): Promise<PublicUser> {
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

    return await issueTokens(await formatPublicUser(user));
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

  return await issueTokens(await formatPublicUser(updatedUser));
}

/**
 * Shared helper to generate and store tokens. Exported so the invitation-accept
 * flow can sign a brand-new invited user straight in after they set a password.
 */
export async function issueTokens(user: PublicUser): Promise<AuthResult> {
  const refreshToken = signRefreshToken(user.id);
  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshTtl as ms.StringValue));

  // Create the session row first: its id becomes the access token's `sid`,
  // so logout can find and delete this exact session by primary key.
  const session = await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
    select: { id: true },
  });

  const accessToken = signAccessToken(user.id, session.id);

  return { accessToken, refreshToken, user };
}

export async function refresh(oldRefreshToken: string): Promise<AuthResult> {
  // ✅ 1. Verify JWT signature and expiry FIRST
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(oldRefreshToken); // throws if invalid/expired
  } catch (_error) {
    // Token is tampered or expired — also clean it up from DB if it exists
    await prisma.refreshToken.deleteMany({ where: { token: oldRefreshToken } }).catch(() => {});
    throw new ApiError(401, 'Invalid or expired refresh token.');
  }

  // ✅ 2. Check if it exists in DB (reuse/revocation check)
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: oldRefreshToken },
    include: { user: { select: { ...publicUserSelect, isActive: true, isDeleted: true } } },
  });

  if (!storedToken) {
    // Token had valid JWT signature but isn't in DB anymore —
    // classic sign of token reuse/theft. Revoke ALL tokens for this user.
    await prisma.refreshToken.deleteMany({ where: { userId: payload.sub } }).catch(() => {});
    throw new ApiError(401, 'Invalid refresh token. All sessions have been revoked for security.');
  }

  // ✅ 3. Cross-check: JWT payload userId must match the DB record's userId
  if (storedToken.userId !== payload.sub) {
    await prisma.refreshToken.deleteMany({ where: { userId: payload.sub } }).catch(() => {});
    throw new ApiError(401, 'Token mismatch detected.');
  }

  // DB expiry check (defense in depth, JWT already checked this)
  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { token: oldRefreshToken } }).catch(() => {});
    throw new ApiError(401, 'Refresh token has expired.');
  }

  // Same predicate as `login` and as `authenticate`'s session join, so a
  // deactivated or soft-deleted user cannot keep rotating tokens indefinitely.
  if (!isUsableAccount(storedToken.user)) {
    await revokeUserSessions(payload.sub).catch(() => {});
    throw new ApiError(403, 'This account has been disabled.');
  }

  // ✅ 4. Rotation — do delete + create atomically inside a transaction
  const publicUser = await formatPublicUser(storedToken.user);

  const newRefreshToken = signRefreshToken(publicUser.id);
  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshTtl as ms.StringValue));

  // Rotate atomically. The freshly created row's id is the new session's `sid`,
  // so the rotated access token points at the row that now backs this device.
  const [, newSession] = await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { token: oldRefreshToken } }),
    prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: publicUser.id,
        expiresAt,
      },
      select: { id: true },
    }),
  ]);

  const accessToken = signAccessToken(publicUser.id, newSession.id);

  return { accessToken, refreshToken: newRefreshToken, user: publicUser };
}

/**
 * End one device's session. `sessionId` is the `sid` claim carried in the
 * access token (the `refresh_tokens` row id), so we delete exactly that row and
 * leave the user's other devices logged in. `catch` swallows the case where the
 * row is already gone (double logout, or the session was rotated meanwhile).
 */
export async function logout(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await prisma.refreshToken.delete({ where: { id: sessionId } }).catch(() => {});
}

/**
 * Fallback used when the client presents no access token at logout: end the
 * session identified by the refresh token itself (from the httpOnly cookie).
 */
export async function logoutByToken(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await prisma.refreshToken.delete({ where: { token: refreshToken } }).catch(() => {});
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

    // 2. Invalidate all existing sessions — in the same transaction as the
    //    credential change, so no session can outlive the password it was
    //    established with. `authenticate` refuses them from the next request on.
    await revokeUserSessions(user.id, tx);

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

