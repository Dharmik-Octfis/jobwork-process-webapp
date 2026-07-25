import { ApiError } from '../../../lib/apiError.ts';
import type { EntityType } from '../customization/custom-fields/customFields.constants.ts';

/**
 * Preset list filters ("All Vendors ▾") — the saved views a user picks from.
 *
 * CODE, not tenant data, like the column catalog: three curated presets per
 * module rather than an open filter builder. User-defined views ("New View") are
 * deliberately NOT built yet; when they are, they become rows in a table and this
 * stays as the built-in set.
 *
 * `where` is a Prisma where-fragment spread into the module's own `where`, so it
 * composes with `organizationId` / `isDeleted` / search rather than replacing them
 * — a filter can never widen a query past its tenant scope.
 */
export interface FilterPreset {
  key: string;
  label: string;
  where: Record<string, unknown>;
}

/** The first entry of each list is the default when no `?filter=` is given. */
export const LIST_FILTERS: Record<EntityType, readonly FilterPreset[]> = {
  vendor: [
    { key: 'all', label: 'All Vendors', where: {} },
    { key: 'active', label: 'Active Vendors', where: { status: 'active' } },
    { key: 'inactive', label: 'Inactive Vendors', where: { status: 'inactive' } },
  ],
  customer: [
    { key: 'all', label: 'All Customers', where: {} },
    { key: 'active', label: 'Active Customers', where: { status: 'active' } },
    { key: 'inactive', label: 'Inactive Customers', where: { status: 'inactive' } },
  ],
  item: [
    // Items carry no status column; `type` (Goods | Service) is the useful split.
    { key: 'all', label: 'All Items', where: {} },
    { key: 'goods', label: 'Goods', where: { type: 'Goods' } },
    { key: 'services', label: 'Services', where: { type: 'Service' } },
  ],
};

/** Key + label only — what the picker renders. */
export function filterOptions(entityType: EntityType): { key: string; label: string }[] {
  return LIST_FILTERS[entityType].map(({ key, label }) => ({ key, label }));
}

/**
 * The where-fragment for a filter key. Omitted/`all` → `{}` (no narrowing). An
 * unrecognised key is a 400 rather than a silent fallback: it means the client
 * asked for a view that does not exist, and quietly showing everything would look
 * like the filter worked.
 */
export function filterWhere<TWhere>(entityType: EntityType, key: string | undefined): TWhere {
  if (!key || key === 'all') return {} as TWhere;
  const preset = LIST_FILTERS[entityType].find((f) => f.key === key);
  if (!preset) {
    throw ApiError.badRequest(
      `Unknown filter "${key}". Expected one of: ${LIST_FILTERS[entityType].map((f) => f.key).join(', ')}.`,
    );
  }
  return preset.where as TWhere;
}
