import { Prisma } from '../../../generated/prisma/client.ts';
import { prisma } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import { signAccessToken } from '../../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import type { LoginInput, SignupInput } from './auth.schemas.ts';
import type { AuthResponse, PublicUser } from './auth.types.ts';

/** Postgres unique-constraint violation, surfaced by Prisma. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * The columns safe to return. `passwordHash` is opted into explicitly, and
 * only by `login`.
 */
const publicUserSelect = { id: true, name: true, email: true } as const;

/**
 * A valid argon2id hash of a value nobody knows, verified against whenever the
 * email doesn't exist. Without it, "no such user" returns in ~1 ms while "wrong
 * password" takes ~50 ms of hashing — a timing difference that lets an attacker
 * enumerate which email addresses have accounts.
 */
let decoyHash: Promise<string> | undefined;
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword('a-password-that-is-never-correct');
  return decoyHash;
}

/**
 * Create a user. Nothing else.
 *
 * Deliberately does NOT create an organization: that is the next step, and a
 * user must be able to exist before one (they may be invited into someone
 * else's organization instead of founding their own).
 */
export async function signup(input: SignupInput): Promise<AuthResponse> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUserSelect,
    });

    return toAuthResponse(user);
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

export async function login(input: LoginInput): Promise<AuthResponse> {
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

  return toAuthResponse({ id: user.id, name: user.name, email: user.email });
}

/** Backs `GET /auth/me` — resolves the token's subject to a user. */
export async function getUserById(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    // The token is validly signed but its user is gone (deleted mid-session).
    throw new ApiError(401, 'Your session is no longer valid. Please sign in again.');
  }

  return user;
}

function toAuthResponse(user: PublicUser): AuthResponse {
  return { accessToken: signAccessToken(user.id), user };
}
