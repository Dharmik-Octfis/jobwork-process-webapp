import { z } from 'zod';
import { openApiRegistry } from '../../config/openapi.ts';

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
  .email('Enter a valid email address')
  .openapi({ example: 'johndoe@example.com' });

const passwordField = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Keep your password under 72 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character');

export const signupSchema = openApiRegistry.register(
  'SignupRequest',
  z.object({
    // 80 = the `users.name VARCHAR(80)` column width. Rejecting at 81 here beats
    // a Postgres "value too long" error surfacing as a 500.
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required')
      .max(40, 'Keep first name under 40 characters')
      .openapi({ example: 'John' }),
    lastName: z
      .string()
      .trim()
      .min(1, 'Last name is required')
      .max(40, 'Keep last name under 40 characters')
      .openapi({ example: 'Doe' }),
    email,
    // 72 is the classic bcrypt input ceiling; argon2 has no such limit, but the
    // cap keeps a megabyte-long password from becoming a CPU denial-of-service.
    // cap keeps a megabyte-long password from becoming a CPU denial-of-service.
    password: passwordField.openapi({ example: 'SecureP@ss123' }),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  }),
);

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = openApiRegistry.register(
  'LoginRequest',
  z.object({
    email,
    password: passwordField.openapi({ example: 'SecureP@ss123' }),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  }),
);

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email,
  otp: z.string().length(6, 'OTP must be exactly 6 characters'),
  newPassword: passwordField,
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

export const updateLocationSchema = z.object({
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordField,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
