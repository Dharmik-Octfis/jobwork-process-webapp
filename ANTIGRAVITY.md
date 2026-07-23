# ANTIGRAVITY.md

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

**Every table MUST include these 5 audit fields:**

```prisma
  isDeleted      Boolean  @default(false) @map("is_deleted")
  createdBy      String?  @map("created_by") @db.Uuid
  updatedBy      String?  @map("updated_by") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
```

When creating new tables and APIs, always consider these keys and take reference from old APIs and tables.

**Every domain table also carries a `custom_fields` JSONB** — per-org dynamic fields live in one
column, never extra tables or per-tenant columns (same exclusions as the 5 audit fields: no token
or master-data reference tables):

```prisma
  customFields Json @default("{}") @map("custom_fields")
```

- **Migration time:** add the column when the table is first created (free on an empty table, a
  midnight migration on a large one). Field _definitions_ live once in `custom_field_definitions`;
  a new module needs **no new table** — only its `custom_fields` column and an `entityType` string.
- **Validation time (create + update):** never trust the client's shape. Inside the same
  `runAsTenant` tx, load the org's active definitions and validate through the engine, then persist
  the cleaned object — copy `vendors.service.ts` / `items.service.ts`:
  ```ts
  const defs = await loadActiveDefinitions(tx, organizationId, 'vendor');
  const customFields = validateCustomFields({
    defs,
    input: rawCustomFields,
    mode: 'create' /* or 'update', existing */,
  });
  ```
  The engine (`src/modules/custom-fields/customFields.engine.ts`) strips unknown keys, type-checks
  values, stores decimals as strings + select/multi-select as option **ids**, and enforces required
  **only on create, or on update when the field already had a value**. It throws `ApiError(400)` with
  `details` keyed `customFields.<key>` — the controller **needs an `ApiError` branch** or those
  become a 500.
- **Read time:** unchanged — it's a column, so queries keep their shape. Accept
  `customFields: z.record(z.string(), z.unknown()).optional()` on the module schema, and set the
  **validated** value (never the raw input). Register new modules in `ENTITY_TYPES` (backend) +
  `CUSTOM_FIELD_MODULES` (frontend); `helpText`/`defaultValue`/`options` live in the `config` JSONB.

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

## Module conventions

- **Copy `src/modules/invitations/`**: `.routes` / `.controller` / `.service` / `.schemas` / `.types`,
  `validateBody` middleware + `ApiError` + a real service layer. Register in `src/routes/index.ts`.
- **Do not copy `src/modules/organizations/`** — inline `safeParse`, raw `error.issues` returned to the
  client, membership checks in the controller, no service file. It predates the convention.
- Reuse `assertOrgAdmin` (`invitations.service.ts`) for admin-only actions.
- Scope mutations: `updateMany({ where: { id, organizationId } })`, never `update({ where: { id } })`.
- 🔴 **New module with protected routes? Two steps, both required.** (1) Register its resource in
  `permissions.catalog.ts` `RESOURCES` — one line adds `<resource>:read/create/update/delete` to the
  catalog, the role editor's grid, and the computed Owner role. (2) Gate **every** route with
  `requirePermission('<resource>:<action>')`, mounted after `authenticate, tenantContext`. Forgetting
  step 1 fails **closed** (nobody can act — loud). Forgetting step 2 fails **open and silently** — the
  module has no gate, every member can do everything, and nothing warns you (same shape as a tenant
  table with no RLS policy). A module's routes are not done until each carries a `requirePermission`.
  Copy `src/modules/purchases/vendors/`. Full model in `docs/ROLES_AND_PERMISSIONS.md`.

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
