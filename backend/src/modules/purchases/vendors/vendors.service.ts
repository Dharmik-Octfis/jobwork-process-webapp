import { runAsTenant} from '../../../db/prisma.ts';
import type { Prisma } from '../../../../generated/prisma/client.ts';

export type VendorInput = Omit<Prisma.VendorUncheckedCreateInput, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'contactPersons' | 'addresses'> & {
  contactPersons?: Array<Omit<Prisma.VendorContactPersonUncheckedCreateInput, 'id' | 'vendorId'> & { id?: string }>;
  addresses?: Array<Omit<Prisma.VendorAddressUncheckedCreateInput, 'id' | 'vendorId'> & { id?: string }>;
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
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { contactPersons: true, addresses: true },
    }),
  );
}

export async function createNewVendor(
  organizationId: string,
  data: VendorInput,
  userId?: string,
) {
  const { contactPersons, addresses, ...vendorData } = data;
  return runAsTenant(organizationId, async (tx) => {
    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return tx.vendor.create({
      data: {
        ...vendorData,
        organizationId,
        contactPersons: contactPersons && contactPersons.length > 0 ? {
          create: contactPersons.map((cp) => {
            const { id: _id, ...rest } = cp;
            return rest;
          })
        } : undefined,
        addresses: addresses && addresses.length > 0 ? {
          create: addresses.map((addr) => {
            const { id: _id, ...rest } = addr;
            return rest;
          })
        } : undefined,
        activities: {
          create: [{
            title: 'Vendor created',
            description: `Vendor ${vendorData.displayName} has been created by ${performedBy}`,
            performedBy,
          }]
        }
      },
      include: { contactPersons: true, addresses: true },
    });
  });
}

export async function getVendorById(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendor.findFirst({
      where: { id, organizationId },
      include: { contactPersons: true, addresses: true },
    })
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
      where: { id, organizationId },
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

    const { contactPersons, addresses, ...vendorData } = data;

    let activityTitle = 'Vendor updated';
    let activityDesc = `Vendor details were updated by ${performedBy}`;
    
    if (contactPersons !== undefined) {
      await tx.vendorContactPerson.deleteMany({
        where: { vendorId: id }
      });
      activityTitle = 'Contact updated';
      activityDesc = `Contact persons were updated by ${performedBy}`;
    }

    if (addresses !== undefined) {
      await tx.vendorAddress.deleteMany({
        where: { vendorId: id }
      });
    }

    return tx.vendor.update({
      where: { id },
      data: {
        ...vendorData,
        contactPersons: contactPersons !== undefined && contactPersons.length > 0 ? {
          create: contactPersons.map((cp) => {
            const { id: _id, ...rest } = cp;
            return rest;
          })
        } : undefined,
        addresses: addresses !== undefined && addresses.length > 0 ? {
          create: addresses.map((addr) => {
            const { id: _id, ...rest } = addr;
            return rest;
          })
        } : undefined,
        activities: {
          create: [{
            title: activityTitle,
            description: activityDesc,
            performedBy,
          }]
        }
      },
      include: { contactPersons: true, addresses: true },
    });
  });
}

export async function deleteVendorById(organizationId: string, id: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existingVendor = await tx.vendor.findFirst({
      where: { id, organizationId },
    });

    if (!existingVendor) {
      throw new Error('Vendor not found');
    }

    return tx.vendor.delete({
      where: { id },
    });
  });
}

export async function getVendorActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendorActivity.findMany({
      where: {
        vendorId: id,
        vendor: {
          organizationId
        }
      },
      orderBy: { createdAt: 'desc' },
    })
  );
}

export async function getVendorComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.vendorComment.findMany({
      where: {
        vendorId: id,
        vendor: {
          organizationId
        }
      },
      orderBy: { createdAt: 'desc' },
    })
  );
}

export async function createVendorComment(organizationId: string, id: string, content: string, userId: string | null) {
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
      },
    });
  });
}

export async function deleteVendorComment(organizationId: string, vendorId: string, commentId: string) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.vendorComment.findFirst({
      where: { id: commentId, vendorId, vendor: { organizationId } },
    });

    if (!existingComment) {
      throw new Error('Comment not found');
    }

    return tx.vendorComment.delete({
      where: { id: commentId },
    });
  });
}
