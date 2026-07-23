import { z } from 'zod';
import { isPermissionKey } from './permissions.catalog.ts';

/** A permission key must exist in the code catalog — reject typos and stale keys
 * from the client so a template can never grant something the app doesn't know. */
const permissionKey = z.string().refine(isPermissionKey, {
  message: 'Unknown permission.',
});

/** Permissions arrive as a set the admin ticked; we de-dupe and validate each. */
const permissionsArray = z.array(permissionKey).transform((keys) => Array.from(new Set(keys)));

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  description: z.string().trim().max(255).optional(),
  permissions: permissionsArray.default([]),
});

/** All fields optional — a PATCH-style update. `permissions`, when present,
 * REPLACES the whole set (templates are edited wholesale, never per-key). */
export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100).optional(),
  description: z.string().trim().max(255).nullable().optional(),
  permissions: permissionsArray.optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
