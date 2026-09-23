import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { approvalTriggerService } from '../../automation/approval-processes/approvalTrigger.service.ts';

/** Message for the (organizationId, vendorNumber) unique index. */
const DUPLICATE_NUMBER = 'Vendor number already exists in this organization.';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';

export type VendorInput = Omit<
  Prisma.VendorUncheckedCreateInput,
  | 'id'
  | 'organizationId'
  | 'isDeleted'
  | 'createdBy'
  | 'updatedBy'
  | 'createdAt'
  | 'updatedAt'
  | 'contactPersons'
  | 'addresses'
  | 'customFields'
> & {
  // Raw client input — validated & narrowed to InputJsonValue in the service.
  customFields?: Record<string, unknown>;
  contactPersons?: Array<
    Omit<Prisma.VendorContactPersonUncheckedCreateInput, 'id' | 'vendorId'> & { id?: string }
  >;
  addresses?: Array<
    Omit<Prisma.VendorAddressUncheckedCreateInput, 'id' | 'vendorId'> & { id?: string }
  >;
};

/**
 * Every query runs inside `runAsTenant`, which sets `app.current_tenant` for the
 * transaction so Postgres' row-level security policies apply (architecture
 * §3.10, migration 20260716183126_enable_rls).
 *
 * The `where: { organizationId }` filters stay. RLS is the net under them, not a
 * replacement: the app filter is what the query *means*, and RLS is what saves
 * us when someone forgets it.
 *
 * `runAsTenant` wraps each service call rather than the whole request. A Prisma
 * transaction holds a pooled connection for its entire life, and the pool is 5
 * per instance (db/prisma.ts) — a request-long transaction would hold that
 * connection through validation, serialization, and any slow I/O. One query,
 * one short transaction.
 *
 * Forgetting `runAsTenant` on a new function is not a leak: with no tenant set,
 * the policy compares against NULL and the query returns nothing. It fails
 * closed and loudly, which is the point of having both layers.
 */

/**
 * One paginated list endpoint that also does search — the term fans out across a
 * handful of columns via the shared `searchWhere` helper. Response carries a
 * `pageContext`. See `lib/pagination.ts` and memory: list-search-pagination-pattern.
 */
/**
 * The one `where` both the list and the count are built from — so "12 results"
 * can never disagree with the rows on screen because the two queries drifted.
 */
function vendorListWhere(organizationId: string, opts: ListQuery): Prisma.VendorWhereInput {
  return {
    // The `where` is what the query *means*; RLS is the net under it. Both stay.
    organizationId,
    // isDeleted: false — soft-deleted vendors never surface, search included.
    isDeleted: false,
    // Preset view ("Active Vendors"), spread in so it narrows rather than replaces.
    ...filterWhere<Prisma.VendorWhereInput>('vendor', opts.filter),
    ...searchWhere<Prisma.VendorWhereInput>(opts.search, [
      'contactName',
      'companyName',
      'email',
      'contactNumber',
      'phone',
      'mobile',
    ]),
  };
}

export async function getVendorsList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    // No COUNT here — fetch one row beyond the page and let its presence answer
    // "is there a next page?". The total is a separate, opt-in request.
    const rows = await tx.vendor.findMany({
      where: vendorListWhere(organizationId, opts),
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: { contactPersons: true, addresses: true },
    });

    const paginated = pageSlice(rows, page, perPage);
    const vendorIds = paginated.results.map((r) => r.id);
    let pendingApprovalVendorIds = new Set<string>();
    if (vendorIds.length > 0) {
      try {
        const activeReqs = await tx.$queryRaw<Array<{ record_id: string }>>`
          SELECT "record_id" FROM "approval_requests"
          WHERE "organization_id" = ${organizationId}::uuid
            AND "module_id" = ANY(ARRAY['vendors', 'vendor']::text[])
            AND "record_id" = ANY(${vendorIds}::text[])
            AND "status" IN ('PENDING', 'IN_PROGRESS')
        `;
        pendingApprovalVendorIds = new Set(activeReqs.map((a) => a.record_id));
      } catch (_e) {
        // ignore
      }
    }

    return {
      ...paginated,
      results: paginated.results.map((r) => ({
        ...r,
        isPendingApproval: pendingApprovalVendorIds.has(r.id),
        approvalStatus: pendingApprovalVendorIds.has(r.id) ? 'Pending Approval' : null,
      })),
    };
  });
}

/** Total matching vendors — only run when the client explicitly asks for it. */
export async function countVendors(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.count({ where: vendorListWhere(organizationId, opts) }),
  );
}

export async function createNewVendor(organizationId: string, data: VendorInput, userId?: string) {
  const { contactPersons, addresses, customFields: rawCustomFields, ...vendorData } = data;
  const result = await runAsTenant(organizationId, async (tx) => {
    const defs = await loadActiveDefinitions(tx, organizationId, 'vendor');
    const customFields = validateCustomFields({
      defs,
      input: rawCustomFields,
      mode: 'create',
    }) as Prisma.InputJsonValue;

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    const seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'vendor' } },
    });

    if (seq) {
      // Basic padding to match frontend (e.g. 00727). Assuming length 5.
      // Wait, frontend didn't have padding logic yet. We need to agree on padding.
      // Let's just compare without padding if it's not strictly padded, or assume it's directly from frontend.
      // Actually, if we just blindly increment, it might be safer, but only if they start with the prefix.
      if (vendorData.contactNumber.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.vendor.create({
        data: {
          ...vendorData,
          customFields,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          contactPersons:
            contactPersons && contactPersons.length > 0
              ? {
                  create: contactPersons.map((cp) => {
                    const { id: _id, ...rest } = cp;
                    return { ...rest, createdBy: userId ?? null, updatedBy: userId ?? null };
                  }),
                }
              : undefined,
          addresses:
            addresses && addresses.length > 0
              ? {
                  create: addresses.map((addr) => {
                    const { id: _id, ...rest } = addr;
                    return { ...rest, createdBy: userId ?? null, updatedBy: userId ?? null };
                  }),
                }
              : undefined,
          activities: {
            create: [
              {
                title: 'Vendor created',
                description: `Vendor ${vendorData.contactName} has been created by ${performedBy}`,
                performedBy,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
              },
            ],
          },
        },
        include: { contactPersons: true, addresses: true },
      }),
    );
  });

  // Trigger approval workflow evaluation asynchronously post-commit
  approvalTriggerService
    .trigger({
      organizationId,
      moduleId: 'vendors',
      recordId: result.id,
      recordTitle: result.contactName || `Vendor ${result.id}`,
      triggerType: 'CREATE',
      record: result as unknown as Record<string, unknown>,
      actorUserId: userId,
    })
    .catch((err) => console.error('[ApprovalTrigger] Error in create vendor:', err));

  return result;
}

export async function getVendorById(organizationId: string, id: string) {
  return runAsTenant(organizationId, async (tx) => {
    const vendor = await tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: { contactPersons: true, addresses: true },
    });
    if (!vendor) return null;

    let isPendingApproval = false;
    try {
      const activeReqs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "approval_requests"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "module_id" = ANY(ARRAY['vendors', 'vendor']::text[])
          AND "record_id" = ${id}
          AND "status" IN ('PENDING', 'IN_PROGRESS')
        LIMIT 1
      `;
      isPendingApproval = activeReqs.length > 0;
    } catch (_e) {
      // ignore
    }

    return {
      ...vendor,
      isPendingApproval,
      approvalStatus: isPendingApproval ? 'Pending Approval' : null,
    };
  });
}

export async function updateVendorById(
  organizationId: string,
  id: string,
  data: VendorInput,
  userId?: string,
) {
  const result = await runAsTenant(organizationId, async (tx) => {
    const existingVendor = await tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingVendor) {
      throw ApiError.notFound('Vendor not found');
    }

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    const { contactPersons, addresses, customFields: rawCustomFields, ...vendorData } = data;

    // Re-validate custom fields only when the client sends them; required policy
    // (b) uses the existing stored values so old records stay editable.
    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'vendor');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existingVendor.customFields,
      }) as Prisma.InputJsonValue;
    }

    let activityTitle = 'Vendor updated';
    let activityDesc = `Vendor details were updated by ${performedBy}`;

    if (contactPersons !== undefined) {
      await tx.vendorContactPerson.deleteMany({
        where: { vendorId: id },
      });
      activityTitle = 'Contact updated';
      activityDesc = `Contact persons were updated by ${performedBy}`;
    }

    if (addresses !== undefined) {
      await tx.vendorAddress.deleteMany({
        where: { vendorId: id },
      });
    }

    return tx.vendor.update({
      where: { id },
      data: {
        ...vendorData,
        ...(customFields !== undefined ? { customFields } : {}),
        updatedBy: userId ?? null,
        contactPersons:
          contactPersons !== undefined && contactPersons.length > 0
            ? {
                create: contactPersons.map((cp) => {
                  const { id: _id, ...rest } = cp;
                  return { ...rest, createdBy: userId ?? null, updatedBy: userId ?? null };
                }),
              }
            : undefined,
        addresses:
          addresses !== undefined && addresses.length > 0
            ? {
                create: addresses.map((addr) => {
                  const { id: _id, ...rest } = addr;
                  return { ...rest, createdBy: userId ?? null, updatedBy: userId ?? null };
                }),
              }
            : undefined,
        activities: {
          create: [
            {
              title: activityTitle,
              description: activityDesc,
              performedBy,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            },
          ],
        },
      },
      include: { contactPersons: true, addresses: true },
    });
  });

  if (result) {
    // Trigger approval workflow evaluation asynchronously post-commit
    approvalTriggerService
      .trigger({
        organizationId,
        moduleId: 'vendors',
        recordId: result.id,
        recordTitle: result.contactName || `Vendor ${result.id}`,
        triggerType: 'EDIT',
        record: result as unknown as Record<string, unknown>,
        actorUserId: userId,
      })
      .catch((err) => console.error('[ApprovalTrigger] Error in update vendor:', err));
  }

  return result;
}

export async function deleteVendorById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existingVendor = await tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingVendor) {
      throw ApiError.notFound('Vendor not found');
    }

    // Soft delete: the row stays, `isDeleted` is flipped and the delete is
    // recorded as an update — `updatedBy`/`updatedAt` stamp who removed it.
    return tx.vendor.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

export async function getVendorActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendorActivity.findMany({
      where: {
        vendorId: id,
        vendor: {
          organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getVendorComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendorComment.findMany({
      where: {
        vendorId: id,
        isDeleted: false,
        vendor: {
          organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createVendorComment(
  organizationId: string,
  id: string,
  content: string,
  userId: string | null,
) {
  return runAsTenant(organizationId, async (tx) => {
    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return tx.vendorComment.create({
      data: {
        vendorId: id,
        content,
        performedBy,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  });
}

export async function deleteVendorComment(
  organizationId: string,
  vendorId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.vendorComment.findFirst({
      where: { id: commentId, vendorId, isDeleted: false, vendor: { organizationId } },
    });

    if (!existingComment) {
      throw ApiError.notFound('Comment not found');
    }

    return tx.vendorComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

export async function getVendorNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'vendor' } },
    });

    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          organizationId,
          entityType: 'vendor',
          prefix: 'VEN-',
          nextNumber: 1,
        },
      });
    }

    return seq;
  });
}

export async function updateVendorNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, async (tx) => {
    return tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'vendor' } },
      create: {
        organizationId,
        entityType: 'vendor',
        prefix,
        nextNumber,
      },
      update: {
        prefix,
        nextNumber,
      },
    });
  });
}
