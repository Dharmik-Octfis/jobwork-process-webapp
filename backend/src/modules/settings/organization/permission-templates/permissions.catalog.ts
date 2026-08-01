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

export type ActionName = (typeof ACTIONS)[number]['action'];

/**
 * Build a resource's permissions. Defaults to all four; a resource may narrow the
 * list when an action genuinely does not exist for it.
 *
 * Narrowing is rare and should stay rare — the uniform grid is what keeps the
 * editor readable. But a key the catalog defines and no route checks is worse
 * than a missing column: it appears as a checkbox, an admin ticks it believing
 * they granted something, and nothing happens. `organization` is the one case
 * today — you cannot "create" an organization from inside one, and deleting it is
 * owner-only via `requireOwner`, which no permission can satisfy.
 */
function crud(resource: string, actions?: readonly ActionName[]): PermissionAction[] {
  return ACTIONS.filter(({ action }) => !actions || actions.includes(action)).map(
    ({ action, label }) => ({ key: `${resource}:${action}`, label }),
  );
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
  resources: { resource: string; label: string; actions?: readonly ActionName[] }[];
}[] = [
  {
    key: 'inventory',
    label: 'Item',
    resources: [
      { resource: 'item', label: 'Items' },
      { resource: 'item_category', label: 'Item Categories' }
    ],
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
      // No create (you cannot create an organization from inside one) and no
      // delete (owner-only, gated by `requireOwner` — see authorize.ts).
      { resource: 'organization', label: 'Organization Profile', actions: ['read', 'update'] },
      // Renamed to "Users" in the UI on 2026-07-30. The RESOURCE KEY stays
      // `member` — it is stored inside every customer's permission templates, so
      // renaming it would silently strip the permission from every template that
      // holds it. Only the label an admin reads changes.
      { resource: 'member', label: 'Users' },
      // Two resources, not one, because they are not the same power. `role`
      // grants managing job titles — a labelling exercise. `permission_template`
      // grants rewriting what people may DO, which is privilege escalation: hold
      // it and you can grant yourself anything. Splitting them lets an admin
      // delegate the first without the second.
      //
      // NOTE: `role:*` used to gate permission templates. Custom templates written
      // before 2026-07-25 therefore hold `role:*` and NOT `permission_template:*`,
      // so they keep managing titles and lose template editing until an owner
      // ticks it back on. That is the safe direction, and the same "existing
      // templates don't silently gain a new permission" rule as any new resource.
      { resource: 'role', label: 'Roles' },
      { resource: 'permission_template', label: 'Permission Templates' },
      { resource: 'uom', label: 'Units of Measurement' },
      { resource: 'purchase_order', label: 'Purchase Orders' },
      { resource: 'currency', label: 'Currencies' },
      { resource: 'payment_term', label: 'Payment Terms' },
      { resource: 'location', label: 'Locations' },
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
    actions: crud(r.resource, r.actions),
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

/** Every `<resource>:read` key — what "View only" grants. */
const ALL_READ_PERMISSIONS: readonly string[] = ALL_PERMISSIONS.filter((key) =>
  key.endsWith(':read'),
);

/**
 * Rewriting a permission template is the one permission that grants every other
 * permission: hold it and you can tick any box for yourself. So it is withheld
 * from the seeded "Full access" template, which is what keeps Owner and admin
 * genuinely different tiers rather than the same account with extra steps.
 *
 * `read` stays — seeing what access exists is not the same as changing it.
 */
const SELF_ESCALATING_PERMISSIONS: readonly string[] = [
  'permission_template:create',
  'permission_template:update',
  'permission_template:delete',
];

/**
 * The templates seeded into a new organization.
 *
 * **Owner** is immutable (`isSystem`) and never assignable — ownership comes from
 * creating the org, and `Membership.isOwner` is what actually grants it; this row
 * exists so ownership has a name on screen. It stores no keys:
 * `grantsAllPermissions` resolves it to the whole catalog at runtime, so a
 * permission shipped later needs no backfill.
 *
 * **Full access** and **View only** are ordinary editable rows — starting points
 * so a new org can invite someone in the first minute instead of building a
 * template first. They are `isSystem: false` deliberately: a default nobody can
 * adjust becomes a default everybody works around. Both are computed from the
 * catalog, so a new module lands in them for orgs created after it ships (existing
 * orgs' copies are theirs to edit, exactly like any other row they own).
 */
export interface SystemTemplateSpec {
  name: string;
  description: string;
  isSystem: boolean;
  grantsAllPermissions: boolean;
  permissions: readonly string[];
}

export const SYSTEM_TEMPLATES: readonly SystemTemplateSpec[] = [
  {
    name: 'Owner',
    description: 'Full access to everything. Cannot be edited or deleted.',
    isSystem: true,
    grantsAllPermissions: true,
    permissions: [], // computed — see grantsAllPermissions
  },
  {
    name: 'Full access',
    description: 'Manage everything day to day. Cannot change what other people are allowed to do.',
    isSystem: false,
    grantsAllPermissions: false,
    permissions: ALL_PERMISSIONS.filter((key) => !SELF_ESCALATING_PERMISSIONS.includes(key)),
  },
  {
    name: 'View only',
    description: 'See everything, change nothing.',
    isSystem: false,
    grantsAllPermissions: false,
    permissions: ALL_READ_PERMISSIONS,
  },
] as const;

/**
 * The job titles seeded into a new organization. A role grants NOTHING, so these
 * are pure suggestions — named as titles rather than access levels on purpose.
 * "Manager on View only" has to read as a deliberate choice; it would read as a
 * mistake if the role were called "Admin" beside a template of the same name,
 * and the two would drift back into lockstep.
 *
 * 🔴 **Array ORDER is the seeded org chart.** `seedSystemRoles` walks this list in
 * order and parents each entry to the one before it, so the list reads top-down:
 * CEO → Senior Manager → Manager → Staff. Reordering it reorders a new
 * organization's reporting lines; inserting in the middle inserts a layer.
 *
 * The first entry is `isSystem` — immutable, not assignable, and always the root
 * of the chart. It is identified by that flag, never by its name, so an org that
 * renames it (or a future rename here) breaks nothing.
 */
export interface SystemRoleSpec {
  name: string;
  description: string;
  isSystem: boolean;
}

export const SYSTEM_ROLES: readonly SystemRoleSpec[] = [
  {
    name: 'CEO',
    description: 'The organization owner. Cannot be edited or deleted.',
    isSystem: true,
  },
  {
    name: 'Senior Manager',
    description: 'Leads several teams or functions.',
    isSystem: false,
  },
  { name: 'Manager', description: 'Runs a team or a function.', isSystem: false },
  { name: 'Staff', description: 'Works in the business day to day.', isSystem: false },
] as const;
