import { z } from 'zod';

/**
 * Client-side validation for the auth forms. Mirrors the server-side Zod so
 * users get instant, specific feedback while the server stays authoritative
 * (architecture §4 "request flow").
 */

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Signup creates a **user**, not a company. The organization is a separate,
 * later step — a user can also be invited into someone else's organization
 * rather than founding one, so the two cannot be collapsed into this form.
 */
export const signupSchema = z
  .object({
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
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(72, 'Keep your password under 72 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({
  email,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    email,
    otp: z.string().length(6, 'OTP must be exactly 6 characters'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(72, 'Keep your password under 72 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
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

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(72, 'Keep your password under 72 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

