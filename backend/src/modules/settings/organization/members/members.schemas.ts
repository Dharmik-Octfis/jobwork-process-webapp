import { z } from 'zod';

/**
 * Change what a member is called (`roleId`) and/or what they may do
 * (`permissionTemplateId`). Two independent axes: send either, or both.
 *
 * `roleId: null` clears the title. A member with no title is fine — a title
 * grants nothing. Permissions are still never edited per user: you swap the
 * template, you never tick a key for one person.
 */
export const updateMemberSchema = z
  .object({
    roleId: z.string().uuid('Select a role.').nullable().optional(),
    permissionTemplateId: z.string().uuid('Select a permission template.').optional(),
  })
  .refine((v) => v.roleId !== undefined || v.permissionTemplateId !== undefined, {
    message: 'Send a role, a permission template, or both.',
  });

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
