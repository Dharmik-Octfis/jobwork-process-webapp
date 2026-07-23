/**
 * The permission catalog — the developer-owned vocabulary of things a user can
 * be allowed to do. It is CODE, not tenant data: versioned with the app, the
 * single source of truth both the backend (authorization) and the admin UI (the
 * template editor's checkboxes) read from.
 *
 * Why not a `permissions` table? Because the set of permissions is defined by
 * what the app can do, and that changes only when a developer ships a feature —
 * never by a customer. Keeping it in code means adding a permission is a one-line
 * edit here with no migration, and (crucially) the Owner template — which grants
 * *all* permissions, computed at runtime — automatically covers the new one with
 * zero backfill. See CLAUDE.md and docs.
 *
 * Naming is `resource:action`. `read` is "view"; `manage` bundles create/edit/
 * delete for the smaller modules where finer granularity isn't worth the UI.
 */

export interface PermissionAction {
  key: string;
  label: string;
}

export interface PermissionGroup {
  resource: string;
  label: string;
  actions: readonly PermissionAction[];
}

/**
 * Every resource exposes exactly the same four actions — Read, Create, Update,
 * Delete — and nothing else. Keeping the action set uniform means the UI renders
 * one consistent 4-column grid and a new module just adds a row.
 */
export const ACTIONS = [
  { action: 'read', label: 'View' },
  { action: 'create', label: 'Create' },
  { action: 'update', label: 'Edit' },
  { action: 'delete', label: 'Delete' },
] as const;

/** Build the four `resource:action` permissions for a resource. */
function crud(resource: string): PermissionAction[] {
  return ACTIONS.map(({ action, label }) => ({ key: `${resource}:${action}`, label }));
}

/** The resources that carry permissions. One row per module in the admin grid. */
const RESOURCES: readonly { resource: string; label: string }[] = [
  { resource: 'vendor', label: 'Vendors' },
  { resource: 'customer', label: 'Customers' },
  { resource: 'item', label: 'Items' },
  { resource: 'currency', label: 'Currencies' },
  { resource: 'payment_term', label: 'Payment Terms' },
  { resource: 'uom', label: 'Units of Measurement' },
  { resource: 'custom_field', label: 'Custom Fields' },
  { resource: 'member', label: 'Members & Invitations' },
  { resource: 'role', label: 'Roles & Permissions' },
  { resource: 'organization', label: 'Organization' },
];

/** Grouped for the admin UI. Flattened into `ALL_PERMISSIONS` below. */
export const PERMISSION_CATALOG: readonly PermissionGroup[] = RESOURCES.map((r) => ({
  resource: r.resource,
  label: r.label,
  actions: crud(r.resource),
}));

/** Every permission key, flattened. The Owner template resolves to exactly this. */
export const ALL_PERMISSIONS: readonly string[] = PERMISSION_CATALOG.flatMap((g) =>
  g.actions.map((a) => a.key),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/** True if `key` is a real permission in the catalog (rejects typos from clients). */
export function isPermissionKey(key: string): boolean {
  return PERMISSION_SET.has(key);
}

/**
 * The ONLY template seeded into a new organization: Owner.
 *
 * No Admin/Member defaults are created. An org starts with exactly one role — the
 * Owner's — and the Owner must create a role before anyone can be invited. That
 * keeps every granted permission an explicit, deliberate choice rather than a
 * default nobody reviewed.
 *
 * Owner stores NO permissions: `isOwner` makes it resolve to `ALL_PERMISSIONS` at
 * runtime, so a permission added in a future release applies to every Owner with
 * no backfill.
 */
export interface SystemTemplateSpec {
  name: string;
  description: string;
  isOwner: boolean;
  permissions: readonly string[];
}

export const SYSTEM_TEMPLATES: readonly SystemTemplateSpec[] = [
  {
    name: 'Owner',
    description: 'Full access to everything. Cannot be edited or deleted.',
    isOwner: true,
    permissions: [], // computed — see isOwner
  },
] as const;

/**
 * Fallback permission set for a Membership whose `permissionTemplateId` is null.
 * Only the org owner keeps access without a template — everyone else gets nothing
 * until the Owner assigns them a role. Fails closed by design.
 */
export function permissionsForRole(role: string): readonly string[] {
  return role === 'owner' ? ALL_PERMISSIONS : [];
}
