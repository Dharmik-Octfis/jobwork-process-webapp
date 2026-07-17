# Dynamic Custom Fields — Implementation Prompt

**Project:** Production Monitoring & Inventory Management (multi-tenant SaaS)
**Audience:** An AI coding agent (Claude Code), or a developer using this as a work order.
**Purpose:** A copy-pasteable, ordered set of prompts to build per-organization custom fields on the
Purchase Order module — plus the tenant-safety work that must land alongside it.
**Companion doc:** `DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md` — **read that first** for _why_. This doc is
only _what_ and _in what order_.
**Status:** Ready to execute. Steps are ordered by dependency; **do not reorder them.**
**Last updated:** 2026-07-16

---

## 0. How to use this document

Each **Step** below is a self-contained prompt. Hand **one step at a time** to the agent — paste the
step's `PROMPT` block, let it complete, verify against that step's **Acceptance criteria**, then move
on. Do not paste the whole document at once; these steps span schema, backend, and frontend, and
batching them produces unreviewable diffs.

**Every prompt implicitly carries §1 (Guardrails) and §2 (Codebase facts). Paste those two sections
along with the first step of any new session**, or point the agent at this file.

---

## 1. Guardrails — non-negotiable, applies to every step

These are not style preferences. Each one maps to a specific failure documented in
`DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`.

1. **Never `ALTER TABLE` at runtime.** An org adding a field is an `INSERT` into
   `custom_field_definitions`. If any step ever produces runtime DDL, stop and re-read §3.1 of the
   explainer.
2. **Never hard-delete a field definition or its stored values.** Only `active` → `hidden` →
   `archived`. Purchase orders are legal records. (Explainer §7.2)
3. **The `key` is immutable and never reused** — not even after archiving. The unique constraint must
   include archived rows. `label` renames freely; `key` never moves. (Explainer §7.3)
4. **Never allow a `data_type` change on an existing definition.** Return 400 and tell the user to
   archive and re-create. (Explainer §7.3)
5. **The server re-loads definitions from the DB and validates against them.** Never trust the
   client's payload shape. Use `.strict()` to reject unknown keys. (Explainer §9C)
6. **Every query touching a tenant table carries `organizationId` in its `where`.** No exceptions.
   There is no RLS safety net yet. (Explainer §8.4)
7. **Definitions and records must be fetched with the same `organizationId` variable, in the same
   request.** Parsing Org B's record with Org A's definitions produces a silent, error-free data leak.
   (Explainer §8.4)
8. **Never build `ORDER BY` or a filter path from a raw user string.** Resolve it through the
   definitions table first; reject anything not found. (Explainer §8.3)
9. **Store decimals as JSON strings, dates as ISO 8601 UTC, pure dates with no timezone.**
   (Explainer §9C)
10. **Missing ≠ empty ≠ zero.** Use `key in obj`, never `if (obj[key])`. (Explainer §7.1c)

---

## 2. Codebase facts the agent must know

Verified against the repo on 2026-07-16. **Several of these contradict common defaults — read them.**

### 2.1 Stack

- **Backend:** Express 5 + TypeScript, ESM, modular monolith. Zod 4. Vitest + supertest.
- **DB:** PostgreSQL on AWS RDS. `backend/prisma/schema/schema.prisma:14`.
- **ORM:** **Prisma 7** with the `@prisma/adapter-pg` driver adapter (required in v7 — no bare
  connection-string mode). Client generates to `backend/generated/prisma`, **not** `node_modules`.
  Schema is a **folder** (`prisma/schema/`) split by domain. Datasource URL lives in
  `prisma.config.ts`, not `schema.prisma`.
- **Frontend:** React 19 + Vite 8, React Router 7, TanStack Query 5, react-hook-form + zodResolver,
  axios, CSS Modules. **No UI library** — all inputs are hand-built.
- **Deploy:** Zoho Catalyst AppSail.

### 2.2 Schema conventions — copy these exactly

Read `backend/prisma/schema/tenant.prisma` before writing any model. The house conventions are **not**
Prisma defaults:

| Convention            | This repo uses                                                     | **Not**                          |
| --------------------- | ------------------------------------------------------------------ | -------------------------------- |
| UUID primary key      | `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`          | `@default(uuid())`               |
| Timestamps            | `DateTime @db.Timestamptz(6)`                                      | bare `DateTime`                  |
| `updatedAt`           | `@default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)` | `@updatedAt` alone               |
| Enum-like columns     | `String @db.VarChar(n)` + a trailing `// a \| b \| c` comment      | Prisma `enum` blocks             |
| Table/column names    | `@@map("snake_case")` / `@map("snake_case")`                       | camelCase in DB                  |
| Case-insensitive text | `@db.Citext`                                                       | `String` + `mode: 'insensitive'` |

**There are zero Prisma `enum` blocks in this codebase.** `Membership.role`
(`tenant.prisma:79`) and `Invitation.status` (`tenant.prisma:101`) are both `String @db.VarChar` with
a comment. Follow that — a Prisma enum requires `CREATE TYPE`, which is extra friction while the DB is
hand-managed.

### 2.3 `Organization.id` — now UUID (changed 2026-07-16)

**This section previously said the opposite. Read it again if you have it memorised.**

Until 2026-07-16, `Organization.id` was `String @id @map("organization_id")` — plain TEXT — and every
FK to it had to be plain `String`. Commit `f48d2fe` changed it to
`String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, dropping the `@map` (the column is
now `id`, not `organization_id`).

**So today: every FK to `Organization` must carry `@db.Uuid`**, matching `Membership.organizationId`
(`tenant.prisma:79`) and `Vendor.organizationId` (`purchases.prisma:3`).

That migration left one field behind, and it cost real debugging time — worth understanding, because
it is the trap in its current form:

```prisma
// Invitation.organizationId, as committed in f48d2fe:
organizationId String @map("organization_id")            // ← TEXT, but the column is uuid
```

**`prisma validate` reports this schema as valid.** Prisma only compares the _Prisma_ type
(`String` == `String`); it never sees that the native type is `uuid` on one side and `text` on the
other. Only Postgres notices, at runtime, and the failure surfaces as
`operator does not exist: uuid = text` — which reads like a query bug, not a schema bug. It was
committed as "feat: orgid error" and fixed during the Step 1 baseline.

**Rule: when you change a PK's native type, grep every FK that references it.** Prisma will not do it
for you.

### 2.4 Module conventions — copy `invitations`, NOT `organizations`

`backend/src/modules/<name>/` with `.routes.ts` / `.controller.ts` / `.service.ts` / `.schemas.ts` /
`.types.ts`. Register in `backend/src/routes/index.ts:14-17`.

- ✅ **`modules/invitations/`** is the reference. It uses the `validateBody` middleware
  (`middlewares/validate.ts:11`), throws `ApiError`, and keeps logic in a service layer.
- ❌ **`modules/organizations/`** is the odd one out — inline `safeParse`, raw `error.issues` returned
  to the client (`organizations.controller.ts:8-12, 83-87`), inline membership checks (lines 74-81),
  and **no service file at all**. Do not use it as a template.

**Reuse, do not rewrite:**

- `assertOrgAdmin(userId, organizationId)` — `invitations.service.ts:29-41`. Throws 403 unless the
  user is `owner`/`admin`. This is the existing authorization primitive. Custom-field mutations must
  use it.
- `ORG_ADMIN_ROLES = ['owner', 'admin']` — `invitations.service.ts:16`.
- `validateBody(schema)` — `middlewares/validate.ts:11`. Collects Zod issues into a
  `Record<path, message>` and throws `ApiError.badRequest('Please check the highlighted fields.', fieldErrors)`.
- `authenticate` — `middlewares/authenticate.ts`.
- The tenant-scoping idiom — `invitations.service.ts:170-173`: `updateMany({ where: { id, organizationId } })`,
  with the comment explaining why. **This is the standard to match.**

### 2.5 Frontend conventions

- `web/src/features/<name>/` with `.api.ts` + `.schemas.ts` + page components.
- Routes in `web/src/app/router.tsx:16`. Path constants in `web/src/api/endpoints.ts` (a `const`
  object of functions, e.g. `forOrg: (orgId) => \`/organizations/${orgId}/invitations\``).
- Closest form template: `web/src/features/organizations/CreateOrganizationForm.tsx` —
  react-hook-form + zodResolver + `toApiErrorMessage` + `queryClient.invalidateQueries`.
- **No "current org" in client state.** Org ids are passed per-route (`/organizations/:id/...`).
  `web/src/routes/RequireOrganization.tsx:33` only redirects to `/organizations/new` when the user has
  zero orgs. Follow the route-scoped convention.

### 2.6 🔴 Current gaps — this is the risk surface

- ~~**`backend/prisma/migrations/` does not exist.**~~ **DONE 2026-07-16.** Baselined at
  `prisma/migrations/0_init/`; `_prisma_migrations` exists; `prisma/sql/` removed. Schema changes now
  go through `npm run db:migrate`. See `docs/PRISMA.md` §8 for how it was done and how to bootstrap a
  fresh database.
- **No `tenantContext` middleware, no `req.tenantId`.** `backend/src/types/express.d.ts:8` has only
  `user?: { id, sid }`. The comment on line 3 — _"`tenantId` joins it once organizations and
  memberships exist"_ — is **stale**; they exist now.
- **`runAsTenant()` does not exist.** Referenced as future work at `backend/src/db/prisma.ts:14-17`
  and `docs/PRISMA.md:515-524`.
- **RLS is not built**, despite `ARCHITECTURE_AND_TECH_STACK.md:201-217` committing to it as the
  second layer of defense. **Tenant isolation is discipline-only today.**
- **No base query / repository layer.** Controllers call `prisma` directly.
- **No shared list/filter/pagination/search helpers.** No `take`/`skip` anywhere in the backend —
  **nothing is paginated.** The only shared query logic is five inline `orderBy` clauses
  (`organizations.controller.ts:56`, `invitations.service.ts:144`, `master-data.controller.ts:10,20,23`).
  Whoever writes the first list helper is creating it from scratch.

---

## 3. The plan at a glance

| Step  | What                                                     | Why this order                                                                                       | Blocking?                |
| ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| **1** | ~~Baseline Prisma migrations~~                           | Everything else assumes migrations work                                                              | ✅ **DONE 2026-07-16**   |
| **2** | PO module — 5 fixed fields + empty `custom_fields` JSONB | Adding an empty JSONB column to an empty table is free; to a 5M-row table it is a midnight migration | 🔴 Blocks 4              |
| **3** | Ship. Observe which fields customers actually ask for    | Half will turn out to belong in the fixed schema for everyone                                        | ⚪ Judgement             |
| **4** | The field engine                                         | The actual feature                                                                                   | —                        |
| **5** | `tenantContext` + RLS                                    | One missing `where` is a data breach; bigger business risk than the feature itself                   | 🔴 Before real customers |
| **6** | Shared list helper + filter/sort safety                  | Only now do we know the real query shapes                                                            | ⚪ Last                  |

---

## Step 1 — Baseline Prisma migrations 🔴 BLOCKER

> **Do not start Step 2 until this is merged.** Hand-written SQL for a two-table auth system is
> survivable. Hand-written SQL for a metadata-driven field engine, across environments, is not.

```
PROMPT — Step 1

Our Postgres schema is currently managed by hand in pgAdmin. `backend/prisma/migrations/` does not
exist and Prisma Migrate has never run, though it is configured at `backend/prisma.config.ts:11-14`.
Confirmed by `docs/PRISMA.md:361-365` and the header of `backend/prisma/sql/001_invitations.sql`.

Baseline Prisma Migrate against the existing database, following the path already documented in
`docs/PRISMA.md:383-398`.

Requirements:
- Commit all current schema files BEFORE running `db:pull`. Per `docs/PRISMA.md:392`, `db:pull`
  overwrites `prisma/schema/*.prisma` and destroys our `@map` camelCasing and `///` comments — expect
  to hand-repair the diff back to the committed version.
- Generate the baseline with `prisma migrate dev --create-only`, then mark it applied with
  `prisma migrate resolve --applied <migration_name>`. Do NOT let it attempt to reset or drop the DB.
- The resulting migration must be a faithful no-op against the current production schema: running
  `prisma migrate status` afterwards must report no pending changes and no drift.
- Fold `backend/prisma/sql/001_invitations.sql` into the baseline. Once the baseline exists, that
  file's "apply this by hand in pgAdmin" instruction is obsolete — update or remove it, and update the
  "we have no migrations yet" passage at `docs/PRISMA.md:361-365`.
- Document in `docs/PRISMA.md` how a second developer bootstraps a fresh local DB from the baseline.

Do not change any model definitions in this step. This is purely a bookkeeping change.
```

**Acceptance criteria**

- [ ] `backend/prisma/migrations/` exists with one baseline migration.
- [ ] `prisma migrate status` reports **no drift, nothing pending**, against the existing DB.
- [ ] `prisma/schema/*.prisma` is byte-identical to pre-`db:pull` (all `@map` casing and `///`
      comments restored).
- [ ] A fresh empty database can be built from migrations alone.
- [ ] `docs/PRISMA.md:361-365` no longer claims we have no migrations.
- [ ] `backend/prisma/sql/001_invitations.sql` is folded in or explicitly retired.

---

## Step 2 — Purchase Order module (fixed fields + the empty JSONB column)

> The PO module **does not exist yet** — no model, controller, route, or form component. Build it
> plainly, but include `custom_fields` from day one, unused.

```
PROMPT — Step 2

Create the Purchase Order module with its 5 fixed fields ONLY. No custom-field logic yet — but
include the `custom_fields` JSONB column now, sitting unused.

Rationale (do not skip the column): adding an empty JSONB column to an empty table is free. Adding it
to a 5-million-row table later is a migration scheduled at midnight.

Follow `backend/src/modules/invitations/` as the module template — NOT `organizations/`, which does
not follow our documented architecture (inline safeParse, raw error.issues to the client, no service
file).

SCHEMA — new file `backend/prisma/schema/purchasing.prisma`:

model PurchaseOrder {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid  // Organization.id is UUID since f48d2fe
  poNumber       String   @map("po_number") @db.VarChar(50)
  vendorId       String   @map("vendor_id") @db.Uuid
  orderDate      DateTime @map("order_date") @db.Date
  status         String   @default("draft") @db.VarChar(20) // draft | issued | received | cancelled
  totalAmount    Decimal  @default(0) @map("total_amount") @db.Decimal(14, 2)

  // Per-organization custom fields (docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md).
  // Deliberately unused until the field engine lands — the column is cheap now
  // and expensive to add once this table is large.
  customFields   Json     @default("{}") @map("custom_fields")

  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, poNumber])   // PO numbers unique per org, not globally
  @@index([organizationId, orderDate])
  @@map("purchase_orders")
}

Add the back-relation `purchaseOrders PurchaseOrder[]` to the `Organization` model in tenant.prisma.

Adjust the 5 fixed fields if the real spec differs — but keep them as REAL TYPED COLUMNS. Do not move
them into customFields. Business logic reads these (status transitions, totals, PO-number
uniqueness); they need real indexes and real constraints.

BACKEND — `backend/src/modules/purchase-orders/`:
- purchase-orders.routes.ts    — mount under `/organizations/:orgId/purchase-orders`, behind `authenticate`
- purchase-orders.controller.ts — thin; no validation logic, no prisma calls
- purchase-orders.service.ts    — all logic; every query carries organizationId in its `where`
- purchase-orders.schemas.ts    — Zod 4 schemas, used via the `validateBody` middleware
- purchase-orders.types.ts      — PublicPurchaseOrder etc.

Register in `backend/src/routes/index.ts` alongside the existing routers.

TENANT SAFETY (there is no RLS yet — this is the only thing standing between us and a leak):
- Every service function takes organizationId explicitly and includes it in EVERY `where`.
- Verify membership per request. Reuse `assertOrgAdmin` from invitations.service.ts:29-41 for
  mutations. For reads, any member of the org suffices — if a `assertOrgMember` equivalent does not
  exist, add one next to it and export both.
- Scope updates/deletes like invitations.service.ts:170-173 does:
  `updateMany({ where: { id, organizationId } })` — never `update({ where: { id } })`, or an admin can
  mutate another org's row by guessing an id.

FRONTEND — `web/src/features/purchase-orders/`:
- .api.ts + .schemas.ts + list page + create/edit form
- Path constants in `web/src/api/endpoints.ts`, following the existing `forOrg: (orgId) => ...` shape
- Route in `web/src/app/router.tsx`, org-scoped (`/organizations/:id/purchase-orders`)
- Model the form on `web/src/features/organizations/CreateOrganizationForm.tsx`
- Structure the form so a dynamic section can be dropped in later WITHOUT restructuring: render the 5
  fixed fields, then leave an explicit, commented placeholder where the definition loop will go.

MIGRATION: generate a real Prisma migration (Step 1 made this possible). Do not hand-write SQL.

TESTS (Vitest + supertest, matching existing module tests):
- CRUD happy path
- A member of Org A receives 404 (not 403) when requesting Org B's PO by id — do not leak existence
- Non-member receives 403
- poNumber uniqueness is per-org: the same poNumber succeeds in two different orgs
```

**Acceptance criteria**

- [ ] Migration generated by Prisma (not hand-written) and applies cleanly.
- [ ] `custom_fields` column exists, defaults to `{}`, is `NOT NULL`, and no code reads or writes it.
- [ ] Every service function signature takes `organizationId`; **no `where` clause omits it**.
- [ ] Cross-org read returns 404; non-member returns 403; both covered by tests.
- [ ] Same `poNumber` in two orgs both succeed.
- [ ] Module structure matches `invitations/`, not `organizations/`.
- [ ] Form has an explicit placeholder for the dynamic section.

---

## Step 3 — Ship it and observe ⚪

**Not a code step.** Deploy Step 2 and let it run.

Watch which custom fields customers actually ask for. **Expect half of them to belong in the fixed
schema for everyone** — if six of the first eight customers ask for "Delivery Terms", that is not a
custom field, that is a column we forgot. Adding it to the fixed schema is cheaper and faster than
every customer configuring it by hand.

Only build Step 4 for the genuine long tail.

**Exit criterion:** a written list of the real field requests from real customers, split into
"belongs in fixed schema" vs "genuinely varies per org."

---

## Step 4 — The field engine

> Build the sub-steps in the order given. Each is independently reviewable and shippable.

### Step 4.1 — Definitions table + CRUD API

```
PROMPT — Step 4.1

Read docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md first — §6, §7, and §9 define this behaviour.

Add the custom field definitions table (the "recipe") and its admin CRUD API.

SCHEMA — new file `backend/prisma/schema/customfields.prisma`:

model CustomFieldDefinition {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String  @map("organization_id") @db.Uuid   // Organization.id is UUID since f48d2fe
  entityType     String  @map("entity_type") @db.VarChar(50) // purchase_order | (future: invoice, ...)

  // key is IMMUTABLE and NEVER reused, including after archiving — see explainer §7.3.
  // label renames freely; key never moves. (Salesforce API Name vs Label.)
  key            String  @db.VarChar(63)
  label          String  @db.VarChar(100)
  dataType       String  @map("data_type") @db.VarChar(20)
  // text | textarea | number | decimal | checkbox | date | datetime | time
  // | email | url | phone | select | multi_select | attachment

  // Per-type settings: options list, min/max, precision, regex, file limits.
  config         Json    @default("{}")

  isRequired     Boolean @default(false) @map("is_required")
  showInPrint    Boolean @default(true)  @map("show_in_print")
  showInList     Boolean @default(false) @map("show_in_list")
  isFilterable   Boolean @default(false) @map("is_filterable")
  displayOrder   Int     @default(0)     @map("display_order")

  status         String  @default("active") @db.VarChar(20) // active | hidden | archived

  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  archivedAt     DateTime? @map("archived_at") @db.Timestamptz(6)

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // CRITICAL: this constraint spans archived rows too — that is what makes key
  // reuse impossible and prevents ghost data resurrection (explainer §7.3).
  @@unique([organizationId, entityType, key])
  @@index([organizationId, entityType, status, displayOrder])
  @@map("custom_field_definitions")
}

Use String + @db.VarChar + trailing comment for the enum-like columns. Do NOT introduce Prisma enum
blocks — this codebase has zero of them (see Membership.role, Invitation.status).

MODULE — `backend/src/modules/custom-fields/`, following the invitations template.

Routes, all under `/organizations/:orgId/custom-fields`, all behind `authenticate`:
  GET    /?entityType=purchase_order   list definitions (any org member)
  POST   /                             create   (admin only)
  PATCH  /:id                          update   (admin only)
  POST   /:id/archive                  archive  (admin only)
  POST   /:id/restore                  restore  (admin only)
  POST   /reorder                      bulk displayOrder update (admin only)

Every mutation calls assertOrgAdmin (invitations.service.ts:29-41). A regular member must never be
able to reshape their org's forms.

SERVICE RULES — each maps to a documented failure mode:

1. KEY GENERATION. Slugify label → snake_case ("Truck Number" → truck_no). Generated ONCE at create,
   then frozen. Max 63 chars. If taken, suffix _2, _3...
2. KEY UNIQUENESS INCLUDES ARCHIVED ROWS. The @@unique handles this as long as archived rows are never
   deleted. Never delete them.
3. ON UPDATE: `key` and `dataType` are NOT patchable. Reject with 400 —
   "A field's type cannot be changed. Archive this field and create a new one."
   Explainer §7.3: the alternative is 5,000 rows of "GJ-01-1234" in a NUMBER field.
4. ARCHIVE ≠ DELETE. Set status='archived' + archivedAt. NEVER delete the row. NEVER touch
   purchase_orders.custom_fields. There is no DELETE endpoint at all.
5. FIELD CAP. Max 50 status='active' definitions per (organizationId, entityType). Reject with 400
   past that. Enforce from day one — retrofitting a cap onto a customer with 300 fields is a support
   nightmare.
6. FILTERABLE CAP. Max 5 isFilterable=true per (organizationId, entityType). Each one is a potential
   full table scan on a SHARED database — one org's filter degrades every org (explainer §8.2).
7. CONFIG VALIDATION. Validate `config` per dataType with a Zod discriminated union. A select with no
   options, a decimal with precision 40, a regex that does not compile — all rejected at write time,
   not discovered at render time.
8. SELECT OPTION IDS. Options are stored as { id, label, order }. Generate a stable `id` per option at
   write time. Stored values reference the option ID, never the label — so renaming an option does not
   orphan existing data (explainer §7.4).
9. Every query carries organizationId in its `where`.

TESTS:
- Cannot create a definition whose key collides with an ARCHIVED field's key (gets _2 suffix)
- Cannot PATCH dataType → 400
- Cannot PATCH key → 400
- Archive leaves the row present and the JSONB data untouched
- 51st active field → 400
- 6th filterable field → 400
- Non-admin member → 403 on every mutation
- Cross-org: Org A admin cannot read/patch/archive Org B's definitions → 404
```

**Acceptance criteria**

- [ ] `@@unique([organizationId, entityType, key])` present; **no DELETE endpoint exists anywhere**.
- [ ] `dataType` and `key` rejected on PATCH with a helpful message.
- [ ] Archive preserves the row and never touches `purchase_orders.custom_fields`.
- [ ] Caps (50 active / 5 filterable) enforced with clear 400s.
- [ ] Select options carry generated stable `id`s.
- [ ] No Prisma `enum` blocks introduced.
- [ ] All cross-org and non-admin tests pass.

### Step 4.2 — Runtime Zod builder (the heart of the feature)

```
PROMPT — Step 4.2

Build the server-side validator that turns field definitions into a Zod 4 schema at runtime. This is
the security boundary for the whole feature — the client's payload shape is a suggestion; the
database is the truth.

Create `backend/src/modules/custom-fields/custom-fields.validator.ts`:

  buildCustomFieldsSchema(defs: CustomFieldDefinition[]): ZodType

Rules:
- Only status='active' definitions produce writable keys.
- Map each dataType to its Zod type, honouring `config`:
    text        → z.string().max(config.maxLength ?? 255), optional config.regex
    textarea    → z.string().max(config.maxLength ?? 5000)
    number      → z.number().int(), optional min/max
    decimal     → z.string().regex(/^-?\d+(\.\d+)?$/)   ← STRING, see below
    checkbox    → z.boolean()
    date        → z.iso.date()        ("2026-08-01", NO timezone)
    datetime    → z.iso.datetime()    ("2026-08-01T09:30:00Z", UTC)
    time        → z.string().regex(/^\d{2}:\d{2}$/)
    email       → z.email()
    url         → z.url()
    phone       → z.string().regex(config.regex ?? default)
    select      → z.enum(config.options.map(o => o.id))       ← option IDs, not labels
    multi_select→ z.array(z.enum(...)).max(config.maxCount ?? 20)
    attachment  → z.array(z.string().uuid()).max(config.maxCount ?? 1)  ← file IDs, never blobs
- isRequired ? schema : schema.optional().nullable()
- Return z.object(shape).strict() — .strict() is what stops a client smuggling in keys the org never
  defined.

DECIMAL MUST BE A STRING. 15000.10 in JS is a float; round-trip it enough and you get
15000.099999999999. Postgres JSONB stores numbers as `numeric` and is safe, but JSON.parse() in Node
is NOT — that is where money silently corrupts. Store "15000.10"; parse with a decimal library when
computing. This bug surfaces six months later in an invoice total and takes a week to find.

WIRE IT INTO THE PO SERVICE (create + update):
1. Load ACTIVE definitions for THIS organizationId and entityType='purchase_order'.
2. Build the schema.
3. Parse req.body.customFields. On failure, throw ApiError.badRequest with a
   Record<fieldKey, message> matching the shape validateBody produces (middlewares/validate.ts:11-27),
   so the frontend renders errors identically for fixed and custom fields.
4. Write ONLY the parsed result to customFields. Never spread raw req.body in.

REQUIRED-FIELD POLICY ON EDIT — explainer §7.1b. Implement policy (b):
- On CREATE: enforce isRequired.
- On UPDATE: enforce isRequired only for keys ALREADY PRESENT in the stored customFields.
Reason: an org adds a mandatory "Truck Number" today; a user opens a 2024 PO to fix a vendor typo and
is blocked forever by a truck number nobody remembers. Under the strict policy they type "N/A" and
pollute the data permanently. Put that reasoning in a comment — it will look like a bug otherwise.

CROSS-ORG GUARD (explainer §8.4): definitions and the record MUST be loaded with the same
organizationId variable, in the same request. Parsing Org B's record with Org A's definitions renders
Org B's data under Org A's labels with NO error, because JSONB has no schema to complain. Add a test.

CACHING: definitions change ~monthly but are read on every write. Cache per (organizationId,
entityType) in-process with a short TTL (60s). AppSail runs many short-lived instances, so this is a
per-instance cache — that is fine. MUST invalidate on any definition mutation.

TESTS:
- Unknown key in payload → 400 (proves .strict())
- Wrong type per definition → 400
- Required field missing on CREATE → 400
- Required field missing on UPDATE of an old record that never had it → 200 (policy b)
- Required field present-but-emptied on UPDATE → 400
- Decimal round-trips "15000.10" exactly — assert the stored string, not a float
- Org A's definitions never validate Org B's record
- Archived field's key in payload → 400 (not writable)
```

**Acceptance criteria**

- [ ] `.strict()` present; unknown keys rejected with a test proving it.
- [ ] Decimals stored and returned as exact strings; a float round-trip test passes.
- [ ] Edit policy (b) implemented **with the reasoning in a comment**.
- [ ] Error shape identical to `validateBody`'s `Record<path, message>`.
- [ ] Definition cache invalidates on mutation.
- [ ] Cross-org parse test passes.

### Step 4.3 — Frontend: 14 input components + the render loop

```
PROMPT — Step 4.3

Render the dynamic section of the PO form from the field definitions.

Fetch: GET /organizations/:orgId/custom-fields?entityType=purchase_order
Use TanStack Query with a long staleTime (definitions change monthly) — but invalidate immediately on
any definition mutation, or users will fill in a form that no longer exists.

Build ONE component per dataType in `web/src/features/custom-fields/inputs/`. ~14 components, written
once, serving every custom field for every organization forever. That is the leverage of this design —
do not write per-field or per-org components.

  TextInput, TextareaInput, NumberInput, DecimalInput, CheckboxInput, DateInput,
  DateTimeInput, TimeInput, EmailInput, UrlInput, PhoneInput, SelectInput,
  MultiSelectInput, AttachmentInput

No UI library in this project — hand-build them, matching the existing form controls in
`web/src/features/organizations/CreateOrganizationForm.tsx` and docs/UI_UX_PRINCIPLES.md.

Render into the placeholder left in Step 2:
- fixed fields first (hardcoded), then definitions sorted by displayOrder
- switch on dataType → component
- unknown/future dataType → render nothing and warn in console. NEVER crash the form: an older
  frontend WILL meet a newer dataType during a rolling deploy.

Client-side validation mirrors the server for UX only — build a matching Zod schema for zodResolver
from the same definitions. The server remains the authority (Step 4.2). Never rely on this.

DECIMAL: keep as a string end to end. Never Number() it. Never let react-hook-form coerce it —
set valueAsNumber={false} explicitly.

SELECT/MULTI_SELECT: value is the option ID; render config.options[].label. Never store the label.

ATTACHMENT: upload separately, store the returned file ID in customFields. Never the blob.

MISSING ≠ EMPTY (explainer §7.1c). On any read/display path use `key in obj`, never `if (obj[key])` —
0, "", and false are all falsy and all are real user answers. Render `—` for absent/null. NEVER
render 0 for a missing number or "No" for a missing checkbox: a 2024 PO showing "Inspection Done: No"
is a lie — the inspection did not fail, the concept did not exist yet.
```

**Acceptance criteria**

- [ ] Exactly one component per dataType; none are field- or org-specific.
- [ ] Unknown `dataType` degrades gracefully — form still renders and submits.
- [ ] Decimal never passes through `Number()`; `valueAsNumber={false}` set.
- [ ] Select stores option IDs; labels resolved at render.
- [ ] `—` for missing; `0`/`No` only when genuinely entered. Test with a record predating the field.
- [ ] Definition query invalidates on mutation.

### Step 4.4 — Admin UI

```
PROMPT — Step 4.4

Build the "Manage Fields" admin screen at
/organizations/:id/settings/purchase-orders/fields — visible to owner/admin only.

- List definitions ordered by displayOrder; drag-to-reorder → POST /reorder
- Add/edit: label, type, required, showInPrint, showInList, isFilterable, per-type config
- Type picker is DISABLED when editing an existing field. Tooltip: "A field's type can't be changed.
  Archive this field and create a new one." (Server rejects it anyway — this just explains why.)
- Live preview of the field being configured
- Show the generated `key` read-only next to the label, labelled "API name" — users need it for
  support conversations, and showing it makes its permanence obvious

ARCHIVE FLOW — this is the part that prevents our worst support ticket:
- The button says "Archive", never "Delete"
- The confirm dialog MUST show the usage count:
  "This field has data on 4,812 purchase orders. Those values will be hidden from all records,
   including printed documents. Continue?"
  The COUNT is what makes an admin stop and think. Add a service method that counts rows where the
  key is present in custom_fields, scoped to the org.
- Offer "Export values to CSV" in that dialog before confirming. Costs an afternoon; saves the worst
  ticket we will ever get.
- Show archived fields in a collapsed "Archived" section with a Restore action

Also expose `hidden` as a distinct state from `archived` — hidden is the honest answer to "remove this
field": stop collecting it, keep showing what was collected (explainer §7.2).
```

**Acceptance criteria**

- [ ] No "Delete" anywhere in the UI.
- [ ] Archive dialog shows a real usage count and offers CSV export.
- [ ] Type picker disabled on edit, with an explanation.
- [ ] `key` displayed read-only as "API name".
- [ ] Non-admins cannot reach the screen (route guard **and** server 403).

### Step 4.5 — Print / PDF

```
PROMPT — Step 4.5

Render custom fields on the printed PO.

- Loop definitions.filter(d => d.showInPrint), sorted by displayOrder
- For each, read po.customFields[def.key]
- Missing key → print "—". NEVER print 0 or "No" for a missing value (explainer §7.1c)
- Include values from `hidden` definitions on OLD records that have data for them — that is exactly
  what `hidden` means. Exclude `archived`.
- The template must NEVER hardcode a field name

Formatting is driven by dataType: decimals by config.precision, dates in the org's locale, booleans as
Yes/No, multi_select as comma-joined LABELS resolved from option IDs, attachments as filename or a
"see attached" marker.
```

**Acceptance criteria**

- [ ] A PO created before a field existed prints `—`, not `0`/`No`.
- [ ] `hidden` fields still print on records that have values.
- [ ] `archived` fields never print.
- [ ] No field name is hardcoded in the template.

---

## Step 5 — `tenantContext` + Row-Level Security 🔴

> **`ARCHITECTURE_AND_TECH_STACK.md:201-217` promised two layers of defense. Only one exists.** Right
> now a single forgotten `where` clause is a cross-tenant data breach, and nothing in the stack will
> catch it. **This is a bigger risk to the business than custom fields are a feature.** Do this before
> real customers land.

```
PROMPT — Step 5

Implement the second layer of tenant isolation promised in ARCHITECTURE_AND_TECH_STACK.md:201-217 but
never built. Today, isolation is discipline-only: every controller hand-writes organizationId into
every `where`, and one omission leaks another company's data with nothing to stop it.

PART A — tenantContext middleware
- Add `tenantId?: string` to `backend/src/types/express.d.ts` (line 8 currently has only
  `user?: { id, sid }`). Update the stale comment on line 3 — it says "tenantId joins it once
  organizations and memberships exist"; they exist now.
- New `backend/src/middlewares/tenantContext.ts`: read :orgId from the route, verify the authenticated
  user has a Membership in it, attach req.tenantId. 403 if not a member.
- Apply to every org-scoped router. This REPLACES the ad-hoc per-service membership checks — but do
  not remove the in-service organizationId `where` clauses. Defense in depth: the middleware
  authorizes, the `where` scopes, RLS backstops.

PART B — runAsTenant() + RLS
`backend/src/db/prisma.ts:14-17` and docs/PRISMA.md:515-524 both reference runAsTenant() as future
work. Build it.

- Create a NON-OWNER Postgres role for the app. CRITICAL: table owners and superusers BYPASS RLS
  entirely. If the app connects as the owner, every policy below is silently a no-op and the whole
  step is theatre. Verify explicitly that the app's role is not the owner and does not have BYPASSRLS.
- runAsTenant(tenantId, fn): open a transaction, `SET LOCAL app.current_tenant = $1`, run fn inside it.
  SET LOCAL is transaction-scoped, which is what makes this safe with a connection pool — the setting
  cannot leak to the next request that borrows the connection. Never use SET without LOCAL.
- Enable RLS on every tenant table (purchase_orders, custom_field_definitions, memberships,
  invitations, and any future org-scoped table):
    ALTER TABLE x ENABLE ROW LEVEL SECURITY;
    ALTER TABLE x FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON x
      USING (organization_id = current_setting('app.current_tenant', true));
  FORCE matters — without it the policy does not apply to the table owner even for normal queries.
- `users` is deliberately NOT tenant-scoped (prisma.ts:14-17): a user row exists before any
  organization does, and one user belongs to many orgs. Do not put a policy on it.
- Note the type: organization_id is TEXT, and current_setting returns text — so the comparison needs
  no cast. If you add RLS to a table whose org column is uuid, you must cast, or the policy errors.

PART C — prove it works
Tests that FAIL without RLS (this is the only way to know the policies are live, not theatre):
- Inside runAsTenant('org_a'), a raw `SELECT * FROM purchase_orders` with NO where clause returns ONLY
  org_a rows
- The same query outside any tenant context returns zero rows
- An UPDATE targeting an org_b row id from inside org_a's context affects 0 rows
- Assert the app's DB role is not the table owner and lacks BYPASSRLS

Wire runAsTenant into the request path via the middleware so services inherit the context. Migrate
purchase-orders and custom-fields first, then the existing modules.

Update ARCHITECTURE_AND_TECH_STACK.md and PRISMA.md — both currently describe this as future work.
```

**Acceptance criteria**

- [ ] `req.tenantId` exists; `express.d.ts:3` comment no longer stale.
- [ ] App connects as a **non-owner role** — asserted in a test, not just believed.
- [ ] RLS `ENABLE` **and** `FORCE` on every tenant table; `users` deliberately excluded.
- [ ] `SET LOCAL` (never bare `SET`) inside a transaction.
- [ ] The "no `where` clause returns only my tenant's rows" test passes — **and fails if policies are
      dropped**.
- [ ] In-service `organizationId` filters retained (defense in depth).
- [ ] Both docs updated.

---

## Step 6 — Shared list helper + filter/sort safety ⚪

> Do this **last**. There are no shared query helpers today and nothing is paginated — no `take`/`skip`
> exists anywhere in the backend. Writing the abstraction before we know the real query shapes is how
> you get the wrong abstraction.

```
PROMPT — Step 6

Add the first shared list/filter/sort/pagination helper, and make custom-field filtering safe.

Context: there are currently NO shared query helpers in backend/src. Nothing is paginated. The only
shared query logic is five inline orderBy clauses. This is the first one — design it for the ~150
tables coming, but do not over-build.

PART A — the helper
`backend/src/lib/listQuery.ts`: cursor pagination (not offset — offset degrades badly on large
tables), sort, filter. It must stay tenant-agnostic and take organizationId explicitly.

The good news, and the reason we chose JSONB (explainer §8.1): the base list query is IDENTICAL
regardless of how many custom fields an org has. Org A with 8 fields and Org B with 30 produce
byte-for-byte the same SQL. The custom_fields column just rides along. Do not let the helper's design
break that.

PART B — custom-field filtering, safely
Prisma supports: where: { customFields: { path: ['truck_no'], equals: v } }

- Only allow filtering on definitions with isFilterable=true (capped at 5 in Step 4.1). Every
  filterable field is a potential full table scan on a SHARED database — at 5M rows that is a
  30-second query pinning a CPU core and degrading EVERY other org simultaneously. That is the
  multi-tenant tax.
- Add the GIN index in a migration:
    CREATE INDEX idx_po_custom_fields
      ON purchase_orders USING GIN (custom_fields jsonb_path_ops);
- Document the per-org expression index as a deliberate OPS action for hot fields — never automated,
  because auto-creating indexes per user-invented field is runtime DDL by the back door (explainer
  §3.1):
    CREATE INDEX idx_po_truck_no ON purchase_orders ((custom_fields->>'truck_no'))
      WHERE organization_id = 'org_abc';

PART C — sorting, safely
custom_fields->>'x' returns TEXT. Sorting text gives "100", "20", "3" — because alphabetically
"1" < "2" < "3". Numeric sort needs a cast, and the cast EXPLODES if any row holds junk:
  ORDER BY (custom_fields->>'amount')::numeric   -- ERROR if any row has "N/A"
(A row CAN hold "N/A" — from before validation tightened. This is why Step 4.1 forbids type changes.)

NEVER build ORDER BY from a raw user string. Required flow:
  1. Look up the definition by key for THIS org
  2. Not found, or not showInList/isFilterable → reject 400. Do not pass it through.
  3. Read its dataType → emit the cast that type dictates
  4. Use Prisma.sql parameterization. Dynamic ORDER BY is the classic SQL-injection vector.
Add NULLS LAST — records predating the field will sort as null (explainer §7.1).

PART D — apply to the PO list endpoint, and only there for now.

TESTS:
- Sort by a decimal custom field orders numerically, not alphabetically ("100" after "20")
- Sort by an unknown key → 400, no SQL executed
- Sort by a key belonging to ANOTHER org → 400
- Filter on a non-filterable field → 400
- Records missing the field sort last and are never dropped from results
- An injection attempt in the sort param is rejected, not escaped-and-run
- EXPLAIN confirms the GIN index is used for a containment filter
```

**Acceptance criteria**

- [ ] Base list query unchanged in shape regardless of custom field count.
- [ ] GIN index created via migration; `EXPLAIN` proves it is used.
- [ ] Sort keys resolved through definitions; unknown/foreign keys → 400 with **no SQL executed**.
- [ ] Numeric sort test passes ("100" sorts after "20").
- [ ] `NULLS LAST`; pre-field records never dropped.
- [ ] Injection test passes.

---

## 7. Definition of done (whole feature)

- [ ] An org admin adds a field through the UI. **No deploy, no migration, no DDL.**
- [ ] The field appears on the form, validates server-side, saves, and prints.
- [ ] Another org is completely unaffected — verified by test, not by inspection.
- [ ] POs created before the field show `—`, never `0`/`No`.
- [ ] Archiving hides the field and preserves every stored value.
- [ ] Re-creating a field with the same label gets `key_2` — **no ghost data resurrects**.
- [ ] Renaming a label or a select option leaves stored data intact.
- [ ] RLS is live: a query missing its `where` returns this tenant's rows only.
- [ ] Decimal `"15000.10"` round-trips exactly.
- [ ] `docs/PRISMA.md` no longer says "we have no migrations yet."

---

## 8. Trap checklist — re-read before each PR

| #   | Trap                                              | Guard                                                                                                                                                                                              |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Missing** `@db.Uuid` on an FK to `Organization` | `Organization.id` is **UUID** since `f48d2fe` (§2.3) — FKs need `@db.Uuid`. `prisma validate` will **not** catch a mismatch; Postgres fails at runtime with `operator does not exist: uuid = text` |
| 2   | `@default(uuid())`                                | House style is `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`                                                                                                                               |
| 3   | Prisma `enum` blocks                              | Zero exist here — `String @db.VarChar(n)` + comment                                                                                                                                                |
| 4   | Bare `DateTime`                                   | Always `@db.Timestamptz(6)`                                                                                                                                                                        |
| 5   | Copying `modules/organizations/`                  | Copy `modules/invitations/`                                                                                                                                                                        |
| 6   | Hand-written SQL in `prisma/sql/`                 | Step 1 makes real migrations possible — use them                                                                                                                                                   |
| 7   | `update({ where: { id } })`                       | `updateMany({ where: { id, organizationId } })` — `invitations.service.ts:170-173`                                                                                                                 |
| 8   | Deleting a definition                             | Archive only. No DELETE endpoint exists                                                                                                                                                            |
| 9   | Reusing an archived key                           | Unique constraint spans archived rows                                                                                                                                                              |
| 10  | Allowing a `dataType` change                      | 400. Archive and re-create                                                                                                                                                                         |
| 11  | Decimal as a JS number                            | String end to end. `JSON.parse` corrupts it silently                                                                                                                                               |
| 12  | `if (obj[key])`                                   | `key in obj` — `0`/`""`/`false` are real answers                                                                                                                                                   |
| 13  | Backfilling old records                           | Never. There is no truthful value to write                                                                                                                                                         |
| 14  | Enforcing `required` on edit of old records       | Policy (b) — create only, or if already present                                                                                                                                                    |
| 15  | Org A's defs parsing Org B's record               | Same `organizationId` variable, same request                                                                                                                                                       |
| 16  | `ORDER BY` from a user string                     | Resolve via definitions; reject unknown                                                                                                                                                            |
| 17  | Option labels as stored values                    | Store option IDs                                                                                                                                                                                   |
| 18  | App connecting as the table owner                 | Owners **bypass RLS** — the whole step becomes theatre                                                                                                                                             |
| 19  | `SET` without `LOCAL`                             | Leaks tenant context across pooled connections                                                                                                                                                     |
| 20  | Forgetting `FORCE ROW LEVEL SECURITY`             | Policy silently skips the owner                                                                                                                                                                    |

---

## 9. Summary — the design in one paragraph

> Store the **shape** of the form in `custom_field_definitions` (one row per field per org). Store the
> **values** in a single `custom_fields` JSONB column on the record. Keep the internal **key immutable
> and never reused**, split from a freely-renameable label. **Archive, never delete.** Validate on the
> server by building a Zod schema at runtime from the definitions. And treat _"this field didn't exist
> yet"_ as a real and different thing from _"the user left it blank."_

**Adding a field is one `INSERT`. That is the entire point. If any step ever requires a migration or a
deploy to add a customer's field, the design has been broken — stop and re-read
`DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`.**
