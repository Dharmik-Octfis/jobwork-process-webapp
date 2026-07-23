import { z } from 'zod';

/** Change which role (permission template) a member holds. The whole point of the
 * template model: you never grant a single permission, you swap the template. */
export const assignRoleSchema = z.object({
  permissionTemplateId: z.string().uuid('Select a role.'),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
