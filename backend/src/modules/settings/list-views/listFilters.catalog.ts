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
    { key: 'all', label: 'Active Items', where: { isActive: true } },
    { key: 'all_items', label: 'All Items', where: {} },
    { key: 'inactive', label: 'Inactive Items', where: { isActive: false } },
    { key: 'goods', label: 'Goods', where: { type: 'Goods' } },
    { key: 'services', label: 'Services', where: { type: 'Service' } },
  ],
  /**
   * Users. The first entry is the default, so an admin opening Settings → Users
   * lands on **Active Users** — the people who can actually sign in today, which is
   * what they are looking for almost every time. (Same trick the `item` list uses:
   * the key stays `all` because it is the default slot, while the label and `where`
   * narrow it.)
   *
   * 🔴 `unconfirmed` is the one preset whose rows do NOT come from `memberships` —
   * an invited person has no membership row yet. `members.service.ts` branches on
   * this key and queries `invitations` instead, so the `where` here is empty and
   * unused. It is still declared here because this file is the single place list
   * filter LABELS live, and splitting one module's presets across two files is how
   * the dropdown and the query drift apart.
   */
  member: [
    { key: 'all', label: 'Active Users', where: { isActive: true, isDeleted: false } },
    { key: 'inactive', label: 'Inactive Users', where: { isActive: false, isDeleted: false } },
    { key: 'all_users', label: 'All Users', where: { isDeleted: false } },
    { key: 'unconfirmed', label: 'Unconfirmed Users', where: {} },
  ],
  purchase_order: [
    { key: 'all', label: 'All Purchase Orders', where: {} },
    { key: 'draft', label: 'Draft', where: { status: 'Draft' } },
    { key: 'issued', label: 'Issued', where: { status: 'Issued' } },
    { key: 'closed', label: 'Closed', where: { status: 'Closed' } },
    { key: 'cancelled', label: 'Cancelled', where: { status: 'Cancelled' } },
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
  const searchKey = !key ? 'all' : key;
  const preset = LIST_FILTERS[entityType].find((f) => f.key === searchKey);
  if (!preset) {
    throw ApiError.badRequest(
      `Unknown filter "${searchKey}". Expected one of: ${LIST_FILTERS[entityType].map((f) => f.key).join(', ')}.`,
    );
  }
  return preset.where as TWhere;
}
