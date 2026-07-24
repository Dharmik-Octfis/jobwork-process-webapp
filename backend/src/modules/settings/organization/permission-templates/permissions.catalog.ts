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
 * Naming is `resource:action`. `read` is "view", and it is implied by every other
 * action — see `withImpliedRead`.
 */

export interface PermissionAction {
  key: string;
  label: string;
}

/** One leaf module — the thing a permission is actually granted on. */
export interface PermissionModule {
  resource: string;
  label: string;
  actions: readonly PermissionAction[];
}

/**
 * A main module, as the sidebar shows it on the home screen (Purchases, Sales,
 * …). It owns no permissions of its own — its checkboxes in the editor are a
 * bulk toggle over the modules beneath it.
 */
export interface PermissionGroup {
  key: string;
  label: string;
  modules: readonly PermissionModule[];
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

/**
 * The resources that carry permissions, filed under the main module they live in.
 * The grouping deliberately mirrors the app's own navigation — the sidebar groups
 * on the home screen (`app_modules`: Item, Purchases, Sales) plus the Settings
 * sidebar — so an admin ticking boxes sees the same tree they navigate. Adding a
 * module means one line in the right group; a new main module means one entry.
 */
const MODULE_GROUPS: readonly {
  key: string;
  label: string;
  resources: { resource: string; label: string }[];
}[] = [
  {
    key: 'inventory',
    label: 'Item',
    resources: [{ resource: 'item', label: 'Items' }],
  },
  {
    key: 'purchases',
    label: 'Purchases',
    resources: [{ resource: 'vendor', label: 'Vendors' }],
  },
  {
    key: 'sales',
    label: 'Sales',
    resources: [{ resource: 'customer', label: 'Customers' }],
  },
  {
    key: 'settings',
    label: 'Settings',
    resources: [
      { resource: 'organization', label: 'Organization Profile' },
      { resource: 'member', label: 'Members & Invitations' },
      { resource: 'role', label: 'Roles & Permissions' },
      { resource: 'uom', label: 'Units of Measurement' },
      { resource: 'currency', label: 'Currencies' },
      { resource: 'payment_term', label: 'Payment Terms' },
      { resource: 'custom_field', label: 'Custom Fields' },
    ],
  },
];

/** Grouped for the admin UI. Flattened into `ALL_PERMISSIONS` below. */
export const PERMISSION_CATALOG: readonly PermissionGroup[] = MODULE_GROUPS.map((g) => ({
  key: g.key,
  label: g.label,
  modules: g.resources.map((r) => ({
    resource: r.resource,
    label: r.label,
    actions: crud(r.resource),
  })),
}));

/** Every permission key, flattened. The Owner template resolves to exactly this. */
export const ALL_PERMISSIONS: readonly string[] = PERMISSION_CATALOG.flatMap((g) =>
  g.modules.flatMap((m) => m.actions.map((a) => a.key)),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/** True if `key` is a real permission in the catalog (rejects typos from clients). */
export function isPermissionKey(key: string): boolean {
  return PERMISSION_SET.has(key);
}

/**
 * `read` is implied by every other action: you cannot create, edit or delete a
 * record you are not allowed to see — every one of those flows opens the list or
 * the detail page first. So `vendor:create` without `vendor:read` is not a
 * stricter role, it's a broken one (the UI 403s on the page the button lives on).
 *
 * The editor ticks View for you, but the rule is enforced here as well: the
 * client is a claim, and a template written by a script or an older build must
 * resolve the same way. Applied on write (schemas) and again on read
 * (`tenantContext.resolvePermissions`) so stored rows predating this are fixed
 * up too.
 */
export function withImpliedRead(keys: readonly string[]): string[] {
  const out = new Set(keys);
  for (const key of keys) {
    const resource = key.slice(0, key.lastIndexOf(':'));
    const readKey = `${resource}:read`;
    if (PERMISSION_SET.has(readKey)) out.add(readKey);
  }
  return [...out];
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
