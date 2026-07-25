import { z } from 'zod';

/**
 * A role is a job title and nothing more — name + description, no permission
 * keys. What a member may DO comes from their permission template, which is
 * edited on a separate screen against a separate endpoint. If you find yourself
 * wanting to add permissions here, you want the permission template.
 */
export const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  description: z.string().trim().max(255).optional(),
});

/** PATCH-style: send only what changed. */
export const updateRoleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100).optional(),
  description: z.string().trim().max(255).nullable().optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
