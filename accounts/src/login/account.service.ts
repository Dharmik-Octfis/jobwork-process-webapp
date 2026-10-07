import argon2 from 'argon2';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { VerificationToken } from '../../generated/prisma/client.ts';
import { prisma } from '../db/prisma.ts';
import { ACTIVE_USER } from '../lib/activeUser.ts';
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

/** Wrong guesses a code survives. 5 in a million is a 0.0005% chance per code. */
const MAX_OTP_ATTEMPTS = 5;

/**
 * The stored form of a browser-binding value — see `bindingHash` on the model. The
 * raw value lives only in the requesting browser's HttpOnly cookie.
 */
export function hashBinding(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** What a code carries besides itself: who may redeem it, and what it applies. */
interface CodeExtras {
  bindingHash?: string | undefined;
  pendingPasswordHash?: string | undefined;
  pendingFirstName?: string | undefined;
  pendingLastName?: string | undefined;
}

/**
 * 🔴 `randomInt`, not `Math.random()`. This code is a credential — it is the entire
 * proof of inbox control — and `Math.random()` is a predictable PRNG whose output
 * can be reconstructed from previous values. The app's copy uses Math.random and
 * should be changed when it is retired.
 */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function issueOtp(email: string, purpose: string, extras: CodeExtras = {}): Promise<string> {
  const otp = generateOtp();

  // One live code per address per purpose: issuing a new one invalidates the old,
  // so a forwarded old email cannot be used after the user asks again.
  await prisma.verificationToken.deleteMany({ where: { email, purpose } });
  await prisma.verificationToken.create({
    data: {
      email,
      otp,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      bindingHash: extras.bindingHash ?? null,
      pendingPasswordHash: extras.pendingPasswordHash ?? null,
      pendingFirstName: extras.pendingFirstName ?? null,
      pendingLastName: extras.pendingLastName ?? null,
    },
  });

  return otp;
}

/**
 * Redeem a code, or refuse. Returns the token so the caller can apply what it carries.
 *
 * 🔴 Looked up by address and purpose — never by the guessed code. There is one live
 * code per (address, purpose), so a wrong guess is counted against THAT code and it
 * dies at `MAX_OTP_ATTEMPTS`. The old lookup matched `(email, otp)`, so a wrong guess
 * found nothing, counted nothing, and a million guesses in ten minutes would land.
 *
 * A code bound to a browser answers only that browser. A mismatch is refused WITHOUT
 * counting an attempt, so a stranger cannot burn the owner's code by guessing at it.
 * Expired and exhausted codes are deleted: presented is presented.
 */
async function consumeOtp(
  email: string,
  otp: string,
  purpose: string,
  bindingHash?: string,
): Promise<VerificationToken | null> {
  const token = await prisma.verificationToken.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) return null;

  if (token.expiresAt < new Date()) {
    await prisma.verificationToken.deleteMany({ where: { id: token.id } });
    return null;
  }

  if (token.bindingHash && token.bindingHash !== bindingHash) return null;

  if (!sameCode(token.otp, otp)) {
    if (token.attempts + 1 >= MAX_OTP_ATTEMPTS) {
      await prisma.verificationToken.deleteMany({ where: { id: token.id } });
    } else {
      await prisma.verificationToken.updateMany({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
    }
    return null;
  }

  // deleteMany + count: two tabs submitting the same right code must not both win.
  const { count } = await prisma.verificationToken.deleteMany({ where: { id: token.id } });
  return count === 1 ? token : null;
}

/**
 * End every SSO session of an account — same rule, same shape as `resetPassword`.
 * The library keys its Session rows by jti and carries the account in the payload,
 * so that half is a JSON match rather than a column one.
 */
async function revokeAllSessions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  reason: string,
): Promise<void> {
  await tx.ssoSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.oidcPayload.deleteMany({
    where: { type: 'Session', payload: { path: ['accountId'], equals: userId } },
  });
}

export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Start a signup: send a verification code that CARRIES the chosen password and name.
 *
 * 🔴 `emailVerified` starts false and stays false until the code comes back. That
 * flag is load-bearing well beyond this service: jobwork's §9.2 email-linking
 * branch turns on it, so an identity that could self-declare a verified address
 * would be able to claim someone else's existing jobwork account.
 *
 * 🔴 Nothing usable is written to the account until the code is confirmed. A new row
 * gets no password and no name; both ride on the code and are applied by
 * `verifyEmail`. Writing them here meant whoever registered an address FIRST kept
 * their password on it after the real owner verified — the owner's own "Create
 * Account" only re-sent a code. Now the password in force is always the one chosen
 * alongside the code the inbox owner actually confirmed, from the browser that chose
 * it (`bindingHash`).
 *
 * An existing address is answered exactly like a new one — same message, same
 * timing, no error. Signup is otherwise a way to ask "does this person have an
 * account here", and the honest answer belongs only in that person's inbox. For an
 * already-verified account, confirming the code sets the new password — no more than
 * proving the inbox already allows through password reset.
 */
export async function signup(input: SignupInput, bindingHash: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (!existing) {
    await prisma.user.create({ data: { email: input.email, emailVerified: false } });
  }

  const otp = await issueOtp(input.email, PURPOSE_VERIFY, {
    bindingHash,
    pendingPasswordHash: await argon2.hash(input.password),
    pendingFirstName: input.firstName,
    pendingLastName: input.lastName,
  });
  // Tell the owner of the inbox, not the person at the keyboard.
  await sendOtpEmail(input.email, otp, PURPOSE_VERIFY);
}

/**
 * Send a verification code to an account that already has a password but never
 * confirmed its address — reached from the sign-in form, AFTER the password was
 * checked, so it reveals nothing. The code changes nothing but `emailVerified`.
 */
export async function startVerification(email: string, bindingHash: string): Promise<void> {
  await sendOtpEmail(email, await issueOtp(email, PURPOSE_VERIFY, { bindingHash }), PURPOSE_VERIFY);
}

/**
 * Confirm control of the inbox, apply what the code carries, and return the account
 * id — so a caller holding an interaction can sign the person straight in.
 *
 * If the code replaces a password the account already had, every SSO session ends in
 * the same transaction, exactly as a password reset does: a credential change must
 * end what the old credential established.
 */
export async function verifyEmail(
  email: string,
  otp: string,
  bindingHash?: string,
): Promise<string | null> {
  const token = await consumeOtp(email, otp, PURPOSE_VERIFY, bindingHash);
  if (!token) return null;

  const user = await prisma.user.findFirst({ where: { email, ...ACTIVE_USER } });
  if (!user) return null;

  const replacesPassword = Boolean(token.pendingPasswordHash && user.passwordHash);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        ...(token.pendingPasswordHash ? { passwordHash: token.pendingPasswordHash } : {}),
        // A verified account keeps its name; a first verification takes the signup's.
        ...(!user.emailVerified && token.pendingFirstName !== null
          ? { firstName: token.pendingFirstName, lastName: token.pendingLastName ?? '' }
          : {}),
      },
    });
    if (replacesPassword) await revokeAllSessions(tx, user.id, PURPOSE_RESET);
  });

  return user.id;
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
    // A redeemed reset code proves the inbox just as a verification code does.
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, emailVerified: true } });
    await revokeAllSessions(tx, user.id, PURPOSE_RESET);
  });

  return 'ok';
}
