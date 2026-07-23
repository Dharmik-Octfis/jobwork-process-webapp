import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../../lib/apiError.ts';

/** Message for the (organizationId, unitName) unique index. */
const DUPLICATE_NAME = 'Unit name already exists in this organization.';

interface CreateUomData {
  unitName: string;
  symbol: string;
  uqc: string;
  unitPrecision: number;
}

interface UpdateUomData {
  unitName?: string;
  symbol?: string;
  uqc?: string;
  unitPrecision?: number;
}

export const getUomList = async (orgId: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.unitOfMeasurement.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
      },
      orderBy: {
        unitName: 'asc',
      },
    }),
  );
};

export const createNewUom = async (orgId: string, data: CreateUomData, userId?: string) => {
  return runAsTenant(orgId, (tx) =>
    withUniqueViolation(DUPLICATE_NAME, () =>
      tx.unitOfMeasurement.create({
        data: {
          organizationId: orgId,
          unitName: data.unitName,
          symbol: data.symbol,
          uqc: data.uqc,
          unitPrecision: data.unitPrecision,
          createdBy: userId,
          updatedBy: userId,
        },
      }),
    ),
  );
};

export const getUomById = async (orgId: string, id: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.unitOfMeasurement.findFirst({
      where: {
        id,
        organizationId: orgId,
        isDeleted: false,
      },
    }),
  );
};

export const updateUomById = async (
  orgId: string,
  id: string,
  data: UpdateUomData,
  userId?: string,
) => {
  return runAsTenant(orgId, async (tx) => {
    const existingUom = await tx.unitOfMeasurement.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });

    if (!existingUom) {
      throw ApiError.notFound('UOM not found');
    }

    return withUniqueViolation(DUPLICATE_NAME, () =>
      tx.unitOfMeasurement.update({
        where: { id },
        data: {
          ...data,
          updatedBy: userId,
        },
      }),
    );
  });
};

export const deleteUomById = async (orgId: string, id: string, userId?: string) => {
  return runAsTenant(orgId, async (tx) => {
    const existingUom = await tx.unitOfMeasurement.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });

    if (!existingUom) {
      throw ApiError.notFound('UOM not found');
    }

    return tx.unitOfMeasurement.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedBy: userId,
      },
    });
  });
};
