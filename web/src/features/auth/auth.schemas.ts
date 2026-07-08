import { z } from 'zod';

/**
 * Client-side validation for the auth forms. Mirrors the server-side Zod so
 * users get instant, specific feedback while the server stays authoritative
 * (architecture §4 "request flow").
 */

const email = z.string().min(1, 'Email is required').email('Enter a valid email address');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    name: z.string().min(1, 'Your name is required').max(80, 'Keep your name under 80 characters'),
    companyName: z
      .string()
      .min(1, 'Company name is required')
      .max(120, 'Keep the company name under 120 characters'),
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
