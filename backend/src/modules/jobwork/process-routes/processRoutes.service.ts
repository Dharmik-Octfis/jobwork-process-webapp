import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import {
  assertItemsBelongToOrg,
  assertLocationsBelongToOrg,
  assertProcessesBelongToOrg,
  assertUomsBelongToOrg,
  resolveProcessorName,
} from '../jobwork.refs.ts';
import type { ProcessorType } from '../jobwork.types.ts';
import type { CreateRouteInput, RouteStepInput, RouteStepRow } from './processRoutes.schemas.ts';

/**
 * Process Routes — the reusable template a job order is built from.
 *
 * 🔴 A ROUTE IS READ EXACTLY ONCE, AT JOB ORDER CREATION, AND NEVER AGAIN.
 *
 * `JobOrderStep` is a full snapshot of what a route step said at that moment
 * (field-sources §2.4). Everything in this file is therefore free to change
 * later: renaming a route, re-rating a step, deleting the whole thing — none of
 * it can reach a job order that is already running. That is not a limitation to
 * work around, it is the reason routes are safe to edit at all. The rate on a
 * released order is a number someone agreed with a processor.
 */

const DUPLICATE_NAME = 'A route with this name already exists in this organization.';

const SEARCH_COLUMNS = ['name', 'code', 'description'] as const;

function routeListWhere(organizationId: string, opts: ListQuery): Prisma.RouteWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.RouteWhereInput>('process_route', opts.filter),
    ...searchWhere<Prisma.RouteWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

/**
 * Steps come back ordered by `seq`, always. The grid renders array order, so an
 * unordered read is a route that silently displays its operations in whatever
 * sequence Postgres felt like — and "grey → finishing → dyeing" looks like a
 * data-entry mistake rather than a missing ORDER BY.
 */
/** Item and unit, as the nested grids render them. */
const ROW_INCLUDE = {
  item: { select: { id: true, name: true, sku: true } },
  uom: { select: { id: true, unitName: true, symbol: true } },
};

const ROUTE_INCLUDE = {
  steps: {
    where: { isDeleted: false },
    orderBy: { seq: 'asc' },
    include: {
      // The bill of materials on the template side (§5.7).
      inputs: { where: { isDeleted: false }, orderBy: { seq: 'asc' }, include: ROW_INCLUDE },
      outputs: { where: { isDeleted: false }, orderBy: { seq: 'asc' }, include: ROW_INCLUDE },
      process: { select: { id: true, name: true, code: true, itemChanges: true } },
      issueItem: { select: { id: true, name: true, sku: true } },
      receiveItem: { select: { id: true, name: true, sku: true } },
      issueUom: { select: { id: true, unitName: true, symbol: true } },
      receiveUom: { select: { id: true, unitName: true, symbol: true } },
      workCentre: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.RouteInclude;

export async function getRoutesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.route.findMany({
      where: routeListWhere(organizationId, opts),
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: ROUTE_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countRoutes(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.route.count({ where: routeListWhere(organizationId, opts) }),
  );
}

export async function getRouteById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.route.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: ROUTE_INCLUDE,
    }),
  );
}

function writableFields(data: CreateRouteInput) {
  return {
    name: data.name.trim(),
    code: data.code?.trim() || null,
    description: data.description?.trim() || null,
    isActive: data.isActive ?? true,
  };
}

/**
 * Check every id on every step in as few queries as the step count allows —
 * six, not six per step. RLS does not cover this: Postgres checks foreign keys
 * outside row-level security, so a hand-crafted payload can name another
 * organization's item and the insert succeeds (jobwork.refs.ts).
 */
async function assertStepRefs(
  tx: TenantClient,
  organizationId: string,
  steps: readonly RouteStepInput[],
) {
  const rows = steps.flatMap((s) => [...(s.inputs ?? []), ...(s.outputs ?? [])]);
  await assertProcessesBelongToOrg(
    tx,
    organizationId,
    steps.map((s) => s.processId),
  );
  await assertItemsBelongToOrg(tx, organizationId, [
    ...steps.map((s) => s.issueItemId),
    ...steps.map((s) => s.receiveItemId),
    ...rows.map((row) => row.itemId),
  ]);
  await assertUomsBelongToOrg(tx, organizationId, [
    ...steps.map((s) => s.issueUomId),
    ...steps.map((s) => s.receiveUomId),
    ...rows.map((row) => row.uomId),
  ]);
  await assertLocationsBelongToOrg(
    tx,
    organizationId,
    steps.map((s) => s.workCentreLocationId),
  );

  // One query per step, unavoidably: the table to look in depends on that step's
  // own `processorType`, so they cannot be batched into one `in` list. Routes
  // have single-digit step counts.
  for (const step of steps) {
    await resolveProcessorName(
      tx,
      organizationId,
      (step.processorType ?? 'vendor') as ProcessorType,
      step.processorId,
    );
  }
}

interface ResolvedRow {
  itemId: string;
  uomId: string | null;
  isPrimary: boolean;
}

interface ResolvedRouteStep {
  inputs: ResolvedRow[];
  outputs: ResolvedRow[];
}

/**
 * The two lists a step carries, taken from the request or derived from the
 * scalars they replaced (§5.7).
 *
 * A template names items; it holds no quantities and no `fromStock` label. Both
 * of those are per-run answers, and the job order works them out when it takes
 * its snapshot — a route has no idea how much anyone will put through it, nor
 * what stock will exist on the day.
 *
 * The derivation honours `issueItemId` before the previous step's output, the
 * opposite way round from `jobOrders.service.ts`. There, a later step's input is
 * FORCED from the step above because the run is real. Here it is a template
 * somebody is typing, and what they typed is the answer.
 */
function resolveStepRows(
  step: RouteStepInput,
  previousPrimaryOutputItemId: string | null,
  index: number,
): ResolvedRouteStep {
  const sentInputs = step.inputs ?? [];
  const derivedInput = step.issueItemId ?? previousPrimaryOutputItemId;
  const inputs: RouteStepRow[] = sentInputs.length
    ? [...sentInputs]
    : derivedInput
      ? [{ itemId: derivedInput, uomId: step.issueUomId ?? null }]
      : [];

  const sentOutputs = step.outputs ?? [];
  // No mirroring of the input when the process leaves the item alone — that is
  // the job order's job. A template that says nothing about its output should
  // keep saying nothing, so the snapshot can apply the process's own rule.
  const outputs: RouteStepRow[] = sentOutputs.length
    ? [...sentOutputs]
    : step.receiveItemId
      ? [{ itemId: step.receiveItemId, uomId: step.receiveUomId ?? null, isPrimary: true }]
      : [];

  assertNoRepeatedItem(inputs, index, 'inputs');
  assertNoRepeatedItem(outputs, index, 'outputs');

  return {
    inputs: inputs.map((row) => ({
      itemId: row.itemId,
      uomId: row.uomId ?? null,
      isPrimary: false,
    })),
    outputs: flagPrimaryOutput(outputs, index),
  };
}

/** One row per item on each list — see the same rule in `jobOrders.service.ts`. */
function assertNoRepeatedItem(
  rows: readonly { itemId: string }[],
  stepIndex: number,
  list: 'inputs' | 'outputs',
) {
  const seen = new Set<string>();
  for (const [rowIndex, row] of rows.entries()) {
    if (seen.has(row.itemId)) {
      throw new ApiError(400, `Step ${stepIndex + 1} lists the same item twice.`, {
        [`steps.${stepIndex}.${list}.${rowIndex}.itemId`]: 'This item is already on the step.',
      });
    }
    seen.add(row.itemId);
  }
}

/** 🔴 Exactly one primary output per step (§9.2.1) — the one that will carry the
 * step's cost when a job order runs this template. */
function flagPrimaryOutput(rows: readonly RouteStepRow[], stepIndex: number): ResolvedRow[] {
  const flagged = rows.filter((row) => row.isPrimary);
  if (flagged.length > 1) {
    throw new ApiError(
      400,
      `Step ${stepIndex + 1} marks ${flagged.length} outputs as primary. Only one output can ` +
        'carry the cost of the step.',
      { [`steps.${stepIndex}.outputs`]: 'Mark exactly one output as primary.' },
    );
  }
  return rows.map((row, index) => ({
    itemId: row.itemId,
    uomId: row.uomId ?? null,
    isPrimary: flagged.length === 1 ? Boolean(row.isPrimary) : index === 0,
  }));
}

/**
 * 🔴 THE CHAIN IS ADVISORY NOW (§6.4). It used to be a rule here: step *n*'s
 * receive item had to be step *n+1*'s issue item. Since §5.7 a step consumes a
 * SET, and thread and buttons come from the godown rather than from the
 * operation above — a rule that rejects them rejects most real routes.
 *
 * What remains is the one case with no valid reading: an input produced ONLY by
 * a LATER step. A template that says "stitch the panels, then cut them" is
 * wrong in an order-of-operations way that no run could fix.
 *
 * The job order re-does this per run and stores the answer as `fromStock`; here
 * there is nothing to store, so it is validation and nothing more.
 */
function assertInputOrdering(
  steps: readonly ResolvedRouteStep[],
  itemNames: ReadonlyMap<string, string>,
) {
  const producedAt = new Map<string, number[]>();
  for (const [index, step] of steps.entries()) {
    for (const output of step.outputs) {
      producedAt.set(output.itemId, [...(producedAt.get(output.itemId) ?? []), index]);
    }
  }

  for (const [index, step] of steps.entries()) {
    for (const [rowIndex, input] of step.inputs.entries()) {
      const producers = producedAt.get(input.itemId) ?? [];
      if (producers.some((at) => at < index)) continue;
      const later = producers.find((at) => at > index);
      if (later === undefined) continue;
      const name = itemNames.get(input.itemId) ?? 'That item';
      throw new ApiError(
        400,
        `Step ${index + 1} consumes ${name}, which is only produced by step ${later + 1}. ` +
          'Material cannot come from a step that has not run yet — reorder the steps.',
        {
          [`steps.${index}.inputs.${rowIndex}.itemId`]: `Produced by step ${later + 1}, which runs after this one.`,
        },
      );
    }
  }
}

/**
 * Resolve every step's two lists, check the ordering, and force each row onto its
 * item's stocking unit.
 *
 * 🔴 The unit comes from the ITEM, not from the request. One item has exactly one
 * stocking unit (§5.1), and a template offering a different one teaches the job
 * order form a unit the stock can never move in. The sent value survives only
 * where the item has no stocking uom — the Sprint 1 backfill left some null.
 */
async function resolveSteps(
  tx: TenantClient,
  organizationId: string,
  steps: readonly RouteStepInput[],
): Promise<ResolvedRouteStep[]> {
  const resolved: ResolvedRouteStep[] = [];
  for (const [index, step] of steps.entries()) {
    const previousPrimary =
      resolved[index - 1]?.outputs.find((row) => row.isPrimary)?.itemId ?? null;
    resolved.push(resolveStepRows(step, previousPrimary, index));
  }

  const itemIds = [
    ...new Set(
      resolved.flatMap((step) => [...step.inputs, ...step.outputs].map((row) => row.itemId)),
    ),
  ];
  const items = itemIds.length
    ? await tx.item.findMany({
        where: { id: { in: itemIds }, organizationId, isDeleted: false },
        select: { id: true, name: true, stockingUomId: true },
      })
    : [];
  const stockingUomByItem = new Map(items.map((item) => [item.id, item.stockingUomId]));
  const itemNames = new Map(items.map((item) => [item.id, item.name]));

  assertInputOrdering(resolved, itemNames);

  return resolved.map((step) => ({
    inputs: step.inputs.map((row) => ({
      ...row,
      uomId: stockingUomByItem.get(row.itemId) ?? row.uomId,
    })),
    outputs: step.outputs.map((row) => ({
      ...row,
      uomId: stockingUomByItem.get(row.itemId) ?? row.uomId,
    })),
  }));
}

/** One step's scalar columns, renumbered from array position. */
function stepData(step: RouteStepInput, index: number, resolved: ResolvedRouteStep) {
  const principalInput = resolved.inputs[0] ?? null;
  const primaryOutput = resolved.outputs.find((row) => row.isPrimary) ?? null;
  return {
    seq: index + 1,
    processId: step.processId,
    processorType: step.processorType ?? 'vendor',
    processorId: step.processorId ?? null,
    workCentreLocationId: step.workCentreLocationId ?? null,
    rate: step.rate ?? null,
    rateBasis: step.rateBasis ?? null,
    // A projection of the lists — principal input, primary output — kept only
    // until Migration B drops these four columns (plan §12.1).
    issueItemId: principalInput?.itemId ?? null,
    issueUomId: principalInput?.uomId ?? null,
    receiveItemId: primaryOutput?.itemId ?? null,
    receiveUomId: primaryOutput?.uomId ?? null,
    expectedYield: step.expectedYield ?? null,
    tolerancePct: step.tolerancePct ?? null,
    remarks: step.remarks?.trim() || null,
  };
}

export async function createNewRoute(
  organizationId: string,
  data: CreateRouteInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, steps, ...rest } = data;
  const fields = writableFields({ ...rest, steps, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    await assertStepRefs(tx, organizationId, steps);
    // Resolved inside the transaction now: the lists take their units from the
    // items, which means a query, which means a tx.
    const resolvedSteps = await resolveSteps(tx, organizationId, steps);

    const defs = await loadActiveDefinitions(tx, organizationId, 'process_route');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    // Same revive-on-collision rule as processes: a soft-deleted row still holds
    // the (organizationId, name) key, and a route deleted last month must be
    // creatable again. Reviving keeps the id, so job orders that snapshotted from
    // it still trace back to one route rather than two with the same name.
    const softDeleted = await tx.route.findFirst({
      where: { organizationId, name: fields.name, isDeleted: true },
      select: { id: true },
    });
    if (softDeleted) {
      await tx.routeStep.deleteMany({ where: { routeId: softDeleted.id } });
      await tx.route.update({
        where: { id: softDeleted.id },
        data: { ...fields, customFields, isDeleted: false, updatedBy: userId ?? null },
      });
      await createSteps(tx, organizationId, softDeleted.id, steps, resolvedSteps, userId);
      return readBack(tx, organizationId, softDeleted.id);
    }

    const created = await withUniqueViolation(DUPLICATE_NAME, () =>
      tx.route.create({
        data: {
          ...fields,
          customFields,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
    );

    await createSteps(tx, organizationId, created.id, steps, resolvedSteps, userId);
    return readBack(tx, organizationId, created.id);
  });
}

async function createSteps(
  tx: TenantClient,
  organizationId: string,
  routeId: string,
  steps: readonly RouteStepInput[],
  resolvedSteps: readonly ResolvedRouteStep[],
  userId?: string,
) {
  for (const [index, step] of steps.entries()) {
    const defs = await loadActiveDefinitions(tx, organizationId, 'process_route');
    const customFields = validateCustomFields({
      defs,
      input: step.customFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    const resolved = resolvedSteps[index]!;
    await tx.routeStep.create({
      data: {
        ...stepData(step, index, resolved),
        organizationId,
        routeId,
        customFields,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        // `custom_fields` on the rows is left at its default — neither list is a
        // registered entity type (`customFields.constants.ts`), so there is
        // nothing an org could have defined to put in it.
        inputs: {
          create: resolved.inputs.map((row, rowIndex) => ({
            organizationId,
            seq: rowIndex + 1,
            itemId: row.itemId,
            uomId: row.uomId,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          })),
        },
        outputs: {
          create: resolved.outputs.map((row, rowIndex) => ({
            organizationId,
            seq: rowIndex + 1,
            itemId: row.itemId,
            uomId: row.uomId,
            isPrimary: row.isPrimary,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          })),
        },
      },
    });
  }
}

function readBack(tx: TenantClient, organizationId: string, id: string) {
  return tx.route.findFirstOrThrow({
    where: { id, organizationId, isDeleted: false },
    include: ROUTE_INCLUDE,
  });
}

export async function updateRouteById(
  organizationId: string,
  id: string,
  data: CreateRouteInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, steps, ...rest } = data;
  const fields = writableFields({ ...rest, steps, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.route.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Route not found');

    await assertStepRefs(tx, organizationId, steps);
    const resolvedSteps = await resolveSteps(tx, organizationId, steps);

    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'process_route');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existing.customFields,
      }) as Prisma.InputJsonValue;
    }

    await withUniqueViolation(DUPLICATE_NAME, () =>
      tx.route.update({
        where: { id },
        data: {
          ...fields,
          ...(customFields !== undefined ? { customFields } : {}),
          updatedBy: userId ?? null,
        },
      }),
    );

    /**
     * 🔴 A HARD DELETE, in a codebase where deletes are soft. This is the one
     * place it is correct, and the reason is specific:
     *
     * `@@unique([routeId, seq])` is a FULL index — a soft-deleted step keeps
     * occupying its seq, so re-saving a route after removing step 2 would collide
     * on the seq that step 2 still holds, forever.
     *
     * It is safe here and NOWHERE else because nothing references a route step
     * after the fact. A job order copies every value it needs into
     * `job_order_steps` at creation and never reads the route again (§2.4), so a
     * deleted step takes no history with it — there is none to take. The moment
     * anything starts pointing at `route_steps.id`, this has to become a soft
     * delete with a partial index instead.
     *
     * `route_step_inputs` and `route_step_outputs` are the one thing that now
     * points at it, and they go with it: `onDelete: Cascade` on both, for the
     * same reason — they are part of the step, not references to it.
     */
    await tx.routeStep.deleteMany({ where: { routeId: id } });
    await createSteps(tx, organizationId, id, steps, resolvedSteps, userId);

    return readBack(tx, organizationId, id);
  });
}

export async function deleteRouteById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.route.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Route not found');

    // Soft: job orders created from this route keep `routeNameSnapshot`, and
    // their `routeId` keeps resolving for anyone who wants to see what the
    // template was. Deleting the row for real would break that join.
    return tx.route.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
