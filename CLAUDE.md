# CLAUDE.md

Multi-tenant SaaS (production monitoring / inventory). **Express 5 + TypeScript** modular monolith,
**React 19 + Vite** front end, **PostgreSQL 18 via Prisma 7**, deployed to **Zoho Catalyst AppSail**.
One product, many customer companies — a cross-tenant leak is an existential risk, not a bug.

Long-form reasoning lives in `docs/`. This file is only the things that are easy to get wrong and
expensive when you do.

---

## 🔴 Tenant isolation — read before writing any query

**Two layers. Both are required. They catch different mistakes.**

```ts
// Every tenant-scoped read/write:
runAsTenant(
  organizationId,
  (tx) => tx.vendor.findMany({ where: { organizationId } }), // <- keep BOTH
);
```

| You forget                  | What saves you                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `where: { organizationId }` | RLS (Postgres returns only your tenant's rows)                                     |
| `runAsTenant`               | Nothing protects — but the query returns **0 rows**, so it fails closed and loudly |

Do **not** drop the `where` because "RLS handles it". RLS covers `vendors` only. `organizations`,
`memberships`, and `invitations` have **no policy on purpose** — they're read _before_ a tenant exists
(`tenantContext` reads `memberships`; you list orgs before picking one; invite links are public), so
gating them deadlocks every login. Migrations and `seed.ts` run as the owner and bypass RLS entirely.

**Never read the organization from a header or `req.params` directly.** Use `req.tenantId`, set by
`middlewares/tenantContext.ts` _after_ verifying membership. A route param or header is a claim the
client chose. On 2026-07-16 a middleware that only checked the header was _present_ let any user read
and write any organization's vendors — see `vendors.tenant-isolation.test.ts`.

**A route that touches tenant data takes the org from the path — copy `src/modules/purchases/vendors/`:**

```ts
// routes/index.ts — the org id lives in the URL, never a header or the body
apiRouter.use('/organizations/:orgId/purchases/vendors', vendorsRouter);

// vendors.routes.ts
const router = Router({ mergeParams: true }); // without it `:orgId` is undefined → every request 400s
router.use(authenticate, tenantContext); // authenticate FIRST — tenantContext needs `req.user`

// vendors.controller.ts
const orgId = req.tenantId!; // NOT `req.params.orgId` — only tenantContext's copy is membership-checked
```

`:orgId` is what the client typed in the URL bar. `tenantContext` is the only thing that reads it; it
promotes it to `req.tenantId` after checking `memberships`. Everything downstream reads `req.tenantId`.

- Mount specific paths **before** `/organizations` in `routes/index.ts`.
- **New tenant table?** Add an RLS policy (copy the two statements at the bottom of
  `migrations/*_enable_rls`) **and** add it to `TENANT_TABLES` in `src/db/rls.test.ts`.
  _A tenant table with no policy is unprotected and nothing will tell you._

## 🔴 Database

- **Never create or alter a table by hand.** Schema file → `npm run db:migrate` → commit the generated
  SQL. `npm run db:check-drift` (exit 2 = drift) is the enforcement — run it in CI.
- The app connects as **`jobwork_app`** — a non-owner, no `BYPASSRLS`, no DDL rights.
  **Never point `DATABASE_URL` at `postgres`.** The table owner bypasses every policy _silently_;
  RLS that does nothing looks exactly like RLS that works.
- `MIGRATE_DATABASE_URL` (`postgres`) is for the Prisma CLI only — migrations need DDL.
- Cross-tenant admin views need a **separate read-only role and client**, never the app's connection.

## Schema conventions — copy `prisma/schema/tenant.prisma`, not Prisma defaults

|                  | This repo                                                 | **Not**                                   |
| ---------------- | --------------------------------------------------------- | ----------------------------------------- |
| UUID PK          | `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` | `@default(uuid())`                        |
| Timestamps       | `DateTime @db.Timestamptz(6)`                             | bare `DateTime`                           |
| Enum-like        | `String @db.VarChar(n)` + `// a \| b \| c` comment        | Prisma `enum` blocks (there are **zero**) |
| Naming           | `@@map("snake_case")` / `@map("snake_case")`              | camelCase columns                         |
| Case-insensitive | `@db.Citext`                                              | `mode: 'insensitive'`                     |

🔴 **An FK to `Organization` needs `@db.Uuid`.** `Organization.id` became uuid in `f48d2fe`.
**`prisma validate` will NOT catch a mismatch** — it compares _Prisma_ types (`String` == `String`)
and never sees `uuid` vs `text`. Postgres fails at runtime with `operator does not exist: uuid = text`,
which reads like a query bug. **When you change a PK's native type, grep every FK that references it.**

### Default columns — every domain table carries these five

Added in `migrations/20260720120300_add_default_audit_columns`. Copy this block into
every new **domain** table (business/tenant data). **Exclude** ephemeral token tables
(`refresh_tokens`, `password_reset_tokens`) and master-data reference tables
(`countries`, `states`, `cities`, `industries`, `app_modules`).

```prisma
  isDeleted     Boolean  @default(false) @map("is_deleted")           // soft-delete flag
  createdBy     String?  @map("created_by") @db.Uuid                  // acting user
  updatedBy     String?  @map("updated_by") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  createdByUser User? @relation("<Model>CreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)
  updatedByUser User? @relation("<Model>UpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)
```

And the two back-relations on `User` (relation names must be globally unique):

```prisma
  created<Model>s <Model>[] @relation("<Model>CreatedBy")
  updated<Model>s <Model>[] @relation("<Model>UpdatedBy")
```

- `createdBy`/`updatedBy` are **nullable** — migrations, `seed.ts`, and self-signup have
  no acting user. `onDelete: SetNull` so deleting a user never cascades into business
  data. FK checks bypass RLS in Postgres, so these are safe on tenant tables.
- **Populate them in the service layer** from `req.user.id` — `createdBy` + `updatedBy` on
  create, `updatedBy` on update. Never let the client send them; omit from the input type
  (see `vendors.service.ts` `VendorInput`).
- **Soft delete is enforced** — a "delete" is an `update`, not a `DELETE`:
  ```ts
  // deletes NEVER call tx.x.delete(...). They stamp the flag as an update:
  tx.vendor.update({ where: { id }, data: { isDeleted: true, updatedBy: userId } });
  ```
  `createdBy` stays the original creator; `updatedBy`/`updatedAt` record who removed it, so
  the row reads as "last modified by the deleter". **Every read must filter `isDeleted: false`**
  — list queries, single-row fetches, and the existence check inside update/delete (a
  soft-deleted row must 404, not resurrect). `tenantContext` also filters `organization.isDeleted`,
  so a deleted org is unreachable through any tenant route even though the membership row remains.
  See `vendors.service.ts`, `items.service.ts`, `organizations.controller.ts`.
- ⚠️ **Unique constraints + soft delete:** a soft-deleted row still occupies its unique key
  (`@@unique([organizationId, vendorNumber])`, `@@unique([userId, organizationId])`, …). If you
  ever need to re-create a key a soft-deleted row holds, either reactivate that row
  (`isDeleted: false`) or add a **partial unique index** (`WHERE is_deleted = false`). None are
  needed today (vendor numbers come from a sequence; membership accept upserts the existing row).

### Custom fields — every domain table also carries `custom_fields`

Per-org dynamic fields live in **one JSONB column**, never extra tables or per-tenant columns.
Copy this into every new **domain** table (same exclusions as the five audit columns above — no
ephemeral token tables, no master-data reference tables):

```prisma
  customFields Json @default("{}") @map("custom_fields") // per-org dynamic fields
```

- **Migration time:** add the column when you first create the table. Empty JSONB on an empty
  table is free; bolting it onto a million-row table later is a midnight migration. Field
  _definitions_ live once in `custom_field_definitions` (`prisma/schema/customfields.prisma`), so a
  new module needs **no new table** — only its `custom_fields` column and an `entityType` string.
- **Validation time (create + update):** never trust the client's `customFields` shape. Inside the
  **same `runAsTenant` tx**, load the org's active definitions and validate through the engine, then
  persist the cleaned object — copy `vendors.service.ts` / `items.service.ts`:
  ```ts
  const defs = await loadActiveDefinitions(tx, organizationId, 'vendor');
  const customFields = validateCustomFields({
    defs,
    input: rawCustomFields,
    mode: 'create', // or 'update' with `existing: row.customFields`
  });
  ```
  The engine (`src/modules/custom-fields/customFields.engine.ts`) strips unknown keys, type-checks
  each value, stores decimals as **strings** and select/multi-select as option **ids**, preserves
  hidden/archived values, and enforces required **only on create, or on update when the field
  already held a value** (old records stay editable). It throws `ApiError(400)` with `details` keyed
  `customFields.<key>` — so the controller **must have an `ApiError` branch** (the vendor/item
  controllers do) or those field errors collapse into a generic 500.
- **Read time:** nothing changes — `custom_fields` rides along like any column, so list/detail
  queries keep their shape. Accept it on the module's create/update schema
  (`customFields: z.record(z.string(), z.unknown()).optional()`), then destructure it out of the
  Prisma write and set the **validated** value, never the raw input.
- **Register a new module** in the allowlist both sides: backend `ENTITY_TYPES`
  (`customFields.constants.ts`) and frontend `CUSTOM_FIELD_MODULES` (`customFields.schemas.ts`).
  `helpText`, `defaultValue`, and dropdown `options` live inside the definition's `config` JSONB —
  no migration to add or change them.

## Module conventions

- **Copy `src/modules/invitations/`**: `.routes` / `.controller` / `.service` / `.schemas` / `.types`,
  `validateBody` middleware + `ApiError` + a real service layer. Register in `src/routes/index.ts`.
- **Do not copy `src/modules/organizations/`** — inline `safeParse`, raw `error.issues` returned to the
  client, membership checks in the controller, no service file. It predates the convention.
- Reuse `assertOrgAdmin` (`invitations.service.ts`) for admin-only actions.
- Scope mutations: `updateMany({ where: { id, organizationId } })`, never `update({ where: { id } })`.
- 🔴 **New module with protected routes? Two steps, both required.** (1) Register its resource in
  `permissions.catalog.ts` `MODULE_GROUPS`, under the main module the sidebar files it beneath — one
  line adds `<resource>:read/create/update/delete` to the catalog, the role editor's grid, and the
  computed Owner role. (`read` is implied by the other three — `withImpliedRead`.) (2) Gate **every** route with
  `requirePermission('<resource>:<action>')`, mounted after `authenticate, tenantContext`. Forgetting
  step 1 fails **closed** (nobody can act — loud). Forgetting step 2 fails **open and silently** — the
  module has no gate, every member can do everything, and nothing warns you (same shape as a tenant
  table with no RLS policy). A module's routes are not done until each carries a `requirePermission`.
  Copy `src/modules/purchases/vendors/`. Full model in `docs/ROLES_AND_PERMISSIONS.md`.
- 🔴 **A Role is NOT a permission set.** Since 2026-07-25 they are two independent things on a
  Membership: `roleId` → `roles` is a **job title that grants nothing** (no middleware reads it),
  and `permissionTemplateId` → `permission_templates` **is** the authorization. Same title with
  different access, and one bundle across titles, are both normal. Never branch on a role name —
  the check belongs in the catalog + `requirePermission`. Managing the two is separately grantable
  (`role:*` vs `permission_template:*`): retitling staff is harmless, rewriting permissions is
  privilege escalation.
- 🔴 **`Membership.isOwner` is above the permission system, and there is only ONE gate below it.**
  `tenantContext` resolves an owner to every permission _before_ reading a template, so no route
  ever branches on ownership — `requirePermission` is a pure set check. `requireOwner` exists only
  for what no template may grant (deleting the org; later ownership transfer), because anyone with
  `permission_template:update` can self-grant every key. **Never write a bespoke membership lookup
  in a service to authorize** — that was `assertOrgAdmin`, a second system that ignored the catalog
  and left `member:create` holders unable to invite; it is gone. Mount `tenantContext` and add a
  `requirePermission`.

## 🔴 API responses — one envelope, one error path

**Every endpoint returns `{ statusCode, message, data }`.** Successes go through
`sendSuccess()` (`src/lib/apiResponse.ts`); failures go through `errorHandler`, which emits the
same three keys with `data: null`. New endpoint? Use them — do not hand-roll `res.json`.

```ts
sendSuccess(res, vendors); // 200 "Success"
sendSuccess(res, vendor, 'Vendor created.', 201); // 201
sendSuccess(res, null, 'Vendor deleted.'); // 200, no payload
```

- 🔴 **Controllers contain NO try/catch.** Express 5 forwards a rejected promise from an async
  handler straight to `errorHandler`. Each layer owns one job:

  | Layer          | Job                                                     | Produces              |
  | -------------- | ------------------------------------------------------- | --------------------- |
  | route          | `validateBody(schema)`                                  | 400 + field `details` |
  | service        | business rules → `throw ApiError` / `ApiError.notFound` | 404                   |
  | service        | writes wrapped in `withUniqueViolation(msg, fn)`        | 409, domain message   |
  | controller     | happy path → `sendSuccess`                              | 2xx                   |
  | `errorHandler` | turns anything thrown into the envelope                 | the response          |

  `withUniqueViolation` (`lib/apiError.ts`) belongs in the **service**, which knows which
  constraint it is writing against — that's how you keep "Vendor number already exists in this
  organization" instead of a generic 409.
  The only legitimate `catch` left is one that **changes behaviour** and writes no response —
  see `auth.logout`, which deliberately swallows a forged token but still clears the cookie.
  `catch { res.status(500).json({ error: String(err) }) }` duplicates the handler, downgrades real
  404s/403s to 500s, and leaks internals — it really did echo connection strings to the client.

- **`data` must keep the shape the client already reads.** `web/src/api/client.ts` unwraps the
  envelope in one interceptor and hands the inner value to feature code, so changing that shape
  is a breaking API change. A call that **bypasses** `apiClient` (raw `axios`, e.g.
  `refreshAccessToken`) must read `res.data.data` itself.
- **No 204.** A 204 carries no body, so it can't express the envelope — return 200 with
  `data: null` and a message.
- `details` stays a **top-level** key beside `message`, not inside `data`: it's error metadata,
  and the client reads `response.data.details` to highlight fields.
- _A `responseFormatter` middleware used to monkey-patch `res.json` and infer the envelope. It had
  to guess which key was the message, and guessed wrong — it buried `details`, relabelled real
  errors "Server Error", and `delete`d any payload field named `message`. Don't reintroduce it._

## Frontend

- `web/src/features/<name>/` with `.api.ts` + `.schemas.ts` + components. Paths in `api/endpoints.ts`.
- Tenant pages live at `/organizations/:orgId/...` — the org comes from `useParams`, never localStorage.
  Query keys must include `orgId` or switching org serves the previous tenant's cache.
- No UI library; hand-built controls. See `docs/UI_UX_PRINCIPLES.md`.

## Commands

```bash
# backend/
npm run dev · typecheck · lint
npm run db:migrate       # prisma migrate dev — authoring, YOUR machine only (can reset the DB)
npm run db:deploy        # prisma migrate deploy — every other environment, never resets
npm run db:check-drift   # exit 0 = in sync, 2 = drift. Run in CI.
npx vitest run

# web/
npx tsc -b               # ⚠️ THE typecheck. `tsc --noEmit` checks ZERO files
                         # (tsconfig.json has "files": [] + project references), and
                         # Vite/rolldown strips types without checking them. Both "pass" on
                         # broken code.
```

## Docs

|                                                           |                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/PRISMA.md` §8                                       | migrations, the RLS runbook, drift, why the DB was baselined |
| `docs/ARCHITECTURE_AND_TECH_STACK.md`                     | every tech decision + rejected alternatives                  |
| `docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`                 | per-org custom fields — concepts                             |
| `docs/DYNAMIC_CUSTOM_FIELDS_IMPLEMENTATION_PROMPT.md`     | …and the ordered build plan                                  |
| `docs/ROLES_AND_PERMISSIONS.md`                           | permission templates, `requirePermission`, the code catalog  |
| `docs/AUTHENTICATION.md` · `CATALYST_DEPLOYMENT_GUIDE.md` | auth model · deploy                                          |
