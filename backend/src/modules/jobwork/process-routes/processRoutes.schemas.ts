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
 */

const nullableUuid = z.string().uuid().nullable().optional();

/**
 * 🔴 ONE ITEM A STEP CONSUMES OR PRODUCES (domain §5.7).
 *
 * 🔴 NO QUANTITY, on either side. A route is a template and has no idea how much
 * anyone will run through it — `JobOrderStepInput.plannedQty` is where a number
 * first means something. This is a near-copy of the job order's row schema for
 * the same reason the step schemas are near-copies: a job order step is a
 * SNAPSHOT, not a reference (§2.4), and the two are free to diverge.
 *
 * `isPrimary` is meaningful on outputs alone — it names the output that will
 * absorb the step's cost (§9.2.1) — so it lives on this shared shape and the
 * service ignores it on the input side.
 */
export const routeStepRowSchema = z.object({
  itemId: z.string().uuid({ message: 'Every row needs an item.' }),
  uomId: nullableUuid,
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
   * 🔴 The two lists that replaced the four scalars below (§5.7). Omitted, the
   * service derives one row per side from those scalars, so a client that has not
   * grown the nested grids yet keeps working until Migration B.
   */
  inputs: z.array(routeStepRowSchema).optional(),
  outputs: z.array(routeStepRowSchema).optional(),

  /** @deprecated Superseded by `inputs`/`outputs`; dropped in Migration B. */
  issueItemId: nullableUuid,
  issueUomId: nullableUuid,
  receiveItemId: nullableUuid,
  receiveUomId: nullableUuid,

  /**
   * Planned out ÷ in — 0.604 pieces per metre. Positive, and deliberately
   * unbounded above: a process that turns 1 kg of yarn into 4 m of fabric has a
   * yield of 4, and capping it at 1 would reject a whole class of real work.
   */
  expectedYield: z.coerce.number().positive().nullable().optional(),
  tolerancePct: z.coerce.number().min(0).max(100).nullable().optional(),

  remarks: z.string().trim().max(2000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
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

    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
);

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

/** Update posts the whole record, steps included — same as vendors. */
export const updateRouteSchema = createRouteSchema;
export type UpdateRouteInput = CreateRouteInput;
