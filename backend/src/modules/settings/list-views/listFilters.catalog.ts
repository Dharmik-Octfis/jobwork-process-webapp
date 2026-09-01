import { ApiError } from '../../../lib/apiError.ts';
import type { ListEntityType } from './listViews.catalog.ts';

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
export const LIST_FILTERS: Record<ListEntityType, readonly FilterPreset[]> = {
  vendor: [
    { key: 'all', label: 'All Vendors', where: {} },
    { key: 'active', label: 'Active Vendors', where: { status: 'active' } },
    { key: 'inactive', label: 'Inactive Vendors', where: { status: 'inactive' } },
  ],
  bill: [
    { key: 'all', label: 'All Bills', where: {} },
    { key: 'draft', label: 'Draft', where: { status: 'Draft' } },
    { key: 'approved', label: 'Approved', where: { status: 'Approved' } },
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
    { key: 'goods', label: 'Goods', where: { itemType: 'goods' } },
    { key: 'services', label: 'Services', where: { itemType: 'service' } },
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
  /**
   * Profiles. Deliberately a single unfiltered view — the "Custom Profiles" /
   * "Built-in Profiles" splits were removed on 2026-08-03 because an org holds a
   * handful of profiles and the built-in one is already labelled in the Type
   * column. The `all` entry must stay: `filterWhere` resolves an absent `?filter=`
   * to `all`, so an empty list here would 400 every request.
   */
  permission_template: [{ key: 'all', label: 'All Profiles', where: {} }],
  /**
   * Processes. One unfiltered default view: the active/inactive split went with
   * the `is_active` column on 2026-08-10 — a process you have stopped running is
   * deleted (soft), not retired. The `all` entry must stay whatever else changes:
   * `filterWhere` resolves an absent `?filter=` to `all`, so an empty list here
   * would 400 every request.
   */
  process: [
    { key: 'all', label: 'All Processes', where: {} },
    /** Where the taka survives the operation, so unit-wise receipt is possible
     * at all (§5.2.3) — dyeing yes, cutting no. */
    { key: 'changes_item', label: 'Changes The Item', where: { itemChanges: true } },
  ],
  process_route: [{ key: 'all', label: 'All Routes', where: {} }],
  /**
   * Job orders. The default is **Open** — everything not yet finished — because
   * this list is a work queue and a completed order is history. The key stays
   * `all` because that is the default slot (same trick as `item`).
   */
  job_order: [
    {
      key: 'all',
      label: 'Open Job Orders',
      where: { status: { in: ['draft', 'in_progress'] } },
    },
    { key: 'all_orders', label: 'All Job Orders', where: {} },
    { key: 'issued', label: 'Issued (Not Draft)', where: { status: { not: 'draft' } } },
    { key: 'draft', label: 'Draft', where: { status: 'draft' } },
    { key: 'in_progress', label: 'In Progress', where: { status: 'in_progress' } },
    { key: 'completed', label: 'Completed', where: { status: 'completed' } },
    { key: 'short_closed', label: 'Closed Short', where: { status: 'short_closed' } },
  ],
  /**
   * Issues. The default is **Open** — material that is still at a processor.
   * That is the list someone actually chases; a closed challan is paperwork.
   */
  job_issue: [
    {
      key: 'all',
      label: 'Open Challans',
      where: { status: { in: ['issued', 'partially_received'] } },
    },
    { key: 'all_issues', label: 'All Challans', where: {} },
    { key: 'closed', label: 'Closed', where: { status: 'closed' } },
    { key: 'rework', label: 'Rework Issues', where: { isRework: true } },
    { key: 'cancelled', label: 'Cancelled', where: { status: 'cancelled' } },
  ],
  job_receipt: [
    { key: 'all', label: 'All Receipts', where: {} },
    { key: 'with_rework', label: 'With Rework', where: { totalReworkQty: { gt: 0 } } },
    { key: 'with_scrap', label: 'With Scrap', where: { totalScrapQty: { gt: 0 } } },
    { key: 'cancelled', label: 'Cancelled', where: { status: 'cancelled' } },
  ],
  rejection_reason: [{ key: 'all', label: 'All Reasons', where: {} }],
  /** Batches have no list page (see the column catalog), but `filterWhere` resolves
   * an absent `?filter=` to `all`, so the entry must exist or every read 400s. */
  batch: [
    { key: 'all', label: 'All Batches', where: {} },
    { key: 'open', label: 'Open Batches', where: { state: 'open' } },
    { key: 'own', label: 'Our Stock', where: { ownership: 'own' } },
    { key: 'customer', label: 'Customer Stock', where: { ownership: 'customer' } },
  ],
  composite_item_component: [{ key: 'all', label: 'All', where: {} }],
  item_assembly: [
    { key: 'all', label: 'All Assemblies', where: {} },
    { key: 'draft', label: 'Draft', where: { status: 'draft' } },
    { key: 'cancelled', label: 'Cancelled', where: { status: 'cancelled' } },
  ],
  item_assembly_line: [{ key: 'all', label: 'All', where: {} }],
  purchase_order: [
    { key: 'all', label: 'All Purchase Orders', where: {} },
    { key: 'draft', label: 'Draft', where: { status: 'Draft' } },
    { key: 'issued', label: 'Issued', where: { status: 'Issued' } },
    { key: 'closed', label: 'Closed', where: { status: 'Closed' } },
    { key: 'cancelled', label: 'Cancelled', where: { status: 'Cancelled' } },
  ],
};

/** Key + label only — what the picker renders. */
export function filterOptions(entityType: ListEntityType): { key: string; label: string }[] {
  return LIST_FILTERS[entityType].map(({ key, label }) => ({ key, label }));
}

/**
 * The where-fragment for a filter key. Omitted/`all` → `{}` (no narrowing). An
 * unrecognised key is a 400 rather than a silent fallback: it means the client
 * asked for a view that does not exist, and quietly showing everything would look
 * like the filter worked.
 */
export function filterWhere<TWhere>(entityType: ListEntityType, key: string | undefined): TWhere {
  const searchKey = !key ? 'all' : key;
  const preset = LIST_FILTERS[entityType].find((f) => f.key === searchKey);
  if (!preset) {
    throw ApiError.badRequest(
      `Unknown filter "${searchKey}". Expected one of: ${LIST_FILTERS[entityType].map((f) => f.key).join(', ')}.`,
    );
  }
  return preset.where as TWhere;
}
