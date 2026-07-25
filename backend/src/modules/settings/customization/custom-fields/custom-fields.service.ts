import { randomBytes } from 'node:crypto';
import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import type { Prisma } from '../../../../../generated/prisma/client.ts';
import {
  MAX_ACTIVE_FIELDS,
  OPTION_TYPES,
  slugifyKey,
  type DataType,
  type EntityType,
} from './customFields.constants.ts';
import type {
  CreateDefinitionInput,
  ReorderInput,
  UpdateDefinitionInput,
} from './custom-fields.schemas.ts';

type JsonRecord = Record<string, unknown>;

/** Ensure a slug is unique within the org+module, INCLUDING archived rows, so a
 * removed field's key can never be handed to a new field. Suffixes _2, _3, … */
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 76)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 68)}_${randomBytes(4).toString('hex')}`;
}

/** Give every dropdown option a stable id (option values reference the id, not the
 * label, so labels stay renameable). Strips options from non-option types. */
function normalizeConfig(dataType: string, config: unknown): JsonRecord {
  const cfg: JsonRecord = config && typeof config === 'object' ? { ...(config as JsonRecord) } : {};

  if ((OPTION_TYPES as readonly string[]).includes(dataType)) {
    const raw = Array.isArray(cfg['options']) ? (cfg['options'] as unknown[]) : [];
    cfg['options'] = raw.map((o, i) => {
      const opt =
        o && typeof o === 'object' ? (o as { id?: string; label?: string; order?: number }) : {};
      return {
        id: opt.id && opt.id.length > 0 ? opt.id : `opt_${randomBytes(5).toString('hex')}`,
        label: String(opt.label ?? '').trim(),
        order: typeof opt.order === 'number' ? opt.order : i,
      };
    });
  } else {
    delete cfg['options'];
  }
  return cfg;
}

/** Active definitions for a module — used to RENDER a record form (any member). */
export function listActiveDefinitions(organizationId: string, entityType: EntityType) {
  return runAsTenant(organizationId, (tx) =>
    tx.customFieldDefinition.findMany({
      where: { organizationId, entityType, isDeleted: false, status: 'active' },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        key: true,
        label: true,
        dataType: true,
        config: true,
        isRequired: true,
        showInPrint: true,
        showInList: true,
        displayOrder: true,
      },
    }),
  );
}

/** All non-archived definitions (active + hidden) for the admin manager. Takes no
 * acting user: authorization is the route's `requirePermission('custom_field:read')`,
 * and a read stamps nothing. */
export async function listDefinitions(organizationId: string, entityType: EntityType) {
  return runAsTenant(organizationId, (tx) =>
    tx.customFieldDefinition.findMany({
      where: { organizationId, entityType, isDeleted: false },
      orderBy: { displayOrder: 'asc' },
    }),
  );
}

export async function createDefinition(
  userId: string,
  organizationId: string,
  input: CreateDefinitionInput,
) {
  return runAsTenant(organizationId, async (tx) => {
    const activeCount = await tx.customFieldDefinition.count({
      where: { organizationId, entityType: input.entityType, isDeleted: false, status: 'active' },
    });
    if (activeCount >= MAX_ACTIVE_FIELDS) {
      throw ApiError.badRequest(
        `This module already has the maximum of ${MAX_ACTIVE_FIELDS} active fields. Archive one to add another.`,
      );
    }

    // Uniqueness spans archived rows on purpose — see uniqueKey / the @@unique.
    const existing = await tx.customFieldDefinition.findMany({
      where: { organizationId, entityType: input.entityType },
      select: { key: true },
    });
    const key = uniqueKey(slugifyKey(input.label), new Set(existing.map((r) => r.key)));

    const maxOrder = await tx.customFieldDefinition.aggregate({
      where: { organizationId, entityType: input.entityType, isDeleted: false },
      _max: { displayOrder: true },
    });

    return tx.customFieldDefinition.create({
      data: {
        organizationId,
        entityType: input.entityType,
        key,
        label: input.label,
        dataType: input.dataType,
        config: normalizeConfig(input.dataType, input.config) as Prisma.InputJsonValue,
        isRequired: input.isRequired,
        showInPrint: input.showInPrint,
        showInList: input.showInList,
        displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        status: 'active',
        createdBy: userId,
        updatedBy: userId,
      },
    });
  });
}

export async function updateDefinition(
  userId: string,
  organizationId: string,
  id: string,
  input: UpdateDefinitionInput,
) {
  return runAsTenant(organizationId, async (tx) => {
    // key and dataType are immutable — they are never read from `input`.
    const existing = await tx.customFieldDefinition.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, dataType: true },
    });
    if (!existing) throw new ApiError(404, 'Custom field not found.');

    const data: Prisma.CustomFieldDefinitionUncheckedUpdateManyInput = { updatedBy: userId };
    if (input.label !== undefined) data.label = input.label;
    if (input.isRequired !== undefined) data.isRequired = input.isRequired;
    if (input.showInPrint !== undefined) data.showInPrint = input.showInPrint;
    if (input.showInList !== undefined) data.showInList = input.showInList;
    if (input.status !== undefined) data.status = input.status;
    if (input.config !== undefined) {
      data.config = normalizeConfig(existing.dataType, input.config) as Prisma.InputJsonValue;
    }

    // Scope the write to the org so an id from another tenant is a no-op (RLS also guards).
    await tx.customFieldDefinition.updateMany({ where: { id, organizationId }, data });
    return tx.customFieldDefinition.findFirst({ where: { id, organizationId } });
  });
}

export async function reorderDefinitions(
  userId: string,
  organizationId: string,
  items: ReorderInput['items'],
) {
  await runAsTenant(organizationId, async (tx) => {
    for (const { id, displayOrder } of items) {
      await tx.customFieldDefinition.updateMany({
        where: { id, organizationId },
        data: { displayOrder, updatedBy: userId },
      });
    }
  });
}

/** Archive (soft-delete). Values stay in the DB and the key stays reserved. */
export async function archiveDefinition(userId: string, organizationId: string, id: string) {
  await runAsTenant(organizationId, async (tx) => {
    const existing = await tx.customFieldDefinition.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, 'Custom field not found.');

    await tx.customFieldDefinition.updateMany({
      where: { id, organizationId },
      data: { isDeleted: true, updatedBy: userId },
    });
  });
}

// Re-export for services that need the value engine alongside the definition API.
export { loadActiveDefinitions, validateCustomFields } from './customFields.engine.ts';
export type { DataType, EntityType };
