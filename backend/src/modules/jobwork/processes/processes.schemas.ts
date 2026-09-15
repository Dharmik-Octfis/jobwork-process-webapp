import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';

/**
 * Request shapes for the Processes module.
 *
 * In a file of its own rather than inside the controller (which is where the
 * vendors module keeps its schema): the invitations module is the convention this
 * one copies, and a schema file is what the frontend's mirror of it can be diffed
 * against.
 *
 * There is no `customFields` here. Processes left `ENTITY_TYPES` on 2026-08-10 —
 * the operation master is a short list of names an org types once, so per-org
 * fields on it were a form section nobody filled in. The `customFields` COLUMN
 * stays on the table (CLAUDE.md's default block), it is simply never written.
 */

/** Optional free text. Empty and absent both reach the service, which normalises
 * them to null — see `writableFields`. */
const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();

export const createProcessSchema = openApiRegistry.register(
  'CreateProcessRequest',
  z.object({
    name: z.string().trim().min(1, 'Name is required.').max(150),
    code: nullableTrimmed(50),
    description: nullableTrimmed(2000),

    /** The output is a DIFFERENT item from the input (§5.1) — cloth in, shirt out. */
    itemChanges: z.boolean().optional(),

    // No rate basis: the charge is rate × accepted on each output row (landed-cost
    // plan D1–D2). No tolerance either: it is a property of the ITEM (D10).
  }),
);

export type CreateProcessInput = z.infer<typeof createProcessSchema>;

/** Update takes the same body — the form posts the whole record, like vendors. */
export const updateProcessSchema = createProcessSchema;
export type UpdateProcessInput = CreateProcessInput;
