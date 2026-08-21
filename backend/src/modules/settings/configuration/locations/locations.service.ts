import { runAsTenant } from '../../../../db/prisma.ts';
import type { CreateLocationPayload, UpdateLocationPayload } from './locations.schemas.js';

export async function getLocations(orgId: string, search?: string) {
  return runAsTenant(orgId, (tx) => {
    const where = {
      organizationId: orgId,
      isDeleted: false,
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    return tx.location.findMany({ where, orderBy: { name: 'asc' } });
  });
}

export async function getLocationById(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.location.findFirst({ where: { id, organizationId: orgId, isDeleted: false } })
  );
}

export async function createLocation(orgId: string, userId: string, data: CreateLocationPayload) {
  return runAsTenant(orgId, (tx) =>
    tx.location.create({
      data: {
        ...data,
        organizationId: orgId,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  );
}

export async function updateLocation(
  orgId: string,
  id: string,
  userId: string,
  data: UpdateLocationPayload,
) {
  return runAsTenant(orgId, (tx) =>
    tx.location.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { ...data, updatedBy: userId },
    })
  );
}

export async function deleteLocation(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.location.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { isDeleted: true },
    })
  );
}

export async function markLocationAsPrimary(orgId: string, id: string, userId: string) {
  return runAsTenant(orgId, async (tx) => {
    await tx.location.updateMany({
      where: { organizationId: orgId, isDeleted: false },
      data: { isPrimary: false, updatedBy: userId },
    });
    
    await tx.location.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { isPrimary: true, updatedBy: userId },
    });
  });
}
