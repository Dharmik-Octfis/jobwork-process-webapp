import { z } from 'zod';
import { paginatedSchema, type Paginated } from '../../../lib/pagination';
import {
  decimalString,
  itemRefSchema,
  namedRefSchema,
  stepItemRowSchema,
  uomRefSchema,
  type StepItemRow,
} from '../jobwork.schemas';

/**
 * Process Routes — the reusable template.
 *
 * A route is read exactly ONCE, when a job order is created, and never again:
 * the job order takes a full snapshot (field-sources §2.4). That is why editing
 * one here is safe, and it is worth saying on screen — people hesitate to change
 * a route that twenty orders were built from.
 */

export const routeStepSchema = z.object({
  id: z.string(),
  seq: z.number(),
  processId: z.string(),
  processorType: z.string(),
  processorId: z.string().nullable(),
  workCentreLocationId: z.string().nullable(),
  rate: decimalString,
  rateBasis: z.string().nullable(),
  issueItemId: z.string().nullable(),
  issueUomId: z.string().nullable(),
  receiveItemId: z.string().nullable(),
  receiveUomId: z.string().nullable(),
  expectedYield: decimalString,
  tolerancePct: decimalString,
  remarks: z.string().nullable(),

  /** 🔴 What the step consumes and produces (§5.7). The four scalars above are a
   * projection of these two — principal input, primary output — and go away with
   * Migration B. */
  inputs: z.array(stepItemRowSchema).default([]),
  outputs: z.array(stepItemRowSchema).default([]),

  process: z
    .object({
      id: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      itemChanges: z.boolean(),
    })
    .optional(),
  issueItem: itemRefSchema.nullable().optional(),
  receiveItem: itemRefSchema.nullable().optional(),
  issueUom: uomRefSchema.nullable().optional(),
  receiveUom: uomRefSchema.nullable().optional(),
  workCentre: namedRefSchema.nullable().optional(),
});

export type RouteStep = z.infer<typeof routeStepSchema>;

export const routeSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  steps: z.array(routeStepSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Route = z.infer<typeof routeSchema>;

/** What the form posts. Every step default is nullable — "unset" and "zero" are
 * different answers, and the default chain depends on telling them apart. */
export interface RouteStepData {
  processId: string;
  processorType?: string;
  processorId?: string | null;
  workCentreLocationId?: string | null;
  rate?: number | null;
  rateBasis?: string | null;
  /** 🔴 The two lists (§5.7). Sent, they are what the step consumes and
   * produces; left empty, the server derives one row per side from the template's
   * own defaults.
   *
   * An input row may carry `plannedQty` — the amount this org usually runs,
   * copied into a job order once and edited there. An output row may not: what
   * comes back is a per-run answer. */
  inputs?: StepItemRow[];
  outputs?: StepItemRow[];
  expectedYield?: number | null;
  tolerancePct?: number | null;
  remarks?: string | null;
}

export interface CreateRouteData {
  name: string;
  code?: string | null;
  description?: string | null;
  steps: RouteStepData[];
}

export type UpdateRouteData = CreateRouteData;

export const routesPageSchema = paginatedSchema(routeSchema);
export type RoutesPage = Paginated<Route>;

/** One line summarising the sequence — "Dyeing → Printing → Finishing". What the
 * list column shows, because a route's identity is its sequence, not its name. */
export function stepSummary(route: Route): string {
  if (route.steps.length === 0) return '-';
  return route.steps.map((s) => s.process?.name ?? 'Step').join(' → ');
}
