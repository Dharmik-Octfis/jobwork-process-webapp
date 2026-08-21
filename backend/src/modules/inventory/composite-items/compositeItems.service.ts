import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type {
  CreateCompositeComponentDto,
  UpdateCompositeComponentDto,
  CreateCompositeItemDto,
  UpdateCompositeItemDto,
} from './compositeItems.schemas.ts';
import { normalizeItemDto } from '../../items/items.service.ts';
import { toItemResponse } from '../../items/items.service.ts';
import type { ListQuery } from '../../../lib/pagination.ts';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import {
  loadActiveDefinitions,
  validateCustomFields,
} from '../../settings/customization/custom-fields/customFields.engine.ts';

export function toComponentResponse(row: Record<string, unknown>) {
  let componentObj = row.component as Record<string, unknown> | undefined;
  if (componentObj && 'itemType' in componentObj) {
    componentObj = { ...componentObj, type: componentObj.itemType };
  }
  return {
    ...row,
    ...(componentObj ? { component: componentObj } : {}),
    qty_per_unit:
      row.qtyPerUnit !== null && row.qtyPerUnit !== undefined ? Number(row.qtyPerUnit) : null,
    composite_item_id: row.compositeItemId,
    component_item_id: row.componentItemId,
    uom_id: row.uomId,
    customFields: row.customFields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    isDeleted: row.isDeleted,
  };
}

export class CompositeItemsService {
  private listWhere(organizationId: string, opts: ListQuery): Prisma.ItemWhereInput {
    return {
      organizationId,
      isDeleted: false,
      itemStructure: 'composite',
      ...filterWhere<Prisma.ItemWhereInput>('item', opts.filter),
      ...searchWhere<Prisma.ItemWhereInput>(opts.search, ['name', 'sku', 'category', 'hsnCode']),
    };
  }

  async findManyItems(organizationId: string, opts: ListQuery) {
    const { page, perPage } = opts;
    return runAsTenant(organizationId, async (tx) => {
      const rows = await tx.item.findMany({
        where: this.listWhere(organizationId, opts),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: takeForPage(perPage),
      });

      const paginated = pageSlice(rows, page, perPage);
      return {
        ...paginated,
        results: paginated.results.map(toItemResponse),
      };
    });
  }

  async countItems(organizationId: string, opts: ListQuery): Promise<number> {
    return runAsTenant(organizationId, (tx) =>
      tx.item.count({ where: this.listWhere(organizationId, opts) }),
    );
  }

  async findUniqueItem(id: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, organizationId, itemStructure: 'composite', isDeleted: false },
      });
      if (!item) {
        throw ApiError.notFound('Composite Item not found');
      }
      return toItemResponse(item);
    });
  }

  async createItem(organizationId: string, rawData: CreateCompositeItemDto, userId?: string) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const {
        customFields: rawCustomFields,
        frontImage,
        rearImage,
        images,
        components,
        ...rest
      } = data;

      if (rest.stockingUomId) {
        const uom = await tx.unitOfMeasurement.findFirst({
          where: { id: rest.stockingUomId, organizationId, isDeleted: false },
          select: { id: true },
        });
        if (!uom) throw ApiError.badRequest('Unknown unit of measurement.');
      } else {
        throw ApiError.badRequest('Composite Item must have stockingUomId set');
      }

      const defs = await loadActiveDefinitions(tx, organizationId, 'item');
      const customFields = validateCustomFields({
        defs,
        input: rawCustomFields,
        mode: 'create',
      }) as Prisma.InputJsonValue;

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) {
          performedBy = user.fullName;
        }
      }

      const item = await tx.item.create({
        data: {
          ...rest,
          itemStructure: 'composite',
          customFields,
          frontImage:
            frontImage === null
              ? Prisma.DbNull
              : frontImage !== undefined
                ? (frontImage as Prisma.InputJsonValue)
                : undefined,
          rearImage:
            rearImage === null
              ? Prisma.DbNull
              : rearImage !== undefined
                ? (rearImage as Prisma.InputJsonValue)
                : undefined,
          images: images ? (images as unknown as Prisma.InputJsonValue) : undefined,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      if (components && Array.isArray(components) && components.length > 0) {
        const seenComponents = new Set<string>();
        // Create components
        for (const comp of components) {
          if (seenComponents.has(comp.componentItemId)) {
            throw ApiError.badRequest(
              'Duplicate component selected. A composite item cannot contain the same component multiple times.',
            );
          }
          seenComponents.add(comp.componentItemId);

          // Spec V3
          if (comp.componentItemId === item.id) {
            throw ApiError.badRequest('Composite item cannot contain itself as a component.');
          }

          // Spec V4, V5, V6, V7
          const cItem = await tx.item.findFirst({
            where: { id: comp.componentItemId, organizationId, isDeleted: false },
          });
          if (!cItem) throw ApiError.badRequest(`Component ${comp.componentItemId} not found.`);
          if (cItem.itemStructure === 'composite')
            throw ApiError.badRequest(`Component ${cItem.name} cannot be a Composite Item.`);

          await tx.compositeItemComponent.create({
            data: {
              organizationId,
              compositeItemId: item.id,
              componentItemId: comp.componentItemId,
              qtyPerUnit: comp.qtyPerUnit,
              uomId: comp.uomId ?? cItem.stockingUomId,
              seq: comp.seq ?? 0,
              notes: comp.notes,
              customFields: comp.customFields
                ? (comp.customFields as Prisma.InputJsonValue)
                : undefined,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            },
          });
        }
      }

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Composite Item Created',
          description: `Composite Item ${item.name} was created.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return toItemResponse(item);
    });
  }

  async updateItem(
    id: string,
    organizationId: string,
    rawData: UpdateCompositeItemDto,
    userId?: string,
  ) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, organizationId, itemStructure: 'composite', isDeleted: false },
      });
      if (!existing) throw ApiError.notFound('Composite Item not found');

      const {
        customFields: rawCustomFields,
        frontImage,
        rearImage,
        images,
        components: _components,
        ...rest
      } = data;

      if (_components && Array.isArray(_components)) {
        // Fetch existing components to compare
        const existingComponents = await tx.compositeItemComponent.findMany({
          where: { compositeItemId: id, organizationId, isDeleted: false },
        });

        const newComponentIds = new Set(_components.map((c) => c.componentItemId).filter(Boolean));

        // Soft delete components that are missing from the payload
        for (const ec of existingComponents) {
          if (!newComponentIds.has(ec.componentItemId)) {
            await tx.compositeItemComponent.update({
              where: { id: ec.id },
              data: { isDeleted: true, updatedBy: userId ?? null },
            });
          }
        }

        const seenComponents = new Set<string>();
        for (const comp of _components) {
          if (!comp.componentItemId) continue;
          if (seenComponents.has(comp.componentItemId)) {
            throw ApiError.badRequest(
              'Duplicate component selected. A composite item cannot contain the same component multiple times.',
            );
          }
          seenComponents.add(comp.componentItemId);

          if (comp.componentItemId === existing.id) {
            throw ApiError.badRequest('Composite item cannot contain itself as a component.');
          }

          const existingComp = existingComponents.find(
            (ec) => ec.componentItemId === comp.componentItemId,
          );

          if (existingComp) {
            await tx.compositeItemComponent.update({
              where: { id: existingComp.id },
              data: {
                qtyPerUnit: comp.qtyPerUnit,
                seq: comp.seq ?? existingComp.seq,
                updatedBy: userId ?? null,
              },
            });
          } else {
            const cItem = await tx.item.findFirst({
              where: { id: comp.componentItemId, organizationId, isDeleted: false },
            });
            if (!cItem) throw ApiError.badRequest(`Component ${comp.componentItemId} not found.`);
            if (cItem.itemStructure === 'composite')
              throw ApiError.badRequest(`Component ${cItem.name} cannot be a Composite Item.`);

            await tx.compositeItemComponent.create({
              data: {
                organizationId,
                compositeItemId: existing.id,
                componentItemId: comp.componentItemId,
                qtyPerUnit: comp.qtyPerUnit,
                uomId: comp.uomId ?? cItem.stockingUomId,
                seq: comp.seq ?? 0,
                notes: comp.notes,
                customFields: comp.customFields
                  ? (comp.customFields as Prisma.InputJsonValue)
                  : undefined,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
              },
            });
          }
        }
      }

      if (rest.stockingUomId && rest.stockingUomId !== existing.stockingUomId) {
        const uom = await tx.unitOfMeasurement.findFirst({
          where: { id: rest.stockingUomId, organizationId, isDeleted: false },
          select: { id: true },
        });
        if (!uom) throw ApiError.badRequest('Unknown unit of measurement.');
      }

      let customFields = existing.customFields as Prisma.InputJsonValue;
      if (rawCustomFields !== undefined) {
        const defs = await loadActiveDefinitions(tx, organizationId, 'item');
        customFields = validateCustomFields({
          defs,
          input: rawCustomFields,
          existing: existing.customFields,
          mode: 'update',
        }) as Prisma.InputJsonValue;
      }

      let performedBy = 'System';
      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (user) performedBy = user.fullName;
      }

      const item = await tx.item.update({
        where: { id },
        data: {
          ...rest,
          customFields,
          frontImage:
            frontImage === null
              ? Prisma.DbNull
              : frontImage !== undefined
                ? (frontImage as Prisma.InputJsonValue)
                : undefined,
          rearImage:
            rearImage === null
              ? Prisma.DbNull
              : rearImage !== undefined
                ? (rearImage as Prisma.InputJsonValue)
                : undefined,
          images: images ? (images as unknown as Prisma.InputJsonValue) : undefined,
          updatedBy: userId ?? null,
        },
      });

      await tx.itemActivity.create({
        data: {
          itemId: item.id,
          title: 'Composite Item Updated',
          description: `Composite Item ${item.name} was updated.`,
          performedBy,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      return toItemResponse(item);
    });
  }
  async findMany(compositeItemId: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const parent = await tx.item.findFirst({
        where: { id: compositeItemId, organizationId, isDeleted: false },
      });
      if (!parent || parent.itemStructure !== 'composite') {
        throw ApiError.notFound('Composite Item not found');
      }

      const rows = await tx.compositeItemComponent.findMany({
        where: { compositeItemId, organizationId, isDeleted: false },
        orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
        include: {
          component: {
            select: {
              id: true,
              name: true,
              sku: true,
              unit: true,
              stockingUomId: true,
              itemType: true,
              sellingPrice: true,
              costPrice: true,
              openingStock: true,
              stockingUom: { select: { unitName: true } },
            },
          },
        },
      });

      const componentIds = rows.map((r) => r.componentItemId);
      type ComponentBalance = { itemId: string; qty: Prisma.Decimal | null };
      let balances: ComponentBalance[] = [];
      if (componentIds.length > 0) {
        balances = await tx.$queryRaw<ComponentBalance[]>`
          SELECT item_id as "itemId", SUM(qty_in - qty_out) as qty
          FROM stock_ledger
          WHERE item_id IN (${Prisma.join(componentIds)})
            AND organization_id = ${organizationId}::uuid
          GROUP BY item_id
        `;
      }

      return rows.map((row) => {
        // No ledger row at all means the item predates the ledger, so opening stock is
        // the only figure there is — which is not the same as a ledger that nets to zero.
        const bal = balances.find((b) => b.itemId === row.componentItemId);
        return toComponentResponse({
          ...row,
          component: {
            ...row.component,
            stockOnHand: bal ? Number(bal.qty ?? 0) : Number(row.component.openingStock ?? 0),
            unit: row.component.stockingUom?.unitName || row.component.unit || '',
          },
        });
      });
    });
  }

  async findUnique(id: string, compositeItemId: string, organizationId: string) {
    return runAsTenant(organizationId, async (tx) => {
      const row = await tx.compositeItemComponent.findFirst({
        where: { id, compositeItemId, organizationId, isDeleted: false },
      });
      if (!row) throw ApiError.notFound('Component not found');
      return toComponentResponse(row);
    });
  }

  async create(
    compositeItemId: string,
    organizationId: string,
    rawData: CreateCompositeComponentDto,
    userId?: string,
  ) {
    return runAsTenant(organizationId, async (tx) => {
      const parent = await tx.item.findFirst({
        where: { id: compositeItemId, organizationId, isDeleted: false },
      });
      if (!parent || parent.itemType !== 'Composite Item') {
        throw ApiError.notFound('Composite Item not found');
      }

      const component = await tx.item.findFirst({
        where: { id: rawData.componentItemId, organizationId, isDeleted: false },
      });
      if (!component) throw ApiError.notFound('Component item not found');

      if (compositeItemId === rawData.componentItemId) {
        throw ApiError.badRequest('An item cannot be a component of itself.');
      }

      const existingComponent = await tx.compositeItemComponent.findFirst({
        where: {
          compositeItemId,
          componentItemId: rawData.componentItemId,
          organizationId,
          isDeleted: false,
        },
      });
      if (existingComponent) {
        throw ApiError.badRequest('This component is already part of the composite item.');
      }

      const defs = await loadActiveDefinitions(tx, organizationId, 'composite_item_component');
      const customFields = validateCustomFields({
        defs,
        input: rawData.customFields,
        mode: 'create',
      }) as Prisma.InputJsonValue;

      const { customFields: _customFields, qtyPerUnit, componentItemId, uomId, ...rest } = rawData;

      return withUniqueViolation('This item is already a component of this composite item.', () =>
        tx.compositeItemComponent
          .create({
            data: {
              ...rest,
              qtyPerUnit: new Prisma.Decimal(qtyPerUnit),
              organizationId,
              compositeItemId,
              componentItemId,
              uomId: uomId ?? component.stockingUomId,
              customFields,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            },
          })
          .then(toComponentResponse),
      );
    });
  }

  async update(
    id: string,
    compositeItemId: string,
    organizationId: string,
    rawData: UpdateCompositeComponentDto,
    userId?: string,
  ) {
    return runAsTenant(organizationId, async (tx) => {
      const row = await tx.compositeItemComponent.findFirst({
        where: { id, compositeItemId, organizationId, isDeleted: false },
      });
      if (!row) throw ApiError.notFound('Component not found');

      let customFields: Prisma.InputJsonValue | undefined;
      if (rawData.customFields !== undefined) {
        const defs = await loadActiveDefinitions(tx, organizationId, 'composite_item_component');
        customFields = validateCustomFields({
          defs,
          input: rawData.customFields,
          mode: 'update',
          existing: row.customFields,
        }) as Prisma.InputJsonValue;
      }

      const { customFields: _customFields, qtyPerUnit, componentItemId, uomId, ...rest } = rawData;

      if (componentItemId) {
        if (componentItemId === compositeItemId) {
          throw ApiError.badRequest('An item cannot be a component of itself.');
        }
        const comp = await tx.item.findFirst({
          where: { id: componentItemId, organizationId, isDeleted: false },
        });
        if (!comp) throw ApiError.notFound('Component item not found');
      }

      return withUniqueViolation('This item is already a component of this composite item.', () =>
        tx.compositeItemComponent
          .update({
            where: { id },
            data: {
              ...rest,
              ...(qtyPerUnit !== undefined ? { qtyPerUnit: new Prisma.Decimal(qtyPerUnit) } : {}),
              ...(componentItemId !== undefined ? { componentItemId } : {}),
              ...(uomId !== undefined ? { uomId } : {}),
              ...(customFields !== undefined ? { customFields } : {}),
              updatedBy: userId ?? null,
            },
          })
          .then(toComponentResponse),
      );
    });
  }

  async delete(id: string, compositeItemId: string, organizationId: string, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      const row = await tx.compositeItemComponent.findFirst({
        where: { id, compositeItemId, organizationId, isDeleted: false },
      });
      if (!row) throw ApiError.notFound('Component not found');

      const deleted = await tx.compositeItemComponent.update({
        where: { id },
        data: { isDeleted: true, updatedBy: userId ?? null },
      });
      return toComponentResponse(deleted);
    });
  }
}

export const compositeItemsService = new CompositeItemsService();
