import { z } from 'zod';
import { openApiRegistry } from '../../../config/openapi.ts';
import { RATE_BASES } from '../processes/processes.types.ts';
import { PROCESSOR_TYPES } from '../jobwork.types.ts';
import { OWNERSHIPS } from '../../inventory/stock-ledger/stockLedger.service.ts';

/**
 * Request shapes for Job Orders.
 *
 * 🔴 `status` IS NOT HERE, AND MUST NOT BE ADDED. It is recomputed from the
 * documents underneath the order (`jobOrders.status.ts`); accepting it from a
 * request body is how a list that says "completed" ends up sitting next to an
 * Overview page that adds up the receipts and disagrees.
 *
 * `jobOrderNumber` is OPTIONAL on create and absent from update. Left out, the
 * number comes from `NumberSequence('job_order')` inside the save transaction, so
 * an abandoned form burns nothing (§2.2). Sent, it is the one the user typed over
 * the offered number — the same override Vendor Number allows. It is not accepted
 * on update: by then the number is on issue challans a processor is holding.
 */

const nullableUuid = z.string().uuid().nullable().optional();

/**
 * 🔴 ONE ITEM A STEP CONSUMES (domain §5.7).
 *
 * Stitching takes panels AND thread AND buttons, so a step carries a list here
 * rather than the single `issueItemId` Sprints 1–4 shipped with.
 *
 * `uomId` is accepted only so the client can send back what it displayed — the
 * service forces the item's stocking unit over it, exactly as the header does
 * with `inputUomId` (§5.1). `plannedQty` is per row because there is no single
 * number that covers metres, cones and pieces at once.
 *
 * `fromStock` is absent and must stay absent: it is computed at save from what
 * the earlier steps produce (§6.4), and a client that could send it could label
 * a chain-fed input as stock and hide a broken chain.
 */
export const stepInputRowSchema = z.object({
  itemId: z.string().uuid({ message: 'Every input row needs an item.' }),
  uomId: nullableUuid,
  plannedQty: z.coerce.number().min(0).nullable().optional(),
  /** Over-issue allowance for THIS item. Null falls through to the step's —
   * which is why it is nullable and not defaulted: 0 means no tolerance at all
   * and must be distinguishable from "not set" (§2.5). */
  tolerancePct: z.coerce.number().min(0).max(100).nullable().optional(),
});

export type StepInputRow = z.infer<typeof stepInputRowSchema>;

/**
 * One item a step is expected to produce. Cutting returns panels AND offcuts
 * AND waste (§5.7).
 *
 * 🔴 `isPrimary` is sent rather than inferred from row order, because the primary
 * output is the one that absorbs the step's whole cost (§9.2.1) — a judgement,
 * not a position. Offcuts can perfectly well be typed first. Exactly one row may
 * carry it; the service flags the first row when nobody does.
 */
export const stepOutputRowSchema = z.object({
  itemId: z.string().uuid({ message: 'Every output row needs an item.' }),
  uomId: nullableUuid,
  expectedQty: z.coerce.number().min(0).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export type StepOutputRow = z.infer<typeof stepOutputRowSchema>;

/**
 * One step of the job order.
 *
 * This is a near-copy of `routeStepSchema` rather than a reuse of it, and the
 * duplication is deliberate: a job order step is a SNAPSHOT, not a reference
 * (§2.4). The two shapes are the same today and are free to diverge — a job
 * order step gains `plannedInputQty`, which a route template has no business
 * carrying — and importing one into the other would couple a running document to
 * the master it was supposed to be independent of.
 */
export const jobOrderStepSchema = z.object({
  /**
   * 🔴 WHICH EXISTING STEP THIS ROW IS — update only, and the only thing that
   * makes a partial edit safe (§6.6).
   *
   * A started order keeps the steps at and behind the work front exactly as they
   * are, because challans point at them by id. The client sends those rows back
   * with their ids so the server can prove the payload still begins with them; a
   * row with no id is a new step. Position alone could not prove it — two steps
   * can run the same process, so a reordered grid would look identical.
   *
   * Ignored on create, where there is nothing to identify.
   */
  id: z.string().uuid().optional(),

  /** Sent for ordering, renumbered 1..n by the service from array position. */
  seq: z.number().int().positive().optional(),

  processId: z.string().uuid({ message: 'Every step needs a process.' }),

  processorType: z.enum(PROCESSOR_TYPES).optional(),
  processorId: nullableUuid,
  workCentreLocationId: nullableUuid,

  rate: z.coerce.number().min(0).nullable().optional(),
  rateBasis: z.enum(RATE_BASES).nullable().optional(),

  /**
   * 🔴 What the step consumes and what it produces (§5.7). These replaced four
   * scalar columns — `issueItemId` / `issueUomId` / `receiveItemId` /
   * `receiveUomId` — which were dropped in Migration B on 2026-08-12.
   *
   * Still optional: a step that lists nothing is a draft the form is halfway
   * through, and it saves. Empty now means empty — there is no scalar left for
   * it to fall back to.
   */
  inputs: z.array(stepInputRowSchema).optional(),
  outputs: z.array(stepOutputRowSchema).optional(),

  expectedYield: z.coerce.number().positive().nullable().optional(),
  tolerancePct: z.coerce.number().min(0).max(100).nullable().optional(),
  plannedInputQty: z.coerce.number().min(0).nullable().optional(),

  remarks: z.string().trim().max(2000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type JobOrderStepInput = z.infer<typeof jobOrderStepSchema>;

/**
 * 🔴 MATERIAL IN IS GONE (2026-08-07). It is NOT to be reintroduced here.
 *
 * It existed only because Purchase Received and Opening Stock were descoped
 * (plan §1.3) and the ledger would otherwise have been empty forever. Stock now
 * comes from those two documents — see `docs/PURCHASE_RECEIVED_AND_ITEMS_SPEC.md`
 * §D3, which retires Material In rather than letting it become a second doorway:
 * it had no number, no edit, no cancel, no reversal and no list page, so the same
 * consignment could be entered twice with nothing able to detect it.
 *
 * Existing Material In lots are untouched and keep issuing, tracing and valuing;
 * `SOURCE_DOC_TYPES.jobOrderMaterialIn` stays in the constants permanently so
 * those rows remain interpretable (spec §7).
 *
 * Until Purchase Received ships, a job order is a PLAN — steps, items and
 * quantities — and there may be no stock to issue against it yet. That is
 * expected, not a failure state.
 */

export const createJobOrderSchema = openApiRegistry.register(
  'CreateJobOrderRequest',
  z.object({
    /** Omit to take the next number in the series. */
    jobOrderNumber: z.string().trim().min(1).max(50).optional(),

    orderDate: z.coerce.date().optional(),
    targetDate: z.coerce.date().nullable().optional(),

    /**
     * 🔴 `inputItemId` AND `inputQty` ARE NOT HERE, AND MUST NOT COME BACK.
     *
     * A step consumes a SET of items (§5.7). One item and one quantity on the
     * header could only ever name one of them, and naming one of three on the
     * document that owns all three is worse than naming none — it is the field
     * everybody then trusts. What the order runs on is step 1's CONSUMES list,
     * and the columns are derived from its first row for the list page alone.
     */

    /** Optional: a job order with no route has its steps typed by hand, which is
     * what "fully flexible" means in the domain doc. */
    routeId: nullableUuid,

    ownership: z.enum(OWNERSHIPS).optional(),
    ownerPartyId: nullableUuid,

    /** At least one — an order with no steps has nothing to issue against. */
    steps: z.array(jobOrderStepSchema).min(1, 'A job order needs at least one step.'),

    remarks: z.string().trim().max(2000).nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
);

export type CreateJobOrderInput = z.infer<typeof createJobOrderSchema>;

/** Update takes the same body. The number is create-only: by edit time it is
 * printed on the challans raised against the order. */
export const updateJobOrderSchema = createJobOrderSchema.omit({ jobOrderNumber: true });
export type UpdateJobOrderInput = z.infer<typeof updateJobOrderSchema>;

/**
 * Adding work to the END of an order that has already started.
 *
 * 🔴 There is no position field, and there must not be one until insert is built.
 * Append is safe precisely because it renumbers nothing; a `seq` or `afterStepId`
 * here would let a client shift steps whose numbers are printed on challans a
 * processor is holding.
 *
 * An array rather than a single step: "wash, then pack" is one decision, and
 * `buildSteps` already chains a list — the second new step can consume what the
 * first produces, which two separate calls could not express.
 */
export const appendJobOrderStepsSchema = openApiRegistry.register(
  'AppendJobOrderStepsRequest',
  z.object({
    steps: z.array(jobOrderStepSchema).min(1, 'Add at least one step.'),
    /** Why the order grew. Optional, but it lands in `remarks` when given. */
    reason: z.string().trim().max(2000).optional(),
  }),
);

export type AppendJobOrderStepsInput = z.infer<typeof appendJobOrderStepsSchema>;

/**
 * Closing an order short. Not a status the client may simply set — it takes a
 * reason, because "finished 150 m light" is a decision someone has to own.
 */
export const shortCloseSchema = openApiRegistry.register(
  'ShortCloseJobOrderRequest',
  z.object({
    reason: z.string().trim().min(1, 'Say why this is being closed short.').max(2000),
  }),
);

export type ShortCloseInput = z.infer<typeof shortCloseSchema>;
