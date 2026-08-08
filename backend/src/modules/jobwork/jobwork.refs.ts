import type { TenantClient } from '../../db/prisma.ts';
import { ApiError } from '../../lib/apiError.ts';
import type { ProcessorType } from './jobwork.types.ts';

/**
 * "Does this id belong to this organization?" — asked once, in one place.
 *
 * 🔴 WHY THESE EXIST AT ALL, GIVEN RLS
 *
 * RLS stops another tenant's row being READ. It does not stop one being
 * REFERENCED: Postgres checks foreign keys OUTSIDE row-level security, so an
 * insert naming another organization's item id succeeds, and the row that lands
 * is invisible to both tenants' queries afterwards. Every id on a jobwork
 * document arrives from a client and is therefore a claim — a route step points
 * at a process, an item, two units and possibly a work centre, and a hand-crafted
 * payload gets to choose all five.
 *
 * `processes.service.ts` made this call first (`assertUomsBelongToOrg`). These
 * are the same check for the other five tables, written once because Sprints 2–4
 * need them on every save, and five copies is how one of them ends up missing.
 *
 * Each takes a list, skips nulls, and de-duplicates — a twelve-step route asks
 * about twelve process ids in one query, not twelve.
 */

/** Ids worth asking about: non-null, unique. Empty means nothing to check. */
function wanted(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export async function assertProcessesBelongToOrg(
  tx: TenantClient,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
) {
  const ask = wanted(ids);
  if (ask.length === 0) return;
  const found = await tx.process.findMany({
    where: { id: { in: ask }, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== ask.length) throw ApiError.badRequest('Unknown process.');
}

export async function assertItemsBelongToOrg(
  tx: TenantClient,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
) {
  const ask = wanted(ids);
  if (ask.length === 0) return;
  const found = await tx.item.findMany({
    where: { id: { in: ask }, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== ask.length) throw ApiError.badRequest('Unknown item.');
}

export async function assertUomsBelongToOrg(
  tx: TenantClient,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
) {
  const ask = wanted(ids);
  if (ask.length === 0) return;
  const found = await tx.unitOfMeasurement.findMany({
    where: { id: { in: ask }, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== ask.length) throw ApiError.badRequest('Unknown unit of measurement.');
}

export async function assertLocationsBelongToOrg(
  tx: TenantClient,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
) {
  const ask = wanted(ids);
  if (ask.length === 0) return;
  const found = await tx.location.findMany({
    where: { id: { in: ask }, organizationId, isDeleted: false },
    select: { id: true },
  });
  if (found.length !== ask.length) throw ApiError.badRequest('Unknown location.');
}

/**
 * Resolve a processor to its display name, checking it belongs to this org and
 * to the right table for its type.
 *
 * The pairing is the point. `processorId` is a plain uuid with no foreign key
 * (see the schema comment on `RouteStep.processorId`) because it points at
 * `vendors` OR `customers` depending on `processorType` — so nothing in the
 * database can catch a customer id sent with `processorType: 'vendor'`. This
 * can, and it returns the name the document will snapshot at the same time,
 * because the caller needs both and reading the row twice is how the two drift.
 *
 * Returns null for `internal` (a work centre is a location, not a party) and for
 * a step that names no processor yet — a route step may legitimately leave it to
 * the job order.
 */
export async function resolveProcessorName(
  tx: TenantClient,
  organizationId: string,
  processorType: ProcessorType,
  processorId: string | null | undefined,
): Promise<string | null> {
  if (!processorId || processorType === 'internal') return null;

  if (processorType === 'vendor') {
    const vendor = await tx.vendor.findFirst({
      where: { id: processorId, organizationId, isDeleted: false },
      select: { contactName: true, companyName: true },
    });
    if (!vendor) throw ApiError.badRequest('Unknown processor.');
    return vendor.companyName || vendor.contactName;
  }

  const customer = await tx.customer.findFirst({
    where: { id: processorId, organizationId, isDeleted: false },
    select: { contactName: true, companyName: true },
  });
  if (!customer) throw ApiError.badRequest('Unknown processor.');
  return customer.companyName || customer.contactName;
}
