import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verification codes and signup — the security rules behind the invitee fix.
 *
 * Each of these failed silently before: a code could be guessed without limit, and
 * whoever registered an address first kept their password on it after the real owner
 * verified. Neither produces an error; both produce an account in the wrong hands.
 */

const db = vi.hoisted(() => {
  const tx = {
    user: { update: vi.fn() },
    ssoSession: { updateMany: vi.fn() },
    oidcPayload: { deleteMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      verificationToken: {
        findFirst: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
      },
      user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});
vi.mock('../db/prisma.ts', () => ({ prisma: db.prisma }));

const sendOtpEmail = vi.fn();
vi.mock('../lib/mailer.ts', () => ({ sendOtpEmail: (...a: unknown[]) => sendOtpEmail(...a) }));

const service = await import('./account.service.ts');
const { hashBinding } = service;

const EMAIL = 'invitee@example.com';
const BINDING = hashBinding('this-browser');

function token(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    email: EMAIL,
    otp: '123456',
    purpose: 'email_verify',
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    bindingHash: BINDING,
    pendingPasswordHash: '$argon2id$pending',
    pendingFirstName: 'Riya',
    pendingLastName: 'Shah',
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  db.prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 });
});

describe('signup', () => {
  it('creates a new account with NO password and NO name — both ride on the code', async () => {
    db.prisma.user.findUnique.mockResolvedValue(null);

    await service.signup(
      { email: EMAIL, password: 'correct horse', firstName: 'Riya', lastName: 'Shah' },
      BINDING,
    );

    expect(db.prisma.user.create).toHaveBeenCalledWith({
      data: { email: EMAIL, emailVerified: false },
    });
    const code = db.prisma.verificationToken.create.mock.calls[0]![0].data;
    expect(code).toMatchObject({ bindingHash: BINDING, pendingFirstName: 'Riya' });
    expect(code.pendingPasswordHash).toMatch(/^\$argon2/);
    expect(sendOtpEmail).toHaveBeenCalledWith(EMAIL, code.otp, 'email_verify');
  });

  it('does not touch an existing account — a signup only issues a code', async () => {
    db.prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: EMAIL });

    await service.signup(
      { email: EMAIL, password: 'attacker pass', firstName: 'X', lastName: 'Y' },
      BINDING,
    );

    expect(db.prisma.user.create).not.toHaveBeenCalled();
    expect(db.tx.user.update).not.toHaveBeenCalled();
  });
});

describe('verifyEmail', () => {
  it('applies the pending password and name, verifies, and returns the account id', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(token());
    db.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      passwordHash: null,
      emailVerified: false,
    });

    await expect(service.verifyEmail(EMAIL, '123456', BINDING)).resolves.toBe('u1');

    expect(db.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        emailVerified: true,
        passwordHash: '$argon2id$pending',
        firstName: 'Riya',
        lastName: 'Shah',
      },
    });
    // No earlier credential was replaced, so nothing to revoke.
    expect(db.tx.ssoSession.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 refuses a code from a DIFFERENT browser, and does not count it as a guess', async () => {
    // The pre-takeover: a stranger's signup emails the owner a code. Typed into the
    // owner's browser, it must not confirm the stranger's password.
    db.prisma.verificationToken.findFirst.mockResolvedValue(token());

    await expect(service.verifyEmail(EMAIL, '123456', hashBinding('other'))).resolves.toBeNull();

    expect(db.tx.user.update).not.toHaveBeenCalled();
    expect(db.prisma.verificationToken.updateMany).not.toHaveBeenCalled();
  });

  it('🔴 counts a wrong guess against the code', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(token({ attempts: 2 }));

    await expect(service.verifyEmail(EMAIL, '000000', BINDING)).resolves.toBeNull();

    expect(db.prisma.verificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('🔴 deletes the code on the 5th wrong guess — no brute force inside 10 minutes', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(token({ attempts: 4 }));

    await expect(service.verifyEmail(EMAIL, '000000', BINDING)).resolves.toBeNull();

    expect(db.prisma.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { id: 'tok-1' } });
  });

  it('refuses and deletes an expired code', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(
      token({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.verifyEmail(EMAIL, '123456', BINDING)).resolves.toBeNull();
    expect(db.prisma.verificationToken.deleteMany).toHaveBeenCalled();
    expect(db.tx.user.update).not.toHaveBeenCalled();
  });

  it('lets only one of two concurrent redemptions of the same code win', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(token());
    db.prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 }); // the other tab got it

    await expect(service.verifyEmail(EMAIL, '123456', BINDING)).resolves.toBeNull();
    expect(db.tx.user.update).not.toHaveBeenCalled();
  });

  it('ends every SSO session when the code replaces an existing password', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(token());
    db.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      passwordHash: '$argon2id$old',
      emailVerified: true,
    });

    await service.verifyEmail(EMAIL, '123456', BINDING);

    expect(db.tx.ssoSession.updateMany).toHaveBeenCalled();
    expect(db.tx.oidcPayload.deleteMany).toHaveBeenCalled();
    // A verified account keeps the name it has.
    expect(db.tx.user.update.mock.calls[0]![0].data).not.toHaveProperty('firstName');
  });

  it('verifies an unverified sign-in (no pending password) without changing the password', async () => {
    db.prisma.verificationToken.findFirst.mockResolvedValue(
      token({ pendingPasswordHash: null, pendingFirstName: null, pendingLastName: null }),
    );
    db.prisma.user.findFirst.mockResolvedValue({
      id: 'u1',
      passwordHash: '$argon2id$existing',
      emailVerified: false,
    });

    await expect(service.verifyEmail(EMAIL, '123456', BINDING)).resolves.toBe('u1');
    expect(db.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: true },
    });
    expect(db.tx.ssoSession.updateMany).not.toHaveBeenCalled();
  });
});
