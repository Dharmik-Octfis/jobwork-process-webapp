import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { RATE_BASES } from './processes.types.ts';

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
 * fields on it were a form section nobody filled in. The `custom_fields` COLUMN
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

    rateBasis: z.enum(RATE_BASES).optional(),

    /** Does the taka survive? Decides whether unit-wise receipt is even possible
     * (§5.2.3). A property of the process, never a user preference. */
    preservesPackaging: z.boolean().optional(),

    /** Shade-lot matching — blocks mixing lots on one issue (§5.2.4). */
    requiresSingleLot: z.boolean().optional(),

    /**
     * Percent. Nullable because "no default" is a real answer and is NOT the same
     * as 0, which means "no tolerance at all". Capped at 100 — a tolerance above
     * that would let a step receive more than twice what it issued without a
     * warning, which is a data-entry error every time.
     */
    defaultTolerancePct: z.coerce.number().min(0).max(100).nullable().optional(),
  }),
);

export type CreateProcessInput = z.infer<typeof createProcessSchema>;

/** Update takes the same body — the form posts the whole record, like vendors. */
export const updateProcessSchema = createProcessSchema;
export type UpdateProcessInput = CreateProcessInput;
