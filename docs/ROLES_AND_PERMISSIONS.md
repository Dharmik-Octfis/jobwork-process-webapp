# Roles & Permissions

How authorization works in this app: what a signed-in user is _allowed to do_ inside an
organization. This is a **separate layer from tenant isolation** — tenant isolation
(`runAsTenant` + RLS, see `PRISMA.md`) decides _whose data_ you can touch; authorization
decides _which actions_ you may perform on it. Both run on every tenant request, and neither
replaces the other.

---

## 1. The model in one picture

```
                 permissions.catalog.ts            permission_templates (table)      memberships (table)
                 ┌───────────────────┐             ┌───────────────────────┐         ┌──────────────────┐
  vendor:read ──►│                   │             │  "Warehouse Manager"  │◄────────│ user → template  │
  vendor:create  │  THE CATALOG      │  ticked ──► │  permissions: [       │  points │ (one per org)    │
  vendor:update  │  (code, fixed)    │  into       │    'vendor:read',     │  at      └──────────────────┘
  vendor:delete  │                   │             │    'vendor:create' ]  │
  item:read  ... │                   │             └───────────────────────┘
                 └───────────────────┘
                    the vocabulary                      a role = a bundle              the assignment
```

- **Permission** — the atomic capability, named `resource:action` (e.g. `vendor:create`). Defined
  in **code** (`permissions.catalog.ts`), never a table. It is the thing route middleware checks.
- **Permission template** (a.k.a. "profile" or "role") — a named bundle of permissions, stored in
  the `permission_templates` table, per organization. This is what admins create and edit.
- **Membership → template** — each `Membership` points at exactly **one** template
  (`permissionTemplateId`). That template's permission set _is_ the user's authorization.

### Why "template", and why no per-user permissions

There are deliberately **no per-user permission grants**. You cannot add or remove a single
permission for one person. To give someone different access, you assign them a **different
template** (create one if none fits). This is the same model as Zoho CRM profiles, Salesforce
profiles, and AWS IAM managed policies.

The payoff: **"what can this user do?" is answerable by reading one row.** There are no hidden
per-user overrides, no allow-vs-deny precedence rules, no merge logic. The cost is _template
sprawl_ — resist creating a near-duplicate template for one person; that's per-user permissions
wearing a costume. (See §7.)

---

## 2. Permissions are code; roles are data

This is the load-bearing design decision, so it's worth stating plainly:

|                    | Lives in                            | Who changes it                       | Migration to change? |
| ------------------ | ----------------------------------- | ------------------------------------ | -------------------- |
| Permission catalog | **Code** (`permissions.catalog.ts`) | Developers, when they ship a feature | No — edit the file   |
| Templates / roles  | **Table** (`permission_templates`)  | Customers/admins, in the UI          | No — it's just data  |
| Assignment         | **Table** (`memberships`)           | Admins, when they add/edit a member  | No — it's just data  |

The catalog replaces what a textbook RBAC schema would put in a `permissions` table. It is code,
not a table, because the list is **identical for every tenant** and **only a developer can change
it** — a permission is only real if code somewhere enforces it. Making it code buys two things a
table can't:

- **Adding a permission never needs a migration** — one line in the catalog.
- **The Owner template needs no backfill, ever.** Owner stores _zero_ permission keys; it resolves
  to the full catalog at runtime. Ship a new permission and every Owner in every org has it
  instantly. A `role_permissions` table would need a backfill row per org per new permission.

---

## 3. Every resource has exactly four actions

The catalog is uniform: **Read, Create, Update, Delete** — nothing else. No `manage`, no one-off
actions. The whole catalog is generated from a `crud(resource)` helper, so a resource _cannot_
drift outside those four. This keeps the admin UI a clean 4-column grid and makes a new module a
one-line change.

Resources are filed under the **main module** they belong to — the same grouping the sidebar shows
on the home screen (`app_modules`) plus Settings — so the role editor's tree matches the tree the
admin navigates.

```ts
// permissions.catalog.ts (shape)
const MODULE_GROUPS = [
  { key: 'purchases', label: 'Purchases', resources: [{ resource: 'vendor', label: 'Vendors' }] },
  { key: 'sales', label: 'Sales', resources: [{ resource: 'customer', label: 'Customers' }] },
  // ...
];
// → vendor:read, vendor:create, vendor:update, vendor:delete, customer:read, ...
```

The catalog endpoint serves that tree (`{ groups: [{ key, label, modules: [{ resource, label,
actions }] }] }`). A main module carries **no permission of its own** — its checkboxes in the editor
are a bulk toggle over every module beneath it (ticking "Create" on Purchases ticks Create for every
purchases module; the box shows indeterminate when only some are on).

### `read` is implied by every other action

`vendor:create` without `vendor:read` isn't a stricter role, it's a broken one — the create button
lives on a page the user would be 403'd out of. So **granting create/update/delete grants read**,
and revoking read revokes the rest of that module.

The editor ticks View for you and locks it while another action needs it, but the rule is enforced
server-side too — `withImpliedRead()` runs in the write schema (so a hand-rolled API call normalizes
the same way) and again in `tenantContext.resolvePermissions` (so rows written before the rule
existed resolve correctly without a backfill).

---

## 4. A new org has exactly ONE role: Owner

When an organization is created, **only the Owner template is seeded** (`isSystem: true`,
`isOwner: true`). It is immutable — the service refuses to edit or delete it.

There are **no default Admin or Member roles**. The Owner must create a role before anyone can be
invited or assigned. That is deliberate: a seeded "Member" role is a set of permissions nobody
consciously chose, and defaults like that are how people end up with access no one reviewed.
Starting empty forces every grant to be an explicit decision.

| Template  | Stored permissions         | Notes                                                              |
| --------- | -------------------------- | ------------------------------------------------------------------ |
| **Owner** | _(none — `isOwner: true`)_ | Resolves to **all** permissions at runtime. No backfill on change. |

Everything else is a **custom** role the Owner creates (`isSystem: false`), ticking boxes from the
catalog. Custom roles can be edited and deleted; a role still assigned to a member can't be deleted
— reassign those members first. The Owner role is never assignable or invitable: ownership comes
from creating the organization, not from being granted.

A membership with **no** template has **no permissions** (the owner excepted) — it fails closed.

---

## 5. How a request is authorized (the runtime flow)

```
authenticate ──► tenantContext ──► requirePermission('vendor:create') ──► controller
   sets            verifies membership,                    checks the set
 req.user          resolves req.membership.permissions
```

1. **`authenticate`** — proves who you are, sets `req.user`.
2. **`tenantContext`** — verifies you're a member of `:orgId`, then resolves your permission set
   into `req.membership.permissions` (a `Set<string>`):
   - Owner template (`isOwner`) → **all** catalog permissions, computed.
   - Any other template → its stored keys, plus the `:read` each one implies (§3).
   - **No template** → only the org owner keeps access (`permissionsForRole()`); everyone else
     gets an empty set until a role is assigned. Fails closed.
   - The template lives in an RLS-protected table, so it is read inside a `runAsTenant` block.
3. **`requirePermission('vendor:create')`** — a DB-free check that the set contains every listed
   permission (AND semantics). Missing → `403`. It never touches tenant isolation; a member with
   `vendor:read` still only sees their own org's vendors because RLS enforces that independently.

---

## 6. Adding permissions to a new module — the two-step ritual

When you build a new module that needs access control, do **both** of these:

### Step 1 — register the resource in the catalog

Add one line to the right group's `resources` in `MODULE_GROUPS`
(`src/modules/settings/organization/permission-templates/permissions.catalog.ts`) — the group being
the main module the sidebar files it under:

```ts
{ key: 'purchases', label: 'Purchases', resources: [
  { resource: 'vendor', label: 'Vendors' },
  { resource: 'purchase_order', label: 'Purchase Orders' },   // ← the new line
]},
```

That instantly creates `purchase_order:read/create/update/delete`, a new row under Purchases in the
role editor's checkbox grid (covered by that group's bulk toggles), and Owner coverage (computed). Existing custom roles do **not** get the new
permissions — an Owner ticks them on deliberately, which is the point.

### Step 2 — gate every route with `requirePermission`

```ts
router.get('/', requirePermission('purchase_order:read'), list);
router.post('/', requirePermission('purchase_order:create'), create);
router.put('/:id', requirePermission('purchase_order:update'), update);
router.delete('/:id', requirePermission('purchase_order:delete'), remove);
```

Mount `requirePermission` **after** `authenticate, tenantContext` — it reads the permission set
those two produce.

### 🔴 The trap: step 2 fails **open** and silently

- Forget **step 1** (the catalog line) → the permission exists for nobody, so every request 403s.
  Annoying, but **fails closed** — safe.
- Forget **step 2** (`requirePermission` on the routes) → the module has **no gate at all**. Every
  member can do everything, and _nothing warns you_. It looks exactly like a working module.

This is the same shape as the RLS footgun in `PRISMA.md` ("a tenant table with no policy is
unprotected and nothing will tell you"). Tenant isolation still holds — it's not a cross-tenant
leak — but a Member could create or delete data they shouldn't. **A new module's routes are not
done until each one carries a `requirePermission`.**

---

## 7. Scaling & anti-sprawl

For B2B orgs of ~5–50 users this model scales fine — real orgs have a handful of genuine job
functions. The failure mode is _template sprawl_: creating a near-duplicate template for one person
instead of reusing one. Because per-user overrides don't exist, every tiny difference tempts a new
template. Keep it in check by:

- Naming templates by **job function** ("Warehouse Supervisor"), not by permission diff.
- Treating a **template assigned to exactly one member** as a smell (the API returns `memberCount`
  so the UI can surface it).
- Keeping permissions **coarse** (the uniform 4-per-resource catalog already does this).

Per-user overrides and attribute-based rules (ABAC) are deliberately **not** built. They're easy to
add later if a real need appears, and impossible to cleanly remove once code depends on them.

---

## 8. Files & where things live

| File                                                                               | Role                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `…/permission-templates/permissions.catalog.ts`                                    | **The catalog** — resource list, `ALL_PERMISSIONS`, Owner seed     |
| `…/permission-templates/permission-templates.service.ts`                           | Role CRUD, `seedSystemTemplates()`, immutability guards            |
| `…/permission-templates/permission-templates.{routes,controller,schemas,types}.ts` | The roles API (`/organizations/:orgId/permission-templates`)       |
| `…/members/members.{routes,controller,service,schemas,types}.ts`                   | **Assigning** a role to a member (`/organizations/:orgId/members`) |
| `…/invitations/`                                                                   | Invites carry a `permissionTemplateId`, not a role string          |
| `src/middlewares/authorize.ts`                                                     | `requirePermission(...)` — the route gate                          |
| `src/middlewares/tenantContext.ts`                                                 | Resolves `req.membership.permissions`                              |
| `prisma/schema/permissions.prisma`                                                 | `PermissionTemplate` model                                         |
| `prisma/migrations/*_add_permission_templates`                                     | Table + RLS + backfill                                             |
| `prisma/migrations/*_owner_only_default_role`                                      | Drops the Admin/Member seeds; invites → template FK                |
| `web/src/features/roles/`                                                          | Settings → Roles: list + catalog-driven checkbox editor            |
| `web/src/features/members/` · `features/invitations/`                              | Member list + role assignment · invite with a role                 |

### The lifecycle, end to end

1. Owner creates the org → only the **Owner** role exists.
2. Owner opens **Settings → Roles** and creates a role (e.g. "Warehouse Supervisor").
3. Owner opens **Settings → Members** and invites someone, picking that role. The invite form is
   blocked until at least one role exists.
4. Invitee accepts → their Membership is created pointing at that role.
5. To change what someone can do, assign them a **different** role — never a one-off permission.

**Related:** tenant isolation & RLS → `PRISMA.md` §8; per-org custom fields (the same
"code, not data" split for field _definitions_) → `DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`; auth model
→ `AUTHENTICATION.md`.
