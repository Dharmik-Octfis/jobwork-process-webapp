import { runAsTenant } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';
import { filterOptions } from './listFilters.catalog.ts';
import {
  CUSTOM_FIELD_PREFIX,
  LIST_COLUMNS,
  defaultVisibleKeys,
  lockedKeys,
  supportsCustomFields,
  type ColumnDef,
  type ListEntityType,
} from './listViews.catalog.ts';

export interface ListViewResponse {
  /** Everything this org COULD show — built-ins plus its own custom fields. */
  catalog: ColumnDef[];
  /** Ordered keys actually shown. Locked keys are always first and always present. */
  visible: string[];
  /**
   * Preset views for the "All Vendors ▾" picker. Served from here rather than
   * hardcoded in the client so the labels live in exactly one place — the same
   * reason the column catalog is served.
   */
  filters: { key: string; label: string }[];
}

/**
 * The catalog for one org: the static built-ins plus this organisation's active
 * custom fields, which is how the picker reaches Zoho-like counts without a
 * migration per field. Custom fields are namespaced `cf:<key>` so they can never
 * collide with a built-in column name.
 */
async function buildCatalog(
  tx: Parameters<Parameters<typeof runAsTenant>[1]>[0],
  organizationId: string,
  entityType: ListEntityType,
): Promise<ColumnDef[]> {
  // A list-only module (permission templates) has no `customFields` column, so
  // there is nothing to merge and no query worth issuing.
  if (!supportsCustomFields(entityType)) return [...LIST_COLUMNS[entityType]];

  const defs = await tx.customFieldDefinition.findMany({
    where: { organizationId, entityType, isDeleted: false, status: 'active' },
    orderBy: { displayOrder: 'asc' },
    select: { key: true, label: true },
  });

  return [
    ...LIST_COLUMNS[entityType],
    ...defs.map((d) => ({ key: `${CUSTOM_FIELD_PREFIX}${d.key}`, label: d.label })),
  ];
}

/**
 * Force the invariants a stored layout must satisfy, whatever is in the row:
 * locked columns first (in catalog order), then the user's chosen order, with
 * anything no longer in the catalog dropped. Applied on read AND on write, so a
 * layout stays valid when a custom field is later archived or a column removed.
 */
function normalise(
  entityType: ListEntityType,
  catalog: ColumnDef[],
  requested: string[],
): string[] {
  const known = new Set(catalog.map((c) => c.key));
  const locked = lockedKeys(entityType);
  const rest = requested.filter((k) => known.has(k) && !locked.includes(k));
  return [...locked, ...Array.from(new Set(rest))];
}

/** The user's layout for one module, plus the catalog the picker renders. */
export async function getListView(
  organizationId: string,
  userId: string,
  entityType: ListEntityType,
): Promise<ListViewResponse> {
  return runAsTenant(organizationId, async (tx) => {
    const catalog = await buildCatalog(tx, organizationId, entityType);

    const pref = await tx.listViewPreference.findFirst({
      where: { organizationId, userId, entityType, isDeleted: false },
      select: { columns: true },
    });

    // No saved layout — fall back to the catalog's defaults.
    const requested = Array.isArray(pref?.columns)
      ? (pref.columns as unknown[]).filter((k): k is string => typeof k === 'string')
      : defaultVisibleKeys(entityType);

    return {
      catalog,
      visible: normalise(entityType, catalog, requested),
      filters: filterOptions(entityType),
    };
  });
}

/**
 * Save a layout. The payload is normalised before it is stored, so locked columns
 * survive a hand-crafted request that tried to drop or reorder them, and unknown
 * keys are rejected rather than persisted.
 */
export async function saveListView(
  organizationId: string,
  userId: string,
  entityType: ListEntityType,
  columns: string[],
): Promise<ListViewResponse> {
  return runAsTenant(organizationId, async (tx) => {
    const catalog = await buildCatalog(tx, organizationId, entityType);
    const known = new Set(catalog.map((c) => c.key));

    const unknown = columns.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      throw ApiError.badRequest('Unknown column(s) for this module.', {
        columns: `Not selectable here: ${unknown.join(', ')}`,
      });
    }

    const visible = normalise(entityType, catalog, columns);

    // Upsert on (userId, organizationId, entityType) and clear isDeleted — the
    // documented way to live with a soft-deleted row holding a unique key.
    await tx.listViewPreference.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { userId_organizationId_entityType: { userId, organizationId, entityType } },
      create: {
        organizationId,
        userId,
        entityType,
        columns: visible,
        createdBy: userId,
        updatedBy: userId,
      },
      update: { columns: visible, isDeleted: false, updatedBy: userId },
    });

    return { catalog, visible, filters: filterOptions(entityType) };
  });
}
