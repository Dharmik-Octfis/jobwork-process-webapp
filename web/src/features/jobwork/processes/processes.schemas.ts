import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

/**
 * The Processes module — jobwork's operation master.
 *
 * The flags on a process are not decoration. Each one decides what a LATER screen
 * is allowed to offer, so the wording on the form matters as much as the column:
 *
 *   itemChanges         the thing that comes back is a different item
 *
 * ⚠️ `requiresSingleBatch` was a second and is gone (2026-08-17) — see the
 * tombstone on the Prisma model before considering it back. `rateBasis` went with
 * the landed-cost redesign: the charge is rate × accepted on each output row.
 */

export const processSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  itemChanges: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Process = z.infer<typeof processSchema>;

export const createProcessSchema = z.object({
  name: z.string().trim().min(1, 'Process name is required'),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  itemChanges: z.boolean().optional(),
});

export type CreateProcessData = z.infer<typeof createProcessSchema>;
export type UpdateProcessData = CreateProcessData;

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const processesPageSchema = paginatedSchema(processSchema);
export type ProcessesPage = Paginated<Process>;
