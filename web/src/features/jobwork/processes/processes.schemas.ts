import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

/**
 * The Processes module — jobwork's operation master.
 *
 * The flags on a process are not decoration. Each one decides what a LATER screen
 * is allowed to offer, so the wording on the form matters as much as the column:
 *
 *   itemChanges         the thing that comes back is a different item
 *   preservesPackaging  decides taka-wise vs bulk receipt — a physical fact, not
 *                       a preference, which is why the Receive dialog reads it
 *                       instead of asking the user
 *   requiresSingleLot   blocks mixing dye lots on one issue
 *   rateBasis           which quantity the processor's rate multiplies
 */

/**
 * Mirrors `RATE_BASES` in the backend's processes.types.ts — keep the two in step
 * or the form offers a value the API rejects.
 *
 * `per_kg` and `lump_sum` went on 2026-08-10: neither had a number to multiply
 * (nothing captures weight, and a lump sum billed in full for a step that
 * received nothing). `rateBasisLabel` still falls back to the raw value, so a
 * legacy row that somehow escaped the data migration reads as `per_kg` rather
 * than as a blank cell.
 */
export const RATE_BASIS_OPTIONS = [
  { value: 'per_issued_unit', label: 'Per unit issued' },
  { value: 'per_received_unit', label: 'Per unit received' },
] as const;

export function rateBasisLabel(value: string | null | undefined): string {
  return RATE_BASIS_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
}

export const processSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  itemChanges: z.boolean(),
  rateBasis: z.string(),
  preservesPackaging: z.boolean(),
  requiresSingleLot: z.boolean(),
  // Prisma serialises Decimal as a string over JSON; a plain `z.number()` here
  // would reject "2.500" and blank the whole row.
  defaultTolerancePct: z.union([z.string(), z.number()]).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Process = z.infer<typeof processSchema>;

export const createProcessSchema = z.object({
  name: z.string().trim().min(1, 'Process name is required'),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  itemChanges: z.boolean().optional(),
  rateBasis: z.string().optional(),
  preservesPackaging: z.boolean().optional(),
  requiresSingleLot: z.boolean().optional(),
  defaultTolerancePct: z.number().min(0).max(100).nullable().optional(),
});

export type CreateProcessData = z.infer<typeof createProcessSchema>;
export type UpdateProcessData = CreateProcessData;

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const processesPageSchema = paginatedSchema(processSchema);
export type ProcessesPage = Paginated<Process>;
