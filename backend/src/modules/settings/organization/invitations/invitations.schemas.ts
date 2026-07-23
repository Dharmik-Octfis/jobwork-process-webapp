import { z } from 'zod';

/**
 * Input validation for the invitation routes. Mirrors the auth module's
 * conventions: `.trim()` on the email so the `citext` unique index sees the
 * value we intend (citext folds case but does not trim — auth.schemas.ts).
 */
const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');

/**
 * An invite grants a permission template (role) the Owner created. There is no
 * default — an org ships with only the Owner role, so a role must exist before
 * anyone can be invited. The Owner template itself is not invitable: ownership is
 * conferred by creating the org, never by invitation (enforced in the service).
 */
export const createInvitationSchema = z.object({
  email,
  permissionTemplateId: z.string().uuid('Select a role for this member.'),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/**
 * Body for `POST /invitations/:token/accept`.
 *
 * A logged-in caller sends an empty body — identity comes from their Bearer
 * token. An anonymous new user sends `firstName`/`lastName`/`password` to create
 * their account as they accept. All three are optional here so one schema serves
 * both callers; the service enforces "all present or all absent".
 */
export const acceptInvitationSchema = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  lastName: z.string().trim().min(1).max(40).optional(),
  password: z.string().min(8, 'Use at least 8 characters').max(72).optional(),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
