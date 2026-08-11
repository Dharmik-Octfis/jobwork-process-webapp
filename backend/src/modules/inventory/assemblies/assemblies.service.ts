import { runAsTenant} from '../../../db/prisma.js';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.js';
import { reserveSuppliedNumber } from '../../../lib/numberSequence.js';
import type { CreateAssemblyDto } from './assemblies.schemas.js';
import type { ListQuery } from '../../../lib/pagination.js';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.js';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.js';
import { Prisma } from '../../../../generated/prisma/client.ts';

export const assembliesService = {
  listWhere: (organizationId: string, opts: ListQuery): Prisma.ItemAssemblyWhereInput => {
    return {
      organizationId,
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
        },
      });

      const results = records.map((r) => ({
        ...r,
        qty: Number(r.qty),
      }));

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
      const processedLines: Prisma.ItemAssemblyLineUncheckedCreateWithoutAssemblyInput[] = [];
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
          organizationId: orgId,
          itemId: line.itemId,
          lotId: lotId,
          qtyPerUnit: line.qtyRequired / data.qty,
          qty: line.qtyRequired,
          createdBy: userId,
          updatedBy: userId,
        });
      }

      const assembly = await withUniqueViolation('Assembly number already exists in this organization.', () =>
        tx.itemAssembly.create({
          data: {
            organizationId: orgId,
            assemblyNumber,
            assemblyDate: new Date(data.assemblyDate),
            compositeItemId: data.compositeItemId,
            qty: data.qty,
            locationId: data.locationId,
            remarks: data.remarks,
            createdBy: userId,
            updatedBy: userId,
            direction: 'assemble',
            status: 'assembled',
            lines: {
              create: processedLines,
            },
          },
          include: {
            lines: true,
          },
        })
      );

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
                select: { name: true, sku: true, type: true, stockingUomId: true, stockingUom: { select: { unitName: true } } },
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
        lines: assembly.lines.map((line) => ({
          ...line,
          qty: Number(line.qty),
          qtyPerUnit: Number(line.qtyPerUnit),
          unitValue: Number(line.unitValue || 0),
          value: Number(line.value || 0),
        })),
      };
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
