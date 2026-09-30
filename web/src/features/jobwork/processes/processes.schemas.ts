import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

/**
 * The Processes module — jobwork's operation master: a name, nothing more.
 *
 * ⚠️ It carries no flags. `itemChanges` went on 2026-09-30 (a step's outputs are
 * its own rows — "Same as consumed" on the step grid copies them) and
 * `requiresSingleBatch` on 2026-08-17 — see the tombstones on the Prisma model
 * before considering either back. `rateBasis` went with the landed-cost redesign:
 * the charge is rate × accepted on each output row.
 */

export const processSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Process = z.infer<typeof processSchema>;

export const createProcessSchema = z.object({
  name: z.string().trim().min(1, 'Process name is required'),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export type CreateProcessData = z.infer<typeof createProcessSchema>;
export type UpdateProcessData = CreateProcessData;

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const processesPageSchema = paginatedSchema(processSchema);
export type ProcessesPage = Paginated<Process>;
