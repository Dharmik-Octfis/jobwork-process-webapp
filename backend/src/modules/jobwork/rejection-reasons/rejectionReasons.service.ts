import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import type { CreateRejectionReasonInput } from './rejectionReasons.schemas.ts';

/** The same shape as `processes.service.ts`, which is the module convention for
 * a small per-org master: soft delete, revive on name collision, custom fields
 * validated inside the write transaction. */

const DUPLICATE_NAME = 'A rejection reason with this name already exists in this organization.';
const SEARCH_COLUMNS = ['name', 'code', 'description'] as const;

function listWhere(organizationId: string, opts: ListQuery): Prisma.RejectionReasonWhereInput {
  return {
    organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.RejectionReasonWhereInput>('rejection_reason', opts.filter),
    ...searchWhere<Prisma.RejectionReasonWhereInput>(opts.search, [...SEARCH_COLUMNS]),
  };
}

export async function getRejectionReasonsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.rejectionReason.findMany({
      where: listWhere(organizationId, opts),
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
    });
    return pageSlice(rows, page, perPage);
  });
}

export async function countRejectionReasons(
  organizationId: string,
  opts: ListQuery,
): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.rejectionReason.count({ where: listWhere(organizationId, opts) }),
  );
}

export async function getRejectionReasonById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.rejectionReason.findFirst({ where: { id, organizationId, isDeleted: false } }),
  );
}

function writableFields(data: CreateRejectionReasonInput) {
  return {
    name: data.name.trim(),
    code: data.code?.trim() || null,
    description: data.description?.trim() || null,
    defaultResponsibility: data.defaultResponsibility ?? null,
    isActive: data.isActive ?? true,
  };
}

export async function createNewRejectionReason(
  organizationId: string,
  data: CreateRejectionReasonInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, ...rest } = data;
  const fields = writableFields({ ...rest, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    const defs = await loadActiveDefinitions(tx, organizationId, 'rejection_reason');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    // Revived rather than 409'd: a soft-deleted row still holds the unique key,
    // and reviving keeps every receipt line that already cites this reason
    // pointing at one row instead of splitting the wastage report in two.
    const softDeleted = await tx.rejectionReason.findFirst({
      where: { organizationId, name: fields.name, isDeleted: true },
      select: { id: true },
    });
    if (softDeleted) {
      return tx.rejectionReason.update({
        where: { id: softDeleted.id },
        data: { ...fields, customFields, isDeleted: false, updatedBy: userId ?? null },
      });
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.rejectionReason.create({
        data: {
          ...fields,
          customFields,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      }),
    );
  });
}

export async function updateRejectionReasonById(
  organizationId: string,
  id: string,
  data: CreateRejectionReasonInput,
  userId?: string,
) {
  const { customFields: rawCustomFields, ...rest } = data;
  const fields = writableFields({ ...rest, name: data.name });

  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.rejectionReason.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Rejection reason not found');

    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'rejection_reason');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existing.customFields,
      }) as Prisma.InputJsonValue;
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.rejectionReason.update({
        where: { id },
        data: {
          ...fields,
          ...(customFields !== undefined ? { customFields } : {}),
          updatedBy: userId ?? null,
        },
      }),
    );
  });
}

export async function deleteRejectionReasonById(
  organizationId: string,
  id: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existing = await tx.rejectionReason.findFirst({
      where: { id, organizationId, isDeleted: false },
    });
    if (!existing) throw ApiError.notFound('Rejection reason not found');

    // Soft: receipt lines already citing this reason keep resolving it, so last
    // quarter's wastage analysis does not develop holes.
    return tx.rejectionReason.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
