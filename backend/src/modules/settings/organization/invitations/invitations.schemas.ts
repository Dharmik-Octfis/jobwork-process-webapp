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
 * An invite carries two independent things: a **role** (job title) and a
 * **permission template** (the access). The template is required — it is the
 * invitee's authorization, and an org ships with only the Owner template, so one
 * must exist before anyone can be invited. The role is optional: a title grants
 * nothing, so requiring one would block inviting for no security gain.
 *
 * Neither Owner one is invitable: ownership is conferred by creating the org,
 * never by invitation (enforced in the service).
 */
export const createInvitationSchema = z.object({
  email,
  roleId: z.string().uuid('Select a role for this member.').optional(),
  permissionTemplateId: z.string().uuid('Select a permission template for this member.'),
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
