import { runAsTenant, type TenantClient } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import type { CreateProcessInput } from './processes.schemas.ts';

/**
 * The operation master — dyeing, printing, cutting, stitching.
 *
 * Deliberately the FIRST jobwork module built (plan §4.3): it is the simplest
 * thing in the domain, so it proves routes → controller → service → schemas →
 * permissions → list view → custom fields end to end before anything complicated
 * depends on that path working.
 *
 * Every query runs inside `runAsTenant` AND carries `where: { organizationId }`.
 * The filter is what the query means; RLS is the net under it. Neither replaces
 * the other — see vendors.service.ts for the long version.
 */

/** Message for the (organizationId, name) unique index. */
const DUPLICATE_NAME = 'A process with this name already exists in this organization.';

/** Columns the list search fans out across. */
const SEARCH_COLUMNS = ['name', 'code', 'description'] as const;

/** The one `where` both the list and the count are built from, so "12 results"
 * can never disagree with the rows on screen because the two queries drifted. */
function processListWhere(organizationId: string, opts: ListQuery): Prisma.ProcessWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.ProcessWhereInput>('process', opts.filter),
    ...searchWhere<Prisma.ProcessWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

/** What every read returns. The two uom relations are included because the list
 * and the detail pane both show unit names, not ids. */
const PROCESS_INCLUDE = {
  defaultIssueUom: { select: { id: true, unitName: true, symbol: true } },
  defaultReceiveUom: { select: { id: true, unitName: true, symbol: true } },
} satisfies Prisma.ProcessInclude;

export async function getProcessesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    // One row beyond the page answers "is there a next page?" — no COUNT here.
    const rows = await tx.process.findMany({
      where: processListWhere(organizationId, opts),
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: PROCESS_INCLUDE,
    });
    return pageSlice(rows, page, perPage);
  });
}

/** Total matching processes — only run when the client explicitly asks. */
export async function countProcesses(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.process.count({ where: processListWhere(organizationId, opts) }),
  );
}

export async function getProcessById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.process.findFirst({
      // isDeleted: false — a soft-deleted process must 404, not resurrect.
      where: { id, organizationId, isDeleted: false },
      include: PROCESS_INCLUDE,
    }),
  );
}

/** The fixed columns, separated from the ones the service owns. `customFields`
 * is validated separately and never written straight through. */
function writableFields(data: CreateProcessInput) {
  return {
    name: data.name.trim(),
    // `|| null`, not `?? null`: an empty string is what a cleared text box sends,
    // and storing '' would make "has no code" two different values that every
    // later query has to test for separately.
    code: data.code?.trim() || null,
    description: data.description?.trim() || null,
    itemChanges: data.itemChanges ?? false,
    rateBasis: data.rateBasis ?? 'per_issued_unit',
    preservesPackaging: data.preservesPackaging ?? false,
    requiresSingleLot: data.requiresSingleLot ?? false,
    defaultTolerancePct: data.defaultTolerancePct ?? null,
    defaultIssueUomId: data.defaultIssueUomId ?? null,
    defaultReceiveUomId: data.defaultReceiveUomId ?? null,
    isActive: data.isActive ?? true,
  };
}

/**
 * A uom id arriving from the client is a claim. RLS would already stop another
 * tenant's row being *read*, but an FK is checked by Postgres OUTSIDE row-level
 * security — so without this check a hand-crafted payload could point a process
 * at a unit belonging to another organization and the insert would succeed.
 */
async function assertUomsBelongToOrg(
  tx: TenantClient,
  organizationId: string,
  ids: (string | null)[],
) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return;

  const found = await tx.unitOfMeasurement.findMany({
    where: { id: { in: wanted }, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== wanted.length) {
    throw ApiError.badRequest('Unknown unit of measurement.');
  }
}

export async function createNewProcess(
  organizationId: string,
  data: CreateProcessInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, ...rest } = data;
  const fields = writableFields({ ...rest, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    await assertUomsBelongToOrg(tx, organizationId, [
      fields.defaultIssueUomId,
      fields.defaultReceiveUomId,
    ]);

    const defs = await loadActiveDefinitions(tx, organizationId, 'process');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    /**
     * 🔴 A soft-deleted row still occupies the (organizationId, name) unique key
     * (CLAUDE.md). "Dyeing" deleted last month must be creatable again, so a
     * collision with a DELETED row revives that row rather than 409-ing.
     *
     * Reviving rather than inserting a second row is what keeps history intact:
     * anything that already referenced that process — a route step, a job order —
     * keeps pointing at the same id instead of silently splitting into two
     * "Dyeing"s that no report can add together.
     */
    const softDeleted = await tx.process.findFirst({
      where: { organizationId, name: fields.name, isDeleted: true },
      select: { id: true },
    });
    if (softDeleted) {
      return tx.process.update({
        where: { id: softDeleted.id },
        data: { ...fields, customFields, isDeleted: false, updatedBy: userId ?? null },
        include: PROCESS_INCLUDE,
      });
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.process.create({
        data: {
          ...fields,
          customFields,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
        include: PROCESS_INCLUDE,
      }),
    );
  });
}

export async function updateProcessById(
  organizationId: string,
  id: string,
  data: CreateProcessInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, ...rest } = data;
  const fields = writableFields({ ...rest, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.process.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Process not found');

    await assertUomsBelongToOrg(tx, organizationId, [
      fields.defaultIssueUomId,
      fields.defaultReceiveUomId,
    ]);

    // Re-validate only what the client actually sent: the engine's "required"
    // rule on update looks at the stored value, so old records stay editable.
    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'process');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existing.customFields,
      }) as Prisma.InputJsonValue;
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.process.update({
        where: { id },
        data: {
          ...fields,
          ...(customFields !== undefined ? { customFields } : {}),
          updatedBy: userId ?? null,
        },
        include: PROCESS_INCLUDE,
      }),
    );
  });
}

export async function deleteProcessById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.process.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Process not found');

    // Soft delete: the row stays, the flag flips, and updatedBy/updatedAt record
    // who removed it. Sprints 2–4 add route steps and job order steps that
    // reference this row — deleting it for real would take their history with it.
    return tx.process.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
