import { prisma as db } from '../../../../db/prisma.ts';
import type { CreateLocationPayload, UpdateLocationPayload } from './locations.schemas.js';

export async function getLocations(orgId: string, search?: string) {
  const where = { organizationId: orgId, isDeleted: false, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) };
  return db.location.findMany({ where, orderBy: { name: 'asc' } });
}

export async function getLocationById(orgId: string, id: string) {
  return db.location.findFirst({ where: { id, organizationId: orgId, isDeleted: false } });
}

export async function createLocation(orgId: string, userId: string, data: CreateLocationPayload) {
  return db.location.create({
    data: {
      ...data,
      organizationId: orgId,
      createdBy: userId,
      updatedBy: userId,
    },
  });
}

export async function updateLocation(orgId: string, id: string, userId: string, data: UpdateLocationPayload) {
  return db.location.updateMany({
    where: { id, organizationId: orgId, isDeleted: false },
    data: { ...data, updatedBy: userId },
  });
}

export async function deleteLocation(orgId: string, id: string) {
  return db.location.updateMany({
    where: { id, organizationId: orgId, isDeleted: false },
    data: { isDeleted: true },
  });
}
