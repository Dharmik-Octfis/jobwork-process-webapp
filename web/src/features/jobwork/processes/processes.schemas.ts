import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';

/**
 * The Processes module — jobwork's operation master.
 *
 * The four flags on a process are not decoration. Each one decides what a LATER
 * screen is allowed to offer, so the wording on the form matters as much as the
 * column:
 *
 *   itemChanges         the thing that comes back is a different item
 *   preservesPackaging  decides taka-wise vs bulk receipt — a physical fact, not
 *                       a preference, which is why the Receive dialog reads it
 *                       instead of asking the user
 *   requiresSingleLot   blocks mixing dye lots on one issue
 *   rateBasis           which quantity the processor's rate multiplies
 */

/** Mirrors `RATE_BASES` in the backend's processes.types.ts. */
export const RATE_BASIS_OPTIONS = [
  { value: 'per_issued_unit', label: 'Per unit issued' },
  { value: 'per_received_unit', label: 'Per unit received' },
  { value: 'per_kg', label: 'Per kilogram' },
  { value: 'lump_sum', label: 'Lump sum' },
] as const;

export function rateBasisLabel(value: string | null | undefined): string {
  return RATE_BASIS_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
}

const uomRefSchema = z.object({
  id: z.string(),
  unitName: z.string(),
  symbol: z.string().nullable().optional(),
});

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
  defaultIssueUomId: z.string().nullable(),
  defaultReceiveUomId: z.string().nullable(),
  defaultIssueUom: uomRefSchema.nullable().optional(),
  defaultReceiveUom: uomRefSchema.nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),

  // Kept on the response so `cf:<key>` columns chosen in Customize Columns can be
  // rendered. Without it zod would strip the blob and those columns render blank.
  customFields: z.record(z.string(), z.unknown()).optional(),
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
  defaultIssueUomId: z.string().nullable().optional(),
  defaultReceiveUomId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),

  // Dynamic per-org custom fields. Loose here; validated server-side against this
  // org's field definitions.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type CreateProcessData = z.infer<typeof createProcessSchema>;
export type UpdateProcessData = CreateProcessData;

/** The paginated + searchable list payload: `data` = { results, pageContext }. */
export const processesPageSchema = paginatedSchema(processSchema);
export type ProcessesPage = Paginated<Process>;
