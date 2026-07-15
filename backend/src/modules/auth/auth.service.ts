import { Prisma } from '../../../generated/prisma/client.ts';
import { prisma } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from '../../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import type { LoginInput, SignupInput, ResetPasswordInput } from './auth.schemas.ts';
import { sendOtpEmail } from '../../lib/mailer.ts';
import type { AuthResult, PublicUser } from './auth.types.ts';
import { env } from '../../config/env.ts';
import ms from 'ms';

/** Postgres unique-constraint violation, surfaced by Prisma. */
const UNIQUE_VIOLATION = 'P2002';

const publicUserSelect = { id: true, name: true, email: true } as const;

let decoyHash: Promise<string> | undefined;
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword('a-password-that-is-never-correct');
  return decoyHash;
}

export async function signup(input: SignupInput): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUserSelect,
    });

    return await issueTokens(user);
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

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true, isActive: true },
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

  // Checked after the password so a disabled account can't be distinguished
  // from a wrong password by anyone who doesn't already know the password.
  if (!user.isActive) {
    throw new ApiError(403, 'This account has been disabled.');
  }

  return await issueTokens({ id: user.id, name: user.name, email: user.email });
}

/**
 * Shared helper to generate and store tokens.
 */
async function issueTokens(user: PublicUser): Promise<AuthResult> {
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
    include: { user: { select: { ...publicUserSelect, isActive: true } } },
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

  if (!storedToken.user.isActive) {
    throw new ApiError(403, 'This account has been disabled.');
  }

  // ✅ 4. Rotation — do delete + create atomically inside a transaction
  const publicUser = {
    id: storedToken.user.id,
    name: storedToken.user.name,
    email: storedToken.user.email,
  };

  const newRefreshToken = signRefreshToken(publicUser.id);
  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshTtl as ms.StringValue));

  // Rotate atomically. The freshly created row's id is the new session's `sid`,
  // so the rotated access token points at the row that now backs this device.
  const [, newSession] = await prisma.$transaction([
    prisma.refreshToken.delete({ where: { token: oldRefreshToken } }),
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
  }

  return user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // Silent failure to prevent email enumeration

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
    await tx.user.update({
      where: { email: input.email },
      data: { passwordHash },
    });

    // 2. Invalidate all existing sessions
    await tx.refreshToken.deleteMany({
      where: { user: { email: input.email } },
    });

    // 3. Delete the used OTP token
    await tx.passwordResetToken.delete({ where: { id: token.id } });
  });
}
