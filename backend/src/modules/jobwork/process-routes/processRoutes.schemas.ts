import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { RATE_BASES } from '../processes/processes.types.ts';
import { PROCESSOR_TYPES } from '../jobwork.types.ts';

/**
 * Request shapes for Process Routes.
 *
 * 🔴 EVERY DEFAULT ON A STEP IS NULLABLE, AND THAT IS THE DESIGN.
 *
 * The default chain (field-sources §2.5) runs Process master → route step → job
 * order step → the document, and each level overrides only what it actually
 * knows. A route that says nothing about rate must fall THROUGH to the process,
 * not overwrite it with a zero — so "not set" has to be expressible, and `0` has
 * to mean zero. That is why `rate`, `tolerancePct` and the four item/uom fields
 * are `.nullable().optional()` rather than defaulted here.
 *
 * There is no `customFields` here, on the route or on its steps. Routes left
 * `ENTITY_TYPES` on 2026-08-10 for the reason processes did a few hours earlier:
 * the section was on a form nobody filled it in on. The `custom_fields` COLUMNS
 * stay on the tables (CLAUDE.md's default block) with whatever they already
 * hold — they are simply never read or written again.
 */

const nullableUuid = z.string().uuid().nullable().optional();

/**
 * 🔴 ONE ITEM A STEP CONSUMES OR PRODUCES (domain §5.7).
 *
 * 🔴 `plannedQty` IS A DEFAULT, AND IT IS ON THE CONSUMED SIDE ONLY (2026-08-10).
 *
 * A route still does not know how much anyone will run through it. What it knows
 * is the amount this org usually runs, and the job order copies that number into
 * its own `plannedQty` once, where it is edited like anything else on the
 * snapshot (§2.4). It is NOT consumption per unit of output: scaling it would
 * need a ratio between 2,910 PCS and 80 KG, and no conversion exists anywhere in
 * this system (§5.1).
 *
 * The produced side has no quantity. What comes back is a per-run answer that
 * depends on what actually went out, and a template that guessed it would put a
 * number on the receipt screen nobody had reason to believe.
 *
 * `isPrimary` is likewise meaningful on outputs alone — it names the output that
 * will absorb the step's cost (§9.2.1). Both live on this one shared shape and
 * the service ignores each on the side it means nothing.
 */
export const routeStepRowSchema = z.object({
  itemId: z.string().uuid({ message: 'Every row needs an item.' }),
  uomId: nullableUuid,
  /** Inputs only. Nullable because "the template says nothing" is normal, and 0
   * is a real answer that must stay distinguishable from it (§2.5). */
  plannedQty: z.coerce.number().min(0).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export type RouteStepRow = z.infer<typeof routeStepRowSchema>;

export const routeStepSchema = z.object({
  /**
   * Sent by the client so a reordered grid arrives in its intended order, but
   * NOT trusted: the service renumbers 1..n from array position. Two rows
   * claiming seq 3 would otherwise hit `@@unique([routeId, seq])` as a 409 the
   * user cannot act on.
   */
  seq: z.number().int().positive().optional(),

  processId: z.string().uuid({ message: 'Every step needs a process.' }),

  processorType: z.enum(PROCESSOR_TYPES).optional(),
  processorId: nullableUuid,
  /** Only meaningful when `processorType = 'internal'`. */
  workCentreLocationId: nullableUuid,

  rate: z.coerce.number().min(0).nullable().optional(),
  rateBasis: z.enum(RATE_BASES).nullable().optional(),

  /**
   * 🔴 What the step consumes and what it produces (§5.7). These replaced four
   * scalar columns — `issueItemId` / `issueUomId` / `receiveItemId` /
   * `receiveUomId` — dropped in Migration B on 2026-08-12. Omitted now means the
   * step lists nothing, which a template is allowed to do.
   */
  inputs: z.array(routeStepRowSchema).optional(),
  outputs: z.array(routeStepRowSchema).optional(),

  /**
   * Planned out ÷ in — 0.604 pieces per metre. Positive, and deliberately
   * unbounded above: a process that turns 1 kg of yarn into 4 m of fabric has a
   * yield of 4, and capping it at 1 would reject a whole class of real work.
   */
  expectedYield: z.coerce.number().positive().nullable().optional(),
  tolerancePct: z.coerce.number().min(0).max(100).nullable().optional(),

  remarks: z.string().trim().max(2000).nullable().optional(),
});

export type RouteStepInput = z.infer<typeof routeStepSchema>;

export const createRouteSchema = openApiRegistry.register(
  'CreateRouteRequest',
  z.object({
    name: z.string().trim().min(1, 'Route name is required.').max(150),
    code: z.string().trim().max(50).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),

    /**
     * At least one. A route with no steps is not a template of anything — it
     * would create a job order with nothing to issue against, and the failure
     * would surface days later on an empty Overview page rather than here.
     */
    steps: z.array(routeStepSchema).min(1, 'A route needs at least one step.'),
  }),
);

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

/** Update posts the whole record, steps included — same as vendors. */
export const updateRouteSchema = createRouteSchema;
export type UpdateRouteInput = CreateRouteInput;
