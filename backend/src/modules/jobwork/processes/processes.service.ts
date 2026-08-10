import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import type { CreateProcessInput } from './processes.schemas.ts';

/**
 * The operation master — dyeing, printing, cutting, stitching.
 *
 * Deliberately the FIRST jobwork module built (plan §4.3): it is the simplest
 * thing in the domain, so it proves routes → controller → service → schemas →
 * permissions → list view end to end before anything complicated depends on that
 * path working.
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

export async function getProcessesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    // One row beyond the page answers "is there a next page?" — no COUNT here.
    const rows = await tx.process.findMany({
      where: processListWhere(organizationId, opts),
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
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
    }),
  );
}

/** Everything the client is allowed to set. `createdBy`/`updatedBy` are added by
 * the callers below from `req.user.id` and never taken from the body. */
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
  };
}

export async function createNewProcess(
  organizationId: string,
  data: CreateProcessInput,
  userId?: string,
) {
  const fields = writableFields(data);

  return runAsTenant(organizationId, async (tx) => {
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
        data: { ...fields, isDeleted: false, updatedBy: userId ?? null },
      });
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.process.create({
        data: {
          ...fields,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
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
  const fields = writableFields(data);

  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.process.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('Process not found');

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.process.update({
        where: { id },
        data: { ...fields, updatedBy: userId ?? null },
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
