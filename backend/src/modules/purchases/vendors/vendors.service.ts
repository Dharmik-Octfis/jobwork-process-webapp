import { runAsTenant } from '../../../db/prisma.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../custom-fields/customFields.engine.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

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

export async function getVendorsList(organizationId: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.findMany({
      // isDeleted: false — soft-deleted vendors are hidden from every read.
      where: { organizationId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { contactPersons: true, addresses: true },
    }),
  );
}

export async function createNewVendor(organizationId: string, data: VendorInput, userId?: string) {
  const { contactPersons, addresses, customFields: rawCustomFields, ...vendorData } = data;
  return runAsTenant(organizationId, async (tx) => {
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
      if (vendorData.vendorNumber.startsWith(seq.prefix)) {
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: seq.nextNumber + 1 },
        });
      }
    }

    return tx.vendor.create({
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
              description: `Vendor ${vendorData.displayName} has been created by ${performedBy}`,
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

export async function getVendorById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: { contactPersons: true, addresses: true },
    }),
  );
}

export async function updateVendorById(
  organizationId: string,
  id: string,
  data: VendorInput,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingVendor = await tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingVendor) {
      throw new Error('Vendor not found');
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
}

export async function deleteVendorById(organizationId: string, id: string, userId?: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existingVendor = await tx.vendor.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!existingVendor) {
      throw new Error('Vendor not found');
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
      throw new Error('Comment not found');
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
