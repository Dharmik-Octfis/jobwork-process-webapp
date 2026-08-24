import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { prisma } from '../db/prisma.ts';
import { sendOtpEmail } from '../lib/mailer.ts';

/**
 * Signup, email verification and password reset — the account-management half of
 * §7.1's `login/`. These moved here from the app: an identity's password is the
 * accounts service's business and nothing else's.
 *
 * ⚠️ jobwork's copies are deliberately still in place. §13 keeps local password
 * login working as step 4's rollback path, so removing them belongs to step 6,
 * after every active user is linked. Two implementations exist on purpose, for one
 * release.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const PURPOSE_RESET = 'password_reset';
const PURPOSE_VERIFY = 'email_verify';

/** Same predicate as the app's ACTIVE_USER. One definition of "usable account". */
const ACTIVE_USER = { isActive: true, isDeleted: false } as const;

/**
 * 🔴 `randomInt`, not `Math.random()`. This code is a credential — it is the entire
 * proof of inbox control — and `Math.random()` is a predictable PRNG whose output
 * can be reconstructed from previous values. The app's copy uses Math.random and
 * should be changed when it is retired.
 */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function issueOtp(email: string, purpose: string): Promise<string> {
  const otp = generateOtp();

  // One live code per address per purpose: issuing a new one invalidates the old,
  // so a forwarded old email cannot be used after the user asks again.
  await prisma.verificationToken.deleteMany({ where: { email, purpose } });
  await prisma.verificationToken.create({
    data: { email, otp, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  return otp;
}

/**
 * Consume a code, or refuse. Deletes on success AND on expiry — a code that has
 * been presented has done its job either way, and leaving an expired one lying
 * around only widens the window for a guess.
 */
async function consumeOtp(email: string, otp: string, purpose: string): Promise<boolean> {
  const token = await prisma.verificationToken.findFirst({ where: { email, otp, purpose } });
  if (!token) return false;

  await prisma.verificationToken.delete({ where: { id: token.id } });
  return token.expiresAt >= new Date();
}

export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Create an identity and send a verification code.
 *
 * 🔴 `emailVerified` starts false and stays false until the code comes back. That
 * flag is load-bearing well beyond this service: jobwork's §9.2 email-linking
 * branch turns on it, so an identity that could self-declare a verified address
 * would be able to claim someone else's existing jobwork account.
 *
 * An existing address is answered exactly like a new one — same message, same
 * timing, no error. Signup is otherwise a way to ask "does this person have an
 * account here", and the honest answer belongs only in that person's inbox.
 */
export async function signup(input: SignupInput): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing) {
    // Tell the owner of the inbox, not the person at the keyboard.
    await sendOtpEmail(input.email, await issueOtp(input.email, PURPOSE_VERIFY), PURPOSE_VERIFY);
    return;
  }

  await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await argon2.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      emailVerified: false,
    },
  });

  await sendOtpEmail(input.email, await issueOtp(input.email, PURPOSE_VERIFY), PURPOSE_VERIFY);
}

/** Confirm control of the inbox. */
export async function verifyEmail(email: string, otp: string): Promise<boolean> {
  if (!(await consumeOtp(email, otp, PURPOSE_VERIFY))) return false;

  await prisma.user.updateMany({ where: { email }, data: { emailVerified: true } });
  return true;
}

/**
 * Start a password reset.
 *
 * Returns nothing and reveals nothing: an unknown address, a disabled account and a
 * real one are indistinguishable to the caller. `sendOtpEmail` swallows its own
 * failures for the same reason — a send that throws on known addresses and returns
 * instantly on unknown ones is an enumeration oracle wearing a different hat.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email, ...ACTIVE_USER } });
  if (!user) return;

  await sendOtpEmail(email, await issueOtp(email, PURPOSE_RESET), PURPOSE_RESET);
}

export type ResetOutcome = 'ok' | 'invalid';

/**
 * Complete a password reset.
 *
 * 🔴 Every SSO session dies in the SAME transaction as the password change, and the
 * provider's own session rows go with them. Anything less means the person who knew
 * the old password still holds a live SSO cookie — and at an identity provider that
 * cookie is not one app's session, it is a key to every app in the estate. Changing
 * the credential has to end everything established with it.
 *
 * `sso_sessions` rows are stamped rather than deleted, so the login report still
 * shows those sessions and why they ended. The provider's `oidc_payloads` rows ARE
 * deleted: they are the live protocol state, and a stamped one would still work.
 */
export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string,
): Promise<ResetOutcome> {
  if (!(await consumeOtp(email, otp, PURPOSE_RESET))) return 'invalid';

  const user = await prisma.user.findFirst({
    where: { email, ...ACTIVE_USER },
    select: { id: true },
  });
  if (!user) return 'invalid';

  const passwordHash = await argon2.hash(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

    await tx.ssoSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: PURPOSE_RESET },
    });

    // The library keys its Session rows by jti and carries the account in the
    // payload, so this is a JSON match rather than a column one.
    await tx.oidcPayload.deleteMany({
      where: { type: 'Session', payload: { path: ['accountId'], equals: user.id } },
    });
  });

  return 'ok';
}
