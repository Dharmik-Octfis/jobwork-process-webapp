import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';

/** Message for the (organizationId, customerNumber) unique index. */
const DUPLICATE_NUMBER = 'Customer number already exists in this organization.';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';

export type CustomerInput = Omit<
  Prisma.CustomerUncheckedCreateInput,
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
    Omit<Prisma.CustomerContactPersonUncheckedCreateInput, 'id' | 'customerId'> & { id?: string }
  >;
  addresses?: Array<
    Omit<Prisma.CustomerAddressUncheckedCreateInput, 'id' | 'customerId'> & { id?: string }
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
 * One paginated list endpoint that also does search — same shape as the vendors
 * list, via the shared `searchWhere`/`pageContext` helpers. See `lib/pagination.ts`
 * and memory: list-search-pagination-pattern.
 */
/** The one `where` both the list and the count are built from — see vendors. */
function customerListWhere(organizationId: string, opts: ListQuery): Prisma.CustomerWhereInput {
  return {
    // The `where` is what the query *means*; RLS is the net under it. Both stay.
    organizationId,
    // isDeleted: false — soft-deleted customers never surface, search included.
    isDeleted: false,
    // Preset view ("Active Customers"), spread in so it narrows rather than replaces.
    ...filterWhere<Prisma.CustomerWhereInput>('customer', opts.filter),
    ...searchWhere<Prisma.CustomerWhereInput>(opts.search, [
      'displayName',
      'companyName',
      'emailAddress',
      'customerNumber',
      'workPhone',
      'mobilePhone',
    ]),
  };
}

export async function getCustomersList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    // No COUNT here — one row beyond the page answers "is there a next page?".
    const rows = await tx.customer.findMany({
      where: customerListWhere(organizationId, opts),
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: { contactPersons: true, addresses: true },
    });

    return pageSlice(rows, page, perPage);
  });
}

/** Total matching customers — only run when the client explicitly asks for it. */
export async function countCustomers(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.customer.count({ where: customerListWhere(organizationId, opts) }),
  );
}

export async function createNewCustomer(
  organizationId: string,
  data: CustomerInput,
  userId?: string,
) {
  const { contactPersons, addresses, customFields: rawCustomFields, ...customerData } = data;
  return runAsTenant(organizationId, async (tx) => {
    const defs = await loadActiveDefinitions(tx, organizationId, 'customer');
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
      where: { organizationId_entityType: { organizationId, entityType: 'customer' } },
    });

    if (seq) {
      // Basic padding to match frontend (e.g. 00727). Assuming length 5.
      // Wait, frontend didn't have padding logic yet. We need to agree on padding.
      // Let's just compare without padding if it's not strictly padded, or assume it's directly from frontend.
      // Actually, if we just blindly increment, it might be safer, but only if they start with the prefix.
      if (customerData.customerNumber.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, () =>
      tx.customer.create({
        data: {
          ...customerData,
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
                title: 'Customer created',
                description: `Customer ${customerData.displayName} has been created by ${performedBy}`,
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
}

export async function getCustomerById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.customer.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: { contactPersons: true, addresses: true },
    }),
  );
}

export async function updateCustomerById(
  organizationId: string,
  id: string,
  data: CustomerInput,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingCustomer = await tx.customer.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingCustomer) {
      throw ApiError.notFound('Customer not found');
    }

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    const { contactPersons, addresses, customFields: rawCustomFields, ...customerData } = data;

    // Re-validate custom fields only when the client sends them; required policy
    // (b) uses the existing stored values so old records stay editable.
    let customFields: Prisma.InputJsonValue | undefined;
    if (rawCustomFields !== undefined) {
      const defs = await loadActiveDefinitions(tx, organizationId, 'customer');
      customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'update',
        existing: existingCustomer.customFields,
      }) as Prisma.InputJsonValue;
    }

    let activityTitle = 'Customer updated';
    let activityDesc = `Customer details were updated by ${performedBy}`;

    if (contactPersons !== undefined) {
      await tx.customerContactPerson.deleteMany({
        where: { customerId: id },
      });
      activityTitle = 'Contact updated';
      activityDesc = `Contact persons were updated by ${performedBy}`;
    }

    if (addresses !== undefined) {
      await tx.customerAddress.deleteMany({
        where: { customerId: id },
      });
    }

    return tx.customer.update({
      where: { id },
      data: {
        ...customerData,
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
}

export async function deleteCustomerById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existingCustomer = await tx.customer.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingCustomer) {
      throw ApiError.notFound('Customer not found');
    }

    // Soft delete: the row stays, `isDeleted` is flipped and the delete is
    // recorded as an update — `updatedBy`/`updatedAt` stamp who removed it.
    return tx.customer.update({
      where: { id },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

export async function getCustomerActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.customerActivity.findMany({
      where: {
        customerId: id,
        customer: {
          organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function getCustomerComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.customerComment.findMany({
      where: {
        customerId: id,
        isDeleted: false,
        customer: {
          organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createCustomerComment(
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

    return tx.customerComment.create({
      data: {
        customerId: id,
        content,
        performedBy,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  });
}

export async function deleteCustomerComment(
  organizationId: string,
  customerId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.customerComment.findFirst({
      where: { id: commentId, customerId, isDeleted: false, customer: { organizationId } },
    });

    if (!existingComment) {
      throw ApiError.notFound('Comment not found');
    }

    return tx.customerComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}

export async function getCustomerNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'customer' } },
    });

    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          organizationId,
          entityType: 'customer',
          prefix: 'CUS-',
          nextNumber: 1,
        },
      });
    }

    return seq;
  });
}

export async function updateCustomerNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, async (tx) => {
    return tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'customer' } },
      create: {
        organizationId,
        entityType: 'customer',
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
