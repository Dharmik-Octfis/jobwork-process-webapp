import { z } from 'zod';

/**
 * Authoritative input validation for the auth routes. The client mirrors these
 * in `web/src/features/auth/auth.schemas.ts` for instant feedback, but the
 * server never trusts that (architecture §4).
 *
 * `.trim()` matters: a `citext` column folds case but does NOT trim, so
 * ` jane@x.com ` and `jane@x.com` would otherwise be two distinct users.
 * Normalizing here means the unique index sees the value we intend.
 */
const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');

export const signupSchema = z.object({
  // 80 = the `users.name VARCHAR(80)` column width. Rejecting at 81 here beats
  // a Postgres "value too long" error surfacing as a 500.
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(40, 'Keep first name under 40 characters'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .max(40, 'Keep last name under 40 characters'),
  email,
  // 72 is the classic bcrypt input ceiling; argon2 has no such limit, but the
  // cap keeps a megabyte-long password from becoming a CPU denial-of-service.
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'Keep your password under 72 characters'),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email,
  otp: z.string().length(6, 'OTP must be exactly 6 characters'),
  newPassword: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'Keep your password under 72 characters'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(40, 'Keep first name under 40 characters'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .max(40, 'Keep last name under 40 characters'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
