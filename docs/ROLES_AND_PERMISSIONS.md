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
  vendor:read ──►│                   │             │  "Warehouse — full"   │◄────────│ user → template  │  ← what they may DO
  vendor:create  │  THE CATALOG      │  ticked ──► │  permissions: [       │  points │      → role      │  ← what they're CALLED
  vendor:update  │  (code, fixed)    │  into       │    'vendor:read',     │  at      └──────────────────┘
  vendor:delete  │                   │             │    'vendor:create' ]  │                  │
  item:read  ... │                   │             └───────────────────────┘                  ▼
                 └───────────────────┘                                             roles (table)
                    the vocabulary                    an access bundle             "Warehouse Supervisor"
                                                                                    — grants nothing
```

- **Permission** — the atomic capability, named `resource:action` (e.g. `vendor:create`). Defined
  in **code** (`permissions.catalog.ts`), never a table. It is the thing route middleware checks.
- **Permission template** (a.k.a. "profile") — a named bundle of permissions, stored in the
  `permission_templates` table, per organization. This **is** the authorization.
- **Role** — a **job title** ("Warehouse Supervisor", "Accountant"), stored in the `roles` table,
  per organization. It carries **no permissions and grants nothing**.
- **Membership → template + role** — each `Membership` points at **one template** (required for
  access) and **one role** (optional, descriptive). They are set independently.

### 🔴 Roles and permission templates are two different axes

They were one object until 2026-07-25 and are now deliberately separate:

|                 | Role                              | Permission template               |
| --------------- | --------------------------------- | --------------------------------- |
| Answers         | "what is this person here to do?" | "what may this person do?"        |
| Grants access   | **No — nothing reads it**         | **Yes — it is the authorization** |
| Table           | `roles`                           | `permission_templates`            |
| On a Membership | `roleId` (nullable)               | `permissionTemplateId`            |
| Screen          | Settings → Roles                  | Settings → Permissions            |
| Gated by        | `role:*`                          | `permission_template:*`           |

Two people with the same job title routinely need different access (a trainee Accountant and a
senior one), and one access bundle is routinely shared across titles. Fusing them forced a
near-duplicate "role" per person — per-user permissions wearing a costume. **Same role + different
template, and same template + different role, are both normal and both supported.**

**Never gate anything on a role name.** If code branches on a role, that is an authorization bug:
the check belongs in the catalog and `requirePermission`. A role is nullable precisely because
nothing depends on it — a member with no title is fully functional.

### Why "template", and why no per-user permissions

There are deliberately **no per-user permission grants**. You cannot add or remove a single
permission for one person. To give someone different access, you assign them a **different
template** (create one if none fits). This is the same model as Zoho CRM profiles, Salesforce
profiles, and AWS IAM managed policies — where the "profile" is separate from the user's title,
exactly as it is here.

The payoff: **"what can this user do?" is answerable by reading one row.** There are no hidden
per-user overrides, no allow-vs-deny precedence rules, no merge logic. The cost is _template
sprawl_ — resist creating a near-duplicate template for one person; that's per-user permissions
wearing a costume. (See §7.)

---

## 2. Permissions are code; templates and roles are data

This is the load-bearing design decision, so it's worth stating plainly:

|                    | Lives in                            | Who changes it                       | Migration to change? |
| ------------------ | ----------------------------------- | ------------------------------------ | -------------------- |
| Permission catalog | **Code** (`permissions.catalog.ts`) | Developers, when they ship a feature | No — edit the file   |
| Templates          | **Table** (`permission_templates`)  | Customers/admins, in the UI          | No — it's just data  |
| Roles (job titles) | **Table** (`roles`)                 | Customers/admins, in the UI          | No — it's just data  |
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

## 4. Ownership is above the permission system

`Membership.isOwner` marks the person who created the organization. It is **not** a role and not a
permission — it sits above both:

```ts
// tenantContext.resolvePermissions — the FIRST thing it does
if (membership.isOwner) return new Set(ALL_PERMISSIONS);
```

Two consequences worth stating: an owner **cannot be locked out** of their own organization by any
template, and no route needs an ownership special case — `requirePermission` stays a pure set check
because the owner already holds everything by the time it runs.

`isOwner` is set in exactly one place (organization creation) and there is no API that grants it.
It is scoped to **one** organization: owning Acme says nothing about Globex, and RLS enforces that
independently. (It replaced a `role` string — `owner|admin|member` — that stored one bit in a
`VARCHAR(50)`; see the 2026-07-25 migration.)

### `requireOwner` — the short list

A few actions must be impossible for _anyone_ but the owner. They can't be expressed as permissions,
because whoever holds `permission_template:update` can tick any box for themselves — **every
permission is ultimately self-grantable**. Only a check outside the permission system stays
owner-exclusive:

```ts
router.delete('/:orgId', authenticate, tenantContext, requireOwner, deleteOrganization);
```

Today that list is **deleting the organization**, and later ownership transfer and billing. Keep it
short enough to recite: if it grows, the new entries probably belong in the catalog. Note the catalog
has **no `organization:delete` key at all** — a checkbox that grants nothing is worse than a missing
one, because an admin ticks it and believes they granted something.

## 4b. What a new organization starts with

| Seeded                 | Kind      | Editable?       | Grants                                         |
| ---------------------- | --------- | --------------- | ---------------------------------------------- |
| **Owner** template     | template  | No (`isSystem`) | Everything, computed (`grantsAllPermissions`)  |
| **Full access**        | template  | **Yes**         | Everything except writing permission templates |
| **View only**          | template  | **Yes**         | Every `:read` in the catalog                   |
| **Owner** role         | job title | No (`isSystem`) | Nothing — it is a label                        |
| **Manager**, **Staff** | job title | **Yes**         | Nothing — they are labels                      |

The Owner template and Owner role are immutable and never assignable or invitable: ownership comes
from creating the organization. Everything else is an ordinary editable row the org owns from the
moment it exists — a default nobody can adjust becomes a default everybody works around.

🔴 **"Full access" deliberately withholds `permission_template:create/update/delete`** (it keeps
`read`). With those, its holder could grant themselves anything, making them the owner in all but
name and rendering `requireOwner` meaningless. Withholding them is what makes Owner → Full access →
View only three genuine tiers. An owner can tick those boxes for an org that wants it.

An org previously started with the Owner template alone, on the principle that a seeded template is
a set of permissions nobody chose. Seeded starting points won on 2026-07-25 for two reasons: the
templates are **editable**, and nothing is ever auto-assigned — an admin picks one from a dropdown
with no default selected, and that act of choosing _is_ the review.

A membership with **no** template has **no permissions** (the owner excepted) — it fails closed.
A membership with **no role** is simply untitled, and works exactly the same.

---

## 5. How a request is authorized (the runtime flow)

```
authenticate ──► tenantContext ──► requirePermission('vendor:create') ──► controller
   sets            verifies membership,                    checks the set
 req.user          resolves req.membership.permissions
```

1. **`authenticate`** — proves who you are, sets `req.user`.
2. **`tenantContext`** — verifies you're a member of `:orgId`, then resolves your permission set
   into `req.membership.permissions` (a `Set<string>`), in this order:
   - **`isOwner` → all catalog permissions, before a template is even read** (§4).
   - Template with `grantsAllPermissions` → **all** catalog permissions, computed.
   - Any other template → its stored keys, plus the `:read` each one implies (§3).
   - **No template**, or one deleted out from under the membership → **empty set**. Fails closed.
   - The template lives in an RLS-protected table, so it is read inside a `runAsTenant` block.
   - The membership's **role is never read here** — it grants nothing and never enters the set.
3. **`requirePermission('vendor:create')`** — a DB-free check that the set contains every listed
   permission (AND semantics). Missing → `403`. It never touches tenant isolation; a member with
   `vendor:read` still only sees their own org's vendors because RLS enforces that independently.
   **`requireOwner`** is the same shape for the few actions no template may grant (§4).

There is exactly **one** authorization mechanism. Until 2026-07-25 invitations and custom fields
used a second one — `assertOrgAdmin`, which read the old `role` string and ignored the catalog
entirely, so a member holding `member:create` still could not invite anyone. If you find yourself
writing a bespoke membership lookup in a service, you are rebuilding it: mount `tenantContext` and
add a `requirePermission` instead.

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
editor's checkbox grid (covered by that group's bulk toggles), and Owner coverage (computed).
Existing templates do **not** get the new permissions — an owner ticks them on deliberately, which is
the point. (Orgs created _after_ you ship it get them in their seeded "Full access" / "View only",
which are computed from the catalog.)

A resource may expose **fewer** than four actions — `{ resource: 'organization', …, actions: ['read',
'update'] }` — and the grid renders "—" for the rest. Use it only when an action genuinely cannot
exist: a key the catalog defines and no route checks is worse than a missing column, because someone
ticks it and believes they granted something.

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

- Naming templates by **level of access** ("Warehouse — full", "Read-only"), not by permission diff
  and not after one person. Job titles belong on the **role**, which is what the separation is for:
  the pressure to mint "Warehouse Supervisor (but no delete)" disappears once a title costs nothing.
- Treating a **template assigned to exactly one member** as a smell (the API returns `memberCount`
  so the UI can surface it).
- Keeping permissions **coarse** (the uniform 4-per-resource catalog already does this).
- Roles sprawl harmlessly — one per genuine job title is correct, and they grant nothing.

Per-user overrides and attribute-based rules (ABAC) are deliberately **not** built. They're easy to
add later if a real need appears, and impossible to cleanly remove once code depends on them.

---

## 8. Files & where things live

| File                                                                               | Role                                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `…/permission-templates/permissions.catalog.ts`                                    | **The catalog** — resource list, `ALL_PERMISSIONS`, Owner seed                    |
| `…/permission-templates/permission-templates.service.ts`                           | Template CRUD, `seedSystemTemplates()`, immutability guards                       |
| `…/permission-templates/permission-templates.{routes,controller,schemas,types}.ts` | The templates API (`/organizations/:orgId/permission-templates`)                  |
| `…/roles/roles.{routes,controller,service,schemas,types}.ts`                       | The **roles** (job titles) API (`/organizations/:orgId/roles`)                    |
| `…/members/members.{routes,controller,service,schemas,types}.ts`                   | Assigning a role **and/or** a template (`/organizations/:orgId/members`)          |
| `…/invitations/`                                                                   | Invites carry a required `permissionTemplateId` + optional `roleId`               |
| `src/middlewares/authorize.ts`                                                     | `requirePermission(...)` and `requireOwner` — the route gates                     |
| `src/middlewares/tenantContext.ts`                                                 | Resolves `req.membership.permissions` (isOwner → all; else the template)          |
| `prisma/schema/permissions.prisma`                                                 | `Role` + `PermissionTemplate` models                                              |
| `prisma/migrations/*_add_permission_templates`                                     | Templates table + RLS + backfill                                                  |
| `prisma/migrations/*_owner_only_default_role`                                      | Drops the Admin/Member seeds; invites → template FK                               |
| `prisma/migrations/*_split_roles_from_permission_templates`                        | `roles` table + RLS, `role_id` on memberships/invitations, Owner backfill         |
| `prisma/migrations/*_membership_is_owner_and_seeded_templates`                     | `role` → `is_owner`, flag rename, Full access / View only + Manager / Staff seeds |
| `web/src/features/roles/`                                                          | Settings → Roles: job-title list + inline editor                                  |
| `web/src/features/permission-templates/`                                           | Settings → Permissions: list + catalog-driven checkbox editor                     |
| `web/src/features/members/` · `features/invitations/`                              | Member list with both dropdowns · invite picking both                             |

### The lifecycle, end to end

1. Owner creates the org → their membership is flagged `isOwner`, and the seeds land: **Owner /
   Full access / View only** templates and **Owner / Manager / Staff** roles (§4b).
2. Owner opens **Settings → Members** and invites someone, picking a template (required) and a role
   (optional). Both dropdowns are usable immediately — that is what the seeds buy.
3. Invitee accepts → their Membership is created carrying both, and never `isOwner`.
4. When the seeds stop fitting, **Settings → Permissions** edits or adds a template (they are
   ordinary rows, including the seeded two), and **Settings → Roles** edits or adds job titles.
5. To change what someone can **do**, put them on a different **template**. To change what they're
   **called**, change their **role**. Either dropdown on the member row, independently — never a
   one-off permission.

**Related:** tenant isolation & RLS → `PRISMA.md` §8; per-org custom fields (the same
"code, not data" split for field _definitions_) → `DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`; auth model
→ `AUTHENTICATION.md`.
