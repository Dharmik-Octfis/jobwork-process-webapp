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

const live = { where: { isDeleted: false } };

export const deleteUomById = async (orgId: string, id: string, userId?: string) => {
  return runAsTenant(orgId, async (tx) => {
    // One query with a sub-count per referencing table. The ledger has no
    // isDeleted and is counted whole: stock already moved in a unit keeps it forever.
    const existingUom = await tx.unitOfMeasurement.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      select: {
        unitName: true,
        _count: {
          select: {
            stockedItems: live,
            ledgerEntries: true,
            batches: live,
            batchUnits: live,
            compositeComponentRows: live,
            itemAssemblies: live,
            itemAssemblyLines: live,
            jobOrderInputUoms: live,
            routeStepInputUoms: live,
            routeStepOutputUoms: live,
            jobOrderStepInputUoms: live,
            jobOrderStepOutputUoms: live,
            jobOrderStepOutputComponentUoms: live,
            jobIssueLineUoms: live,
            jobReceiptOutputRowUoms: live,
          },
        },
      },
    });

    if (!existingUom) {
      throw ApiError.notFound('UOM not found');
    }

    const c = existingUom._count;
    const uses = [
      [c.stockedItems, 'item'],
      [c.ledgerEntries, 'stock movement'],
      [c.batches + c.batchUnits, 'batch'],
      [
        c.compositeComponentRows + c.itemAssemblies + c.itemAssemblyLines,
        'composite or assembly row',
      ],
      [
        c.jobOrderInputUoms +
          c.routeStepInputUoms +
          c.routeStepOutputUoms +
          c.jobOrderStepInputUoms +
          c.jobOrderStepOutputUoms +
          c.jobOrderStepOutputComponentUoms +
          c.jobIssueLineUoms +
          c.jobReceiptOutputRowUoms,
        'job work row',
      ],
    ] as const;
    const inUse = uses
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
    if (inUse.length > 0) {
      throw ApiError.conflict(
        `${existingUom.unitName} is used by ${inUse.join(', ')}, so it cannot be deleted.`,
      );
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
