# CLAUDE.md

Multi-tenant SaaS (production monitoring / inventory). **Express 5 + TypeScript** modular monolith,
**React 19 + Vite** front end, **PostgreSQL 18 via Prisma 7**, deployed to **Zoho Catalyst AppSail**.
One product, many customer companies — a cross-tenant leak is an existential risk, not a bug.

Long-form reasoning lives in `docs/`. This file is only the things that are easy to get wrong and
expensive when you do.

---

## 🔴 Three middlewares, three questions — all required

| Middleware          | Question it answers                         | How                                        | Checked live?    |
| ------------------- | ------------------------------------------- | ------------------------------------------ | ---------------- |
| `authenticate`      | Was this token signed by us and unexpired?  | JWT verify — **no database access at all** | ❌ no            |
| `tenantContext`     | Is the caller a current member of this org? | `memberships` where `isDeleted: false`     | ✅ every request |
| `requirePermission` | May they perform this action?               | the caller's resolved permission set       | ✅ every request |

A protected route missing any of these fails **open and silently** — same shape as a tenant table
with no RLS policy. Mount them in that order; each needs what the one before it set.

🔴 **`authenticate` proves the token, not the account.** A signature only proves the token was
genuine _when it was minted_. It is never resolved against `refresh_tokens`, so for up to
`JWT_ACCESS_TTL` (**15m**) an access token keeps working after its owner was deactivated,
soft-deleted, or logged out, and after their session row was revoked. `sid` is a claim on this path,
nothing more. **This is a deliberate throughput trade made 2026-07-24, not an oversight** — a
per-request `sid` lookup was implemented and then removed. Do not "fix" it by reinstating an
unconditional lookup; if the window ever needs closing, cache the lookup on `sid` with a short TTL so
the staleness bound is tunable. `middlewares/authenticate.test.ts` pins the current behaviour, window
included.

**So revocation happens at the refresh boundary, and only there.** `auth.service.refresh` is the
entire enforcement surface: row must exist, **must not be revoked**, belong to `sub`, be unexpired,
and the user must satisfy `ACTIVE_USER` — and it revokes every session when that last check fails.
Weaken it and a disabled account works **forever** instead of for 15 minutes. It is guarded by the
second describe block in that test file.

🔴 **The refresh token is NOT rotated (2026-07-31), and reintroducing rotation will log users out at
random.** The old code deleted the presented token and created a replacement, committing that before
the response could reach the browser — so any interrupted refresh (reload, dropped wifi, closed lid)
left the browser holding a token the server had destroyed, which the next call read as theft and
answered with `deleteMany WHERE userId`: every session on every device. It is not fixable by
reordering; the DB write is durable before the response leaves the process. `refresh` now returns the
same token and only mints a new access token. The trade — a stolen refresh token is not caught on
reuse — is paid for by revocation being immediate and checked on every refresh. The regression guard
is `authenticate.test.ts` → "accepts the same token twice".

What is _not_ bounded by 15 minutes, because it is re-read on every request: **org membership**
(removal takes effect immediately, on every device), **permissions**, and **row visibility**.

**One definition of "usable account".** `ACTIVE_USER` (`lib/authGuards.ts`) is `{ isActive: true,
isDeleted: false }` — put it in the `where`, or use `isUsableAccount(row)` where you already hold the
row (`login` reads the user _before_ checking the password so a disabled account can't be told apart
from a wrong one). Never spell the flags out inline: two flags means two chances to check only one,
which is exactly how `isDeleted` came to be checked in zero places while `isActive` was checked in two.

🔴 **Flipping `isActive → false` or `isDeleted → true` on a `User` must call `revokeUserSessions()`
in the same transaction.** `onDelete: Cascade` on `refresh_tokens.user_id` only fires on a _hard_
delete, and this codebase soft-deletes everywhere. Since nothing on the request path checks the
account, this is what makes deactivation take effect at all — at the user's next refresh.

🔴 **`refresh_tokens` rows are never deleted — ending a session stamps `revoked_at` + `revoked_reason`.**
The table is also the login report (`created_at` = real login time, `last_used_at`, `user_agent`), so
a delete destroys history. It therefore behaves like every soft-deleted table here: **a live-session
read must filter `revokedAt: null`**, or a logged-out session keeps working. `GET /auth/me/sessions`
returns the caller's own history. Nothing purges the table yet — decide a retention rule before it
grows.

**Tests:** suites run against the dev database **in parallel**, so a test that mutates a user it
merely _found_ will break whatever another suite is doing with that user at that moment. Create your
own fixtures and hard-delete them — see `middlewares/authenticate.test.ts`.

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

- **Never create or alter a table by hand.** Schema file → `npm run db:draft -- <name>` → edit the
  generated SQL → `npm run db:promote` → `npm run db:apply` → commit.
  `npm run db:check-drift` (exit 2 = drift) is the enforcement — run it in CI.
- 🔴 **`prisma db push` and `prisma migrate dev` are not used here — both delete data.** `db push`
  ignores `prisma/migrations` entirely and issues whatever DDL makes the live database match your
  schema files, so anything in the database but not in those files is something it removes; on
  2026-07-25 a push from a branch with stale files cost every organization its owner
  (`migrations/20260725140000_.../migration.sql:32`). `migrate dev` offers to **reset** whenever it
  sees drift, and this shared dev database drifts routinely. `npm run db:push` / `npm run db:migrate`
  are guards that explain this and exit 1. See `scripts/db-sync.ts`.
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

`refresh_tokens` stays on that exclusion list, but it is no longer ephemeral: since 2026-07-31 it
keeps its rows and carries its own lifecycle columns (`revoked_at`, `revoked_reason`, `last_used_at`,
`user_agent`) instead of the five audit columns. There is no acting user to record on a session — the
session _is_ the user's action — so `created_by`/`updated_by` would be noise, and `revoked_at` plays
the `is_deleted` role.

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
- **Placeholders say "Select", never "Pick" or "Choose"** — `Select a batch…`, `Select a customer…`,
  `Select a work centre…`. One verb across the whole app, matching `components/ui/Select.tsx`'s
  default of `Select…`. Applies to input placeholders and to the empty option of a dropdown; prose
  and headings are free to read however they read best.
- **A dropdown inside a `Modal` must be portalled to `document.body` and positioned `fixed`.** The
  dialog body is a scroll container and cards inside it set `overflow: hidden` for their rounded
  corners, so a `position: absolute` menu is clipped to the card — it opens _inside_ the section and
  most of it is unreachable. `issues/BatchPicker.tsx` is the worked example: measure the anchor in
  `useLayoutEffect`, re-measure on `resize` and on `scroll` **in the capture phase** (scroll does not
  bubble, so a `window` listener never hears the dialog body scrolling), flip upwards when the room
  below runs out, and keep the menu element mounted while closed so downshift's `getMenuProps` ref
  still tells an inside click from an outside one.
- 🔴 **Tab navigation is mandatory and must be perfect — a control you cannot reach with Tab is not
  done.** Native elements (`input`, `textarea`, `select`, `button`, `a[href]`) are focusable for free;
  a `<div onClick>` is **not**. Tab skips straight past it, so the control is unreachable by keyboard
  and neither `tsc -b` nor a screenshot says a word — it looks perfect and half the users can't use it.
  Because every form here is assembled from four shared controls, this is fixed **once per component,
  never per field**:
  - **Interactive means `<button type="button">`**, not a styled `div` — you get focus, Enter/Space,
    and `disabled` semantics for free. `components/ui/Select.tsx` is the template: button trigger with
    `onKeyDown`, real `<button>` options.
  - **Every custom dropdown/combobox** handles ↑↓ to move, Enter to select, Esc to close, and scrolls
    the active option into view.
  - **Every modal** takes focus on open, traps it while open, closes on Esc, and returns focus to the
    trigger on close. Without the trap, Tab walks out of the dialog and into the page behind it.
  - **DOM order _is_ tab order.** In a multi-column grid the two silently diverge and focus jumps
    around the form — nothing detects this, so keyboard-walk each form once. Never "fix" it with a
    positive `tabIndex`: any value `>0` hoists that element above the entire document order, and one
    stray `tabIndex={1}` breaks the whole page. Only `0` (reachable) and `-1` (focusable in code only).
  - **Visible focus ring on everything focusable** — `outline: none` without a replacement is the same
    bug, just harder to see.
  - **Every new page inherits this — it is not optional and not a follow-up.** A page is done when Tab
    walks it exactly the way it walks Vendors or Items: same order, same Enter to open/submit, same Esc
    to close. Build it out of the shared controls (`components/ui/Input`, `Select`, `ComboBox`,
    `ItemComboBox`, `Modal`); a page that hand-rolls its own control is precisely where the behaviour
    diverges from the rest of the app. Keyboard-walk the new page once before calling it finished.
  - **Keep it native first; reach for `downshift` only when the widget actually needs it.** Buttons,
    links, inputs, textareas and native `<select>` already do the right thing for free — wrapping them
    buys nothing and hides simple behaviour behind an abstraction. `downshift` earns its place only for
    a listbox/typeahead where ↑↓ movement, active-option scrolling, Esc, and open/close state would
    otherwise be hand-written: `Select.tsx` (`useSelect`), `ComboBox.tsx` / `ItemComboBox.tsx`
    (`useCombobox`). Anything simpler — a static list of two or three options, a toggle, a menu of
    plain buttons — stays lightweight and plain.

## Comments

Comment sparingly. The code already says _what_; a comment earns its place only by saying _why_ — a
non-obvious constraint, a trade-off, the bug it prevents. One short line, at the line that needs it.
No banner headers, no restating the next statement, no JSDoc on self-explanatory functions. Match the
file you are editing: if it has few comments, add few.

```ts
// filter here, not in RLS — memberships has no policy (read before a tenant exists)
const rows = await tx.membership.findMany({ where: { userId, isDeleted: false } });
```

## Commands

```bash
# backend/
npm run dev · typecheck · lint
# Schema changes — `scripts/db-sync.ts`. Nothing here can reset the database.
npm run db:status            # read-only: what is pending, what has drifted, what would destroy data
npm run db:draft -- <name>   # drift → prisma/drafts/<ts>_<name>.sql. Applies NOTHING.
                             # `migrate diff` renders a RENAME as drop+add, so the draft is a
                             # starting point to edit, not an answer. Destructive lines are
                             # annotated in the file.
npm run db:promote           # draft → prisma/migrations, once reviewed. THE gate: past here,
                             # plain `migrate deploy` applies it in CI and prod with no prompt.
                             # Refuses destructive SQL unless the file carries
                             # `-- @destructive-ok: <reason>`, which then lives in git.
npm run db:apply             # pg_dump → migrate deploy → generate → re-check drift
npm run db:backup            # pg_dump on demand → backend/backups (gitignored)

npm run db:deploy        # prisma migrate deploy — every other environment, never resets
npm run db:check-drift   # exit 0 = in sync, 2 = drift. Run in CI.
npx vitest run

# Deploy — a deploy must name BOTH its target and its service. Neither is ever defaulted:
# staging and production are DIFFERENT Zoho accounts, and this repo holds more than one AppSail.
npm run deploy:staging:api        # scripts/deploy.mjs — see docs/CATALYST_DEPLOYMENT_GUIDE.md §1.5b
npm run deploy:production:api     # `deploy:staging` / `deploy:production` alias the :api pair
npm run deploy:staging:accounts   # the identity service. NEVER DEPLOYED YET: accounts/.env.<target>
npm run deploy:production:accounts  # does not exist, so both stop at the env-file check
# 🔴 The logged-in Zoho account is machine-wide (%APPDATA%\zcatalyst-cli-nodejs\), NOT a repo file,
# so it is the one thing the repo cannot get right for you. deploy.mjs reads the CLI's login and
# refuses to run on a mismatch — never bypass it with a bare `catalyst deploy`, which skips that
# check plus the env/project cross-check and the `.env`-parking that keeps dev secrets out of the
# upload. `.catalystrc`, `catalyst.json` and `<service>/app-config.json` are GENERATED per deploy;
# the committed sources are deploy/services.json + deploy/targets.json +
# deploy/<target>.catalystrc.json + <service>/.env.<target>.
# 🔴 `catalyst deploy --only appsail` is RESOURCE targeting, not service targeting — it pushes every
# entry in catalyst.json. deploy.mjs generates that file with exactly ONE entry, which is the only
# thing keeping a deploy of one service from deploying all of them. Never commit catalyst.json.
# A service may be a different AppSail per target (deploy/targets.json → services.<name>.appsail);
# the deploy banner's `AppSail :` line is the authority on the resolved name.

# web/
npx tsc -b               # ⚠️ THE typecheck. `tsc --noEmit` checks ZERO files
                         # (tsconfig.json has "files": [] + project references), and
                         # Vite/rolldown strips types without checking them. Both "pass" on
                         # broken code.
```

## Docs

|                                                           |                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PRISMA.md` §8                                       | migrations, the RLS runbook, drift, why the DB was baselined                                                                                                                                                                                                                                                                 |
| `docs/ARCHITECTURE_AND_TECH_STACK.md`                     | every tech decision + rejected alternatives                                                                                                                                                                                                                                                                                  |
| `docs/DYNAMIC_CUSTOM_FIELDS_EXPLAINED.md`                 | per-org custom fields — concepts                                                                                                                                                                                                                                                                                             |
| `docs/DYNAMIC_CUSTOM_FIELDS_IMPLEMENTATION_PROMPT.md`     | …and the ordered build plan                                                                                                                                                                                                                                                                                                  |
| `docs/ROLES_AND_PERMISSIONS.md`                           | permission templates, `requirePermission`, the code catalog                                                                                                                                                                                                                                                                  |
| `docs/CACHING.md`                                         | L1/L2 layers, what must never be cached, the invalidation rules                                                                                                                                                                                                                                                              |
| `docs/AUTHENTICATION.md` · `CATALYST_DEPLOYMENT_GUIDE.md` | auth model · deploy                                                                                                                                                                                                                                                                                                          |
| **`docs/SSO_WALKTHROUGH.md`**                             | **start here for SSO** — one sign-in end to end: every request, redirect and row written, with payloads                                                                                                                                                                                                                      |
| `docs/SSO_AND_IDENTITY.md`                                | …and the design behind it. **live in production since 2026-08-31** — `accounts.octfis.com` is the issuer and `SSO_ENABLED=true` in `backend/.env` and `.env.production`, so local dev and production both sign in through it. Staging leaves the flag unset and is still password login. Its header table says what is built |
| **`docs/JOBWORK_CORE_WALKTHROUGH.md`**                    | **start here for jobwork** — every field's role, every table written, one worked example                                                                                                                                                                                                                                     |
| `docs/JOBWORK_DOMAIN_AND_MODULE_MAP.md`                   | …and the design reasoning behind it: §5 boundaries, §6 the rules                                                                                                                                                                                                                                                             |
