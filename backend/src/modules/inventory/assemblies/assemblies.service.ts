import { runAsTenant} from '../../../db/prisma.js';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.js';
import { reserveSuppliedNumber } from '../../../lib/numberSequence.js';
import type { CreateAssemblyDto } from './assemblies.schemas.js';
import type { ListQuery } from '../../../lib/pagination.js';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.js';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.js';
import { getBalance } from '../stock-ledger/stockLedger.service.js';
import { Prisma } from '../../../../generated/prisma/client.ts';

function decimal(value: Prisma.Decimal | number | string | null | undefined | unknown): Prisma.Decimal {
  return new Prisma.Decimal(value as Prisma.Decimal | number | string | null | undefined ?? 0);
}

type AssemblyLineValueInput = {
  lotId: string;
  qty: unknown;
  unitValue?: unknown;
  value?: unknown;
};

type AssemblyLineValueResult = {
  unitValue: Prisma.Decimal;
  value: Prisma.Decimal;
};

async function resolveAssemblyLineValue(
  tx: Parameters<Parameters<typeof runAsTenant>[1]>[0],
  orgId: string,
  locationId: string,
  assemblyDate: Date,
  line: AssemblyLineValueInput,
): Promise<AssemblyLineValueResult> {
  const storedUnitValue = decimal(line.unitValue);
  const storedValue = decimal(line.value);
  if (!storedUnitValue.isZero() || !storedValue.isZero()) {
    return {
      unitValue: storedUnitValue,
      value: storedValue,
    };
  }

  const balance = await getBalance(tx, {
    organizationId: orgId,
    lotId: line.lotId,
    locationId,
    asOf: assemblyDate,
  });
  const unitValue = balance.qty.greaterThan(0) ? balance.value.dividedBy(balance.qty) : decimal(0);
  const qty = decimal(line.qty);

  return {
    unitValue,
    value: unitValue.times(qty).toDecimalPlaces(4),
  };
}

async function resolveAssemblySnapshot<T extends AssemblyLineValueInput>(
  tx: Parameters<Parameters<typeof runAsTenant>[1]>[0],
  orgId: string,
  locationId: string,
  assemblyDate: Date,
  lines: readonly T[],
): Promise<{
  resolvedLines: Array<T & AssemblyLineValueResult>;
  componentValue: Prisma.Decimal;
  totalValue: Prisma.Decimal;
}> {
  const resolvedLines = await Promise.all(
    lines.map(async (line) => ({
      ...line,
      ...(await resolveAssemblyLineValue(tx, orgId, locationId, assemblyDate, line)),
    })),
  );

  const componentValue = resolvedLines.reduce((sum, line) => sum.plus(line.value), decimal(0));
  return {
    resolvedLines,
    componentValue,
    totalValue: componentValue,
  };
}

export const assembliesService = {
  listWhere: (organizationId: string, opts: ListQuery): Prisma.ItemAssemblyWhereInput => {
    return {
      organizationId,
      isDeleted: false,
      ...filterWhere<Prisma.ItemAssemblyWhereInput>('item_assembly', opts.filter),
      ...searchWhere<Prisma.ItemAssemblyWhereInput>(opts.search, ['assemblyNumber', 'remarks']),
    };
  },

  findManyAssemblies: async (orgId: string, opts: ListQuery) => {
    return runAsTenant(orgId, async (tx) => {
      const records = await tx.itemAssembly.findMany({
        where: assembliesService.listWhere(orgId, opts),
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.perPage,
        take: takeForPage(opts.perPage),
        include: {
          compositeItem: {
            select: { name: true, sku: true },
          },
          lines: {
            select: {
              qty: true,
              unitValue: true,
              value: true,
              item: { select: { costPrice: true } },
            },
          },
        },
      });

      const results = records.map((record) => {
        const computedComponentValue = record.lines.reduce((sum, line) => {
          const val = Number(line.value);
          const computed = val > 0 ? val : Number(line.qty) * Number(line.item.costPrice || 0);
          return sum + computed;
        }, 0);

        return {
          ...record,
          qty: Number(record.qty),
          totalValue: computedComponentValue + Number(record.additionalCost),
          componentValue: computedComponentValue,
          additionalCost: Number(record.additionalCost),
        };
      });

      return pageSlice(results, opts.page, opts.perPage);
    });
  },

  countAssemblies: async (orgId: string, opts: ListQuery) => {
    return runAsTenant(orgId, async (tx) => {
      return tx.itemAssembly.count({
        where: assembliesService.listWhere(orgId, opts),
      });
    });
  },

  createAssembly: async (orgId: string, userId: string, data: CreateAssemblyDto) => {
    return runAsTenant(orgId, async (tx) => {
      // 1. Validate that the composite item exists and belongs to the org
      const compositeItem = await tx.item.findFirst({
        where: { id: data.compositeItemId, organizationId: orgId, itemType: 'Composite Item' },
      });

      if (!compositeItem) {
        throw ApiError.notFound('Composite item not found.');
      }

      // 2. Validate location exists
      const location = await tx.location.findFirst({
        where: { id: data.locationId, organizationId: orgId },
      });

      if (!location) {
        throw ApiError.notFound('Location not found.');
      }

      // 3. Generate assembly number if not provided
      const assemblyNumber = data.assemblyNumber;
      if (!assemblyNumber) {
        throw ApiError.badRequest('Assembly number is required');
      }

      await reserveSuppliedNumber(tx, orgId, 'assembly', assemblyNumber);

      // 4. Create the ItemAssembly and ItemAssemblyLines
      const processedLines: Array<{
        itemId: string;
        lotId: string;
        qtyPerUnit: Prisma.Decimal;
        qty: Prisma.Decimal;
        createdBy: string | null;
        updatedBy: string | null;
      }> = [];
      const lotCache = new Map<string, string>();

      for (const line of data.lines) {
        const lineItem = await tx.item.findFirst({ where: { id: line.itemId, organizationId: orgId, isDeleted: false } });
        if (!lineItem) throw ApiError.notFound(`Component item not found.`);
        if (lineItem.type === 'Goods' && !lineItem.stockingUomId) throw ApiError.badRequest(`Component ${lineItem.name} must have a stocking unit.`);
        if (lineItem.itemType === 'Composite Item') throw ApiError.badRequest(`Component ${lineItem.name} cannot be a Composite Item.`);

        let lotId = lotCache.get(line.itemId);

        if (!lotId) {
          let lot = await tx.lot.findFirst({ where: { itemId: line.itemId, organizationId: orgId } });
          if (!lot) {
            lot = await tx.lot.create({
              data: {
                organizationId: orgId,
                itemId: line.itemId,
                lotNumber: `DEFAULT-${line.itemId}`,
                createdBy: userId,
                updatedBy: userId,
              }
            });
          }
          lotId = lot.id;
          lotCache.set(line.itemId, lotId);
        }

      processedLines.push({
        itemId: line.itemId,
        lotId: lotId,
        qtyPerUnit: decimal(line.qtyRequired).dividedBy(decimal(data.qty)),
        qty: decimal(line.qtyRequired),
        createdBy: userId,
        updatedBy: userId,
      });
      }

      const assemblyDate = new Date(data.assemblyDate);
      const snapshot = await resolveAssemblySnapshot(tx, orgId, data.locationId, assemblyDate, processedLines);

      const assembly = await withUniqueViolation('Assembly number already exists in this organization.', () =>
        tx.itemAssembly.create({
          data: {
            organizationId: orgId,
            assemblyNumber,
            assemblyDate,
            compositeItemId: data.compositeItemId,
            qty: data.qty,
            locationId: data.locationId,
            remarks: data.remarks,
            createdBy: userId,
            updatedBy: userId,
            direction: 'assemble',
            status: 'assembled',
            componentValue: snapshot.componentValue,
            totalValue: snapshot.totalValue,
            lines: {
              create: snapshot.resolvedLines.map((line) => ({
                organizationId: orgId,
                itemId: line.itemId,
                lotId: line.lotId,
                qtyPerUnit: line.qtyPerUnit,
                qty: line.qty,
                unitValue: line.unitValue,
                value: line.value,
                createdBy: userId,
                updatedBy: userId,
              })),
            },
          },
          include: {
            lines: true,
          },
        })
      );

      // 6. Log activity
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const performedBy = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'System';

      await tx.itemAssemblyActivity.create({
        data: {
          organizationId: orgId,
          assemblyId: assembly.id,
          title: 'Assembly Created',
          description: `Assembly ${assembly.assemblyNumber} was created.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      return assembly;
    });
  },

  getAssemblyById: async (orgId: string, id: string) => {
    return runAsTenant(orgId, async (tx) => {
      const assembly = await tx.itemAssembly.findUnique({
        where: { id, organizationId: orgId },
        include: {
          compositeItem: {
            select: { name: true, sku: true },
          },
          location: {
            select: { name: true },
          },
          lines: {
            include: {
              item: {
                select: { name: true, sku: true, type: true, stockingUomId: true, costPrice: true, stockingUom: { select: { unitName: true } } },
              },
            },
          },
        },
      });

      if (!assembly) {
        throw ApiError.notFound('Assembly not found.');
      }

      return {
        ...assembly,
        qty: Number(assembly.qty),
        totalValue: Number(assembly.totalValue),
        componentValue: Number(assembly.componentValue),
        additionalCost: Number(assembly.additionalCost),
        lines: await Promise.all(assembly.lines.map(async (line) => {
          const resolved = await resolveAssemblyLineValue(
            tx,
            orgId,
            assembly.locationId,
            new Date(assembly.assemblyDate),
            line,
          );
          return {
          ...line,
          qty: Number(line.qty),
          qtyPerUnit: Number(line.qtyPerUnit),
            unitValue: Number(resolved.unitValue) > 0 ? Number(resolved.unitValue) : Number(line.item.costPrice || 0),
            value: Number(resolved.value) > 0 ? Number(resolved.value) : Number(line.qty) * Number(line.item.costPrice || 0),
          };
        })),
      };
    });
  },

  deleteAssembly: async (orgId: string, id: string) => {
    return runAsTenant(orgId, async (tx) => {
      // 1. Check if it exists
      const existing = await tx.itemAssembly.findFirst({
        where: { id, organizationId: orgId, isDeleted: false },
      });
      if (!existing) {
        throw ApiError.notFound('Assembly not found');
      }

      // 2. Soft delete the assembly (we don't post reversing ledger entries here yet as per plan, 
      // but in real world we'd need to if it was posted to ledger)
      const updated = await tx.itemAssembly.update({
        where: { id },
        data: {
          isDeleted: true,
          status: 'cancelled',
        },
      });

      // 3. Log activity
      await tx.itemAssemblyActivity.create({
        data: {
          organizationId: orgId,
          assemblyId: id,
          title: 'Assembly Deleted',
          description: `Assembly ${existing.assemblyNumber} was marked as deleted.`,
          performedBy: 'System',
        },
      });

      return updated;
    });
  },

  getAssemblyActivities: async (organizationId: string, assemblyId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.itemAssemblyActivity.findMany({
        where: { assemblyId, organizationId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  },

  getAssemblyComments: async (organizationId: string, assemblyId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.itemAssemblyComment.findMany({
        where: { assemblyId, organizationId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  },

  createAssemblyComment: async (organizationId: string, assemblyId: string, userId: string, content: string) => {
    return runAsTenant(organizationId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const performedBy = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : null;

      return tx.itemAssemblyComment.create({
        data: {
          organizationId,
          assemblyId,
          content,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    });
  },

  deleteAssemblyComment: async (organizationId: string, assemblyId: string, commentId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      const existingComment = await tx.itemAssemblyComment.findFirst({
        where: { id: commentId, assemblyId, organizationId, isDeleted: false },
      });

      if (!existingComment) {
        throw ApiError.notFound('Comment not found');
      }

      return tx.itemAssemblyComment.update({
        where: { id: commentId },
        data: {
          isDeleted: true,
        },
      });
    });
  },

  getNumberPreference: async (organizationId: string) => {
    return runAsTenant(organizationId, async (tx) => {
      let seq = await tx.numberSequence.findUnique({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { organizationId_entityType: { organizationId, entityType: 'assembly' } },
      });
      if (!seq) {
        seq = await tx.numberSequence.create({
          data: {
            organizationId,
            entityType: 'assembly',
            prefix: 'ASM-',
            nextNumber: 1,
          },
        });
      }
      return seq;
    });
  },

  updateNumberPreference: async (organizationId: string, prefix: string, nextNumber: number) => {
    return runAsTenant(organizationId, async (tx) => {
      return tx.numberSequence.upsert({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { organizationId_entityType: { organizationId, entityType: 'assembly' } },
        create: {
          organizationId,
          entityType: 'assembly',
          prefix,
          nextNumber,
        },
        update: {
          prefix,
          nextNumber,
        },
      });
    });
  },
};
