import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import type { CreateCompositeComponentDto, UpdateCompositeComponentDto, CreateCompositeItemDto, UpdateCompositeItemDto } from './compositeItems.schemas.ts';
import { normalizeItemDto } from '../../items/items.service.ts';
import { toItemResponse } from '../../items/items.service.ts';
import type { ListQuery } from '../../../lib/pagination.ts';
import { takeForPage, pageSlice, searchWhere } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { loadActiveDefinitions, validateCustomFields } from '../../settings/customization/custom-fields/customFields.engine.ts';

export function toComponentResponse(row: Record<string, unknown> | null | undefined) {
  if (!row) return row;
  return {
    ...row,
    qty_per_unit: row.qtyPerUnit !== null && row.qtyPerUnit !== undefined ? Number(row.qtyPerUnit) : null,
    composite_item_id: row.compositeItemId,
    component_item_id: row.componentItemId,
    uom_id: row.uomId,
    custom_fields: row.customFields,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    is_deleted: row.isDeleted,
  };
}

export class CompositeItemsService {
  private listWhere(organizationId: string, opts: ListQuery): Prisma.ItemWhereInput {
    return {
      organizationId,
      isDeleted: false,
      itemType: 'Composite Item',
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
        where: { id, organizationId, itemType: 'Composite Item', isDeleted: false },
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
      const { customFields: rawCustomFields, frontImage, rearImage, images, components, ...rest } = data;

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
          itemType: 'Composite Item',
          customFields,
          frontImage: frontImage === null ? Prisma.DbNull : frontImage !== undefined ? (frontImage as Prisma.InputJsonValue) : undefined,
          rearImage: rearImage === null ? Prisma.DbNull : rearImage !== undefined ? (rearImage as Prisma.InputJsonValue) : undefined,
          images: images ? (images as unknown as Prisma.InputJsonValue) : undefined,
          organizationId,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });

      if (components && Array.isArray(components) && components.length > 0) {
        // Create components
        for (const comp of components) {
          // Spec V3
          if (comp.component_item_id === item.id) {
            throw ApiError.badRequest('Composite item cannot contain itself as a component.');
          }
          
          // Spec V4, V5, V6, V7
          const cItem = await tx.item.findFirst({
            where: { id: comp.component_item_id, organizationId, isDeleted: false }
          });
          if (!cItem) throw ApiError.badRequest(`Component ${comp.component_item_id} not found.`);
          if (cItem.type !== 'Goods') throw ApiError.badRequest(`Component ${cItem.name} must be Goods.`);
          if (!cItem.stockingUomId) throw ApiError.badRequest(`Component ${cItem.name} must have a stocking unit.`);
          if (cItem.itemType === 'Composite Item') throw ApiError.badRequest(`Component ${cItem.name} cannot be a Composite Item.`);

          await tx.compositeItemComponent.create({
            data: {
              organizationId,
              compositeItemId: item.id,
              componentItemId: comp.component_item_id,
              qtyPerUnit: comp.qty_per_unit,
              uomId: comp.uom_id ?? cItem.stockingUomId,
              seq: comp.seq ?? 0,
              notes: comp.notes,
              customFields: comp.custom_fields ? (comp.custom_fields as Prisma.InputJsonValue) : undefined,
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

  async updateItem(id: string, organizationId: string, rawData: UpdateCompositeItemDto, userId?: string) {
    const data = normalizeItemDto(rawData);
    return runAsTenant(organizationId, async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, organizationId, itemType: 'Composite Item', isDeleted: false },
      });
      if (!existing) throw ApiError.notFound('Composite Item not found');

      const { customFields: rawCustomFields, frontImage, rearImage, images, components: _components, ...rest } = data;

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
          frontImage: frontImage === null ? Prisma.DbNull : frontImage !== undefined ? (frontImage as Prisma.InputJsonValue) : undefined,
          rearImage: rearImage === null ? Prisma.DbNull : rearImage !== undefined ? (rearImage as Prisma.InputJsonValue) : undefined,
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
      if (!parent || parent.type !== 'Composite Item') {
        throw ApiError.notFound('Composite Item not found');
      }

      const rows = await tx.compositeItemComponent.findMany({
        where: { compositeItemId, organizationId, isDeleted: false },
        orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
        include: {
          component: { select: { name: true, sku: true, unit: true, stockingUomId: true } },
        }
      });
      return rows.map(toComponentResponse);
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

  async create(compositeItemId: string, organizationId: string, rawData: CreateCompositeComponentDto, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      const parent = await tx.item.findFirst({
        where: { id: compositeItemId, organizationId, isDeleted: false },
      });
      if (!parent || parent.type !== 'Composite Item') {
        throw ApiError.notFound('Composite Item not found');
      }

      const component = await tx.item.findFirst({
        where: { id: rawData.component_item_id, organizationId, isDeleted: false },
      });
      if (!component) throw ApiError.notFound('Component item not found');
      
      if (compositeItemId === rawData.component_item_id) {
        throw ApiError.badRequest('An item cannot be a component of itself.');
      }

      const defs = await loadActiveDefinitions(tx, organizationId, 'composite_item_component');
      const customFields = validateCustomFields({
        defs,
        input: rawData.custom_fields,
        mode: 'create',
      }) as Prisma.InputJsonValue;

      const { custom_fields: _customFields, qty_per_unit: qtyPerUnit, component_item_id: componentItemId, uom_id: uomId, ...rest } = rawData;

      return withUniqueViolation('This item is already a component of this composite item.', () =>
        tx.compositeItemComponent.create({
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
          }
        }).then(toComponentResponse)
      );
    });
  }

  async update(id: string, compositeItemId: string, organizationId: string, rawData: UpdateCompositeComponentDto, userId?: string) {
    return runAsTenant(organizationId, async (tx) => {
      const row = await tx.compositeItemComponent.findFirst({
        where: { id, compositeItemId, organizationId, isDeleted: false },
      });
      if (!row) throw ApiError.notFound('Component not found');

      let customFields: Prisma.InputJsonValue | undefined;
      if (rawData.custom_fields !== undefined) {
        const defs = await loadActiveDefinitions(tx, organizationId, 'composite_item_component');
        customFields = validateCustomFields({
          defs,
          input: rawData.custom_fields,
          mode: 'update',
          existing: row.customFields,
        }) as Prisma.InputJsonValue;
      }

      const { custom_fields: _customFields, qty_per_unit: qtyPerUnit, component_item_id: componentItemId, uom_id: uomId, ...rest } = rawData;

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
        tx.compositeItemComponent.update({
          where: { id },
          data: {
            ...rest,
            ...(qtyPerUnit !== undefined ? { qtyPerUnit: new Prisma.Decimal(qtyPerUnit) } : {}),
            ...(componentItemId !== undefined ? { componentItemId } : {}),
            ...(uomId !== undefined ? { uomId } : {}),
            ...(customFields !== undefined ? { customFields } : {}),
            updatedBy: userId ?? null,
          }
        }).then(toComponentResponse)
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
