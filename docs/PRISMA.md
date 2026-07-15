# Prisma — from zero to advanced

> **Purpose.** Everything about how Prisma works in this repo: what each file is for, what each
> command does, and why the code is shaped the way it is. Written so someone who has never seen
> Prisma can start at §1 and read straight through. Later sections assume the earlier ones.
>
> **Version.** Prisma **7.8.0**. This matters more than usual — Prisma 7 changed three fundamentals
> (see §9), so most tutorials and Stack Overflow answers you find online are for Prisma 5/6 and will
> not work here.

_Last updated: 2026-07-15._

> **Before you read a `.prisma` file:** install the **Prisma** VS Code extension (`Prisma.prisma`).
> VS Code has no built-in language association for `.prisma`, so without it the whole file renders as
> flat, uncoloured plain text and is genuinely hard to read. It's in the repo's recommended extensions
> — reopen the workspace and accept the prompt. It also gives you formatting, autocomplete on
> attributes, and inline errors.

---

## 1. What Prisma is

Prisma is an **ORM** — an Object-Relational Mapper. It sits between your TypeScript code and
PostgreSQL, so you write this:

```ts
const user = await prisma.user.findUnique({ where: { email: 'jane@acme.com' } });
```

instead of this:

```ts
const result = await pool.query('SELECT * FROM users WHERE email = $1', ['jane@acme.com']);
const user = result.rows[0]; // type: any — you're on your own
```

The first version is **fully typed**. `user.name` autocompletes; `user.nmae` fails to compile;
`user.organizationId` fails to compile because that column doesn't exist. Prisma knows this because
it read your schema and _generated_ the types.

That generation step is the whole idea. Prisma is not a library you configure at runtime — it's a
**code generator**. You describe your tables once, and it writes a client tailored to exactly those
tables.

### What Prisma is not

It is not a database, and it is not a query builder that lets you write arbitrary SQL comfortably.
For genuinely complex reporting queries you drop to `$queryRaw` (§11) and accept that you leave the
type safety behind. Architecture §3.4 budgets for roughly 95% Prisma / 5% raw SQL.

---

## 2. The mental model: four artifacts

Almost every confusion about Prisma comes from not knowing which of these four things you're looking
at, and which direction information flows between them.

```
   ┌──────────────────┐   prisma migrate dev   ┌──────────────────┐
   │  schema files    │ ─────────────────────► │   PostgreSQL     │
   │ prisma/schema/   │ ◄───────────────────── │   (real tables)  │
   └──────────────────┘     prisma db pull     └──────────────────┘
            │
            │ prisma generate
            ▼
   ┌──────────────────┐    import { PrismaClient }   ┌──────────────────┐
   │ generated client │ ──────────────────────────►  │  your TS code    │
   │ generated/prisma │                              │  src/**/*.ts     │
   └──────────────────┘                              └──────────────────┘
```

1. **The schema** (`prisma/schema/*.prisma`) — your description of the tables. Hand-written. The
   source of truth.
2. **The database** — the real Postgres tables. Changed _by migrations_, generated _from_ the schema.
3. **The generated client** (`backend/generated/prisma/`) — TypeScript that Prisma writes for you,
   derived from the schema. Never hand-edited, never committed.
4. **Your code** (`backend/src/`) — imports the generated client and queries.

Two commands move information between them:

| Command              | Direction         | Meaning                                         |
| -------------------- | ----------------- | ----------------------------------------------- |
| `prisma migrate dev` | schema → database | "Make the database match my schema."            |
| `prisma db pull`     | database → schema | "Make my schema match the database."            |
| `prisma generate`    | schema → client   | "Rewrite the TypeScript client from my schema." |

`prisma generate` touches the database not at all. It's pure codegen and safe to run any time — which
is why `npm run build` runs it before `tsc`.

---

## 3. Every Prisma file in this repo

| Path                                      | Hand-written? | Committed? | What it is                                           |
| ----------------------------------------- | ------------- | ---------- | ---------------------------------------------------- |
| `backend/prisma.config.ts`                | ✅ yes        | ✅ yes     | CLI config: where the schema lives, the database URL |
| `backend/prisma/schema/schema.prisma`     | ✅ yes        | ✅ yes     | Generator + datasource **config only** — no models   |
| `backend/prisma/schema/tenant.prisma`     | ✅ yes        | ✅ yes     | The `User` model (one file per business domain)      |
| `backend/prisma/migrations/`              | ⚠️ generated  | ✅ yes     | SQL migration history — **does not exist yet** (§8)  |
| `backend/generated/prisma/**`             | ❌ generated  | ❌ ignored | The typed client Prisma writes for you               |
| `backend/src/db/prisma.ts`                | ✅ yes        | ✅ yes     | Constructs the one shared `PrismaClient` instance    |
| `backend/certs/rds-ap-south-1-bundle.pem` | ❌ downloaded | ✅ yes     | TLS CA for RDS; public, holds no secret (§10)        |
| `backend/.env`                            | ✅ yes        | ❌ ignored | `DATABASE_URL` and the CA path                       |

Plus three places that exist purely to keep the generated folder out of your way:

- `backend/.gitignore` → `/generated/prisma`
- `backend/eslint.config.js` → `globalIgnores(['dist', 'generated'])`
- `.prettierignore` (repo root) → `backend/generated`

Never edit anything under `generated/`. The next `prisma generate` overwrites it. Prisma even stamps
each file with `/* !!! This is code generated by Prisma. Do not edit directly. !!! */`.

---

## 4. The hand-written files, one by one

### 4.1 `prisma.config.ts` — where the CLI looks

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
```

This file is **new in Prisma 7**. It configures the `prisma` _command-line tool_ — not your running
application.

- `schema: 'prisma/schema'` points at a **folder**, not a file. That's what lets us split ~150 tables
  across domain files instead of one enormous `schema.prisma` (architecture §3.4).
- `datasource.url` is where the connection string now lives. In Prisma 5/6 it went inside
  `schema.prisma` as `url = env("DATABASE_URL")`. If you see that in a tutorial, it's outdated.
- `import 'dotenv/config'` is required. Prisma no longer reads `.env` on its own.

### 4.2 `prisma/schema/schema.prisma` — config, no models

```prisma
generator client {
  provider = "prisma-client"
  output   = "../../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

Two blocks, and it will never grow beyond them.

**`generator client`** says "when I run `prisma generate`, write a TypeScript client here."
`provider = "prisma-client"` is the Prisma 7 generator; the old name was `prisma-client-js`. `output`
is mandatory now (it used to default to `node_modules/.prisma/client`), and it's **relative to this
schema file** — so `../../generated/prisma` resolves to `backend/generated/prisma`.

**`datasource db`** declares the database _kind_. Note there's no `url` here; it moved to
`prisma.config.ts`.

### 4.3 `prisma/schema/tenant.prisma` — the models

One file per domain, merged by Prisma at build time. Relations across files work normally. Today it
holds one model:

```prisma
model User {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email        String   @unique @db.Citext
  passwordHash String?  @map("password_hash")
  name         String   @db.VarChar(80)
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("users")
}
```

Read it left to right. `passwordHash` is the **TypeScript** name; `String?` is its type (the `?` means
nullable); everything after is an **attribute** modifying it.

| Attribute                | Scope | Meaning                                                   |
| ------------------------ | ----- | --------------------------------------------------------- |
| `@id`                    | field | Primary key                                               |
| `@unique`                | field | Unique constraint (and therefore a unique index)          |
| `@default(...)`          | field | Default value                                             |
| `@map("password_hash")`  | field | The **column** name in Postgres (§6)                      |
| `@@map("users")`         | model | The **table** name in Postgres                            |
| `@db.Uuid`, `@db.Citext` | field | The exact Postgres type to use                            |
| `@updatedAt`             | field | Prisma sets this to `now()` on every update, from the app |

Single `//` is a comment for humans. Triple `///` is a doc comment that Prisma carries into the
generated types, so it shows up in your editor's tooltips. Use `///` for anything a caller should
know.

Three subtleties in the model above worth understanding:

**`@default(dbgenerated("gen_random_uuid()"))`** means _the database_ generates the id. Prisma omits
the column from the `INSERT` and lets Postgres fill it. The alternative, `@default(uuid(7))`, makes
_Node_ generate the id before sending the insert. We use `dbgenerated` because the `users` table was
created by hand with that column default, and the schema must describe reality.

**`@db.Citext`** maps to the `citext` extension type — case-insensitive comparison. It's what makes
`UNIQUE` reject `Jane@x.com` when `jane@x.com` exists. Without this annotation Prisma would model the
column as plain `TEXT`, and the next migration would generate an `ALTER TABLE … TYPE TEXT` that
silently destroys that guarantee.

**`@updatedAt` is applied by Prisma, not Postgres.** The `@default(now())` only fires on insert. If a
row is ever updated by raw SQL, psql, or pgAdmin, `updated_at` will not change. If you want a
database-level guarantee, you need a trigger.

### 4.4 `src/db/prisma.ts` — the client your code uses

This is the only place a `PrismaClient` is constructed. Everything else imports the `prisma` it
exports. Constructing a second one would open a second connection pool.

```ts
const adapter = new PrismaPg({
  connectionString: toPoolConnectionString(env.databaseUrl),
  ssl: resolveSsl(),
  max: 5,
});

export const prisma = new PrismaClient({ adapter, log: /* … */ });
```

`max: 5` caps the connection pool **per process**. AppSail runs many short-lived instances of this
app (architecture §6); if each grabs 20 connections, a managed Postgres runs out. The two helper
functions (`resolveSsl`, `toPoolConnectionString`) exist for RDS-specific TLS reasons covered in §10.

---

## 5. The generated client

After `prisma generate`, `backend/generated/prisma/` contains:

| File                                               | What's in it                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `client.ts`                                        | Exports `PrismaClient`, the `Prisma` namespace, and model types   |
| `models/User.ts`                                   | Every type derived from the `User` model — args, results, selects |
| `models.ts`                                        | Barrel re-exporting all model types                               |
| `enums.ts`                                         | Types for schema enums (currently empty — we have none)           |
| `commonInputTypes.ts`                              | Shared filter types (`StringFilter`, `DateTimeFilter`, …)         |
| `internal/class.ts`                                | The client implementation + your schema embedded as a string      |
| `internal/prismaNamespace.ts`                      | Error classes, options types, `PrismaClientKnownRequestError`     |
| `browser.ts`, `internal/prismaNamespaceBrowser.ts` | Browser build; unused here                                        |

Two things you import from it in practice, both from `client.ts`:

```ts
import { PrismaClient } from '../../generated/prisma/client.ts'; // in src/db/prisma.ts
import { Prisma } from '../../../generated/prisma/client.ts'; // in auth.service.ts, for error types
```

Note the paths are **relative and include `.ts`**. Prisma 7 emits TypeScript _source_, not a compiled
package in `node_modules`. That's why `tsconfig.json` sets `allowImportingTsExtensions` and
`rewriteRelativeImportExtensions`.

**You must re-run `prisma generate` after every schema change**, or your types describe the old
schema and TypeScript will confidently lie to you. `npm run build` does it automatically. In watch
mode you must do it yourself: `npm run db:generate`.

Because it's ignored by git, a fresh clone has no `generated/` folder and `npm run typecheck` will
fail with "cannot find module" until someone runs `npm run db:generate`. That's expected.

---

## 6. camelCase in code, snake_case in the database

Our convention: Postgres columns are `snake_case`, TypeScript is `camelCase`. `@map` and `@@map`
bridge them.

```prisma
passwordHash String? @map("password_hash")
```

```ts
await prisma.user.findUnique({ select: { passwordHash: true } });
// Prisma sends:  SELECT "password_hash" FROM "users" …
// You receive:   { passwordHash: '$argon2id$…' }
```

The substitution happens when Prisma **builds the SQL string**, not per-row at runtime. It costs
nothing. Fields whose names are identical in both conventions (`id`, `email`, `name`) need no `@map`.

Why not just name the columns `camelCase` and skip this? Because unquoted identifiers in Postgres fold
to lowercase, so `passwordHash` silently becomes `passwordhash` unless _every_ reference to it — in
every raw query, psql session, and RLS policy — is double-quoted forever.

**Where this leaks:** `$queryRaw` bypasses the mapping entirely. You write `password_hash` in the SQL
and get `password_hash` back as the object key. A raw query's result is _not_ a Prisma model type;
give it its own interface.

---

## 7. Querying: what the code actually does

All examples are from `src/modules/auth/auth.service.ts`.

### Reading one row

```ts
const user = await prisma.user.findUnique({
  where: { email: input.email },
  select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
});
```

`findUnique` only accepts fields that are `@id` or `@unique` — the type system enforces it. It returns
`User | null`.

**`select` is not optional style — it's a security control.** Without it, Prisma returns _every_
column, including `passwordHash`. Then someone writes `res.json(user)` and you've leaked password
hashes to the browser. Our service defines the safe set once:

```ts
const publicUserSelect = { id: true, name: true, email: true } as const;
```

and only `login` opts into `passwordHash`. The return type narrows to exactly what you selected, so
TypeScript stops you from reading a field you didn't ask for.

### Creating a row, and losing the race

```ts
try {
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash },
    select: publicUserSelect,
  });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw ApiError.conflict('An account with that email already exists.');
  }
  throw error;
}
```

Checking `findUnique` first and _then_ creating would still be wrong. Two concurrent signups for the
same email both see "available", both proceed, and one loses at the unique index. The constraint is
the only real guard, so the correct pattern is to attempt the write and catch its violation.

`P2002` is Prisma's code for a unique-constraint violation. The codes you'll meet most:

| Code    | Meaning                                               |
| ------- | ----------------------------------------------------- |
| `P2002` | Unique constraint failed                              |
| `P2003` | Foreign key constraint failed                         |
| `P2025` | Record not found (`update`/`delete` on a missing row) |
| `P1001` | Can't reach the database server                       |
| `P1000` | Authentication failed                                 |

Only `PrismaClientKnownRequestError` has a `.code`. Validation problems throw
`PrismaClientValidationError`, which does not — never assume `.code` exists.

---

## 8. Migrations

**We have no migrations yet.** The `users` table was created by hand in pgAdmin, so
`prisma/migrations/` doesn't exist and Postgres has no `_prisma_migrations` bookkeeping table. This is
a temporary state and needs resolving before a second developer or a second environment appears.

### How migrations normally work

```bash
# 1. edit prisma/schema/tenant.prisma
# 2.
npm run db:migrate -- --name add_last_login_at
```

Prisma diffs your schema against the database, writes
`prisma/migrations/<timestamp>_add_last_login_at/migration.sql`, applies it, records it in
`_prisma_migrations`, and re-runs `generate`. You **commit** that SQL file. On staging and production
you run `prisma migrate deploy`, which applies pending migrations and never prompts.

`migrate dev` is for your laptop only. It is allowed to reset the database. `migrate deploy` is for
every other environment.

### Adopting the existing table

Since the database is ahead of the schema, run introspection rather than a migration:

```bash
npm run db:pull      # rewrites the schema from the real tables
npm run db:generate
```

Be aware `db:pull` **overwrites** your schema files and does not preserve `@map` camelCasing or your
`///` doc comments — it names fields exactly as the columns are named. For a repo already committed to
camelCase fields, the usual fix is the community tool `prisma-case-format`, run right after the pull.

To then create a baseline so Prisma believes the current tables are "already migrated", see Prisma's
baselining guide: generate the initial migration with `--create-only`, then mark it applied with
`prisma migrate resolve --applied <name>`.

### The `--create-only` escape hatch

Two things in our design cannot be expressed in the Prisma schema at all: the `citext` extension, and
the Row-Level Security policies from architecture §3.10. For those, generate the migration, hand-edit
the SQL, then apply:

```bash
npx prisma migrate dev --create-only --name enable_citext
# paste `CREATE EXTENSION IF NOT EXISTS citext;` into the generated migration.sql
npx prisma migrate dev
```

"Never hand-edit migrations" means never edit one that has **already been applied**. Editing before
applying is the sanctioned path for raw SQL.

---

## 9. What Prisma 7 changed (and why old answers mislead you)

|                | Prisma ≤ 6                                       | Prisma 7 (this repo)                                |
| -------------- | ------------------------------------------------ | --------------------------------------------------- |
| Connection URL | `url = env("DATABASE_URL")` in `schema.prisma`   | `datasource.url` in `prisma.config.ts`              |
| Generator      | `provider = "prisma-client-js"`, output optional | `provider = "prisma-client"`, `output` **required** |
| Client output  | inside `node_modules/.prisma/client`             | a real folder you own (`generated/prisma`)          |
| Import         | `from '@prisma/client'`                          | `from '../../generated/prisma/client.ts'`           |
| Connecting     | connection string alone                          | **driver adapter required**                         |
| `.env` loading | automatic                                        | `import 'dotenv/config'` in `prisma.config.ts`      |

The last one is the biggest. `new PrismaClient()` with only a URL **does not work** in Prisma 7. You
must pass an adapter:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString, ssl, max: 5 });
export const prisma = new PrismaClient({ adapter });
```

The adapter wraps a real `pg.Pool`, which is a genuine upgrade: pool sizing, TLS, and timeouts are now
plain node-postgres options rather than Prisma-specific query-string parameters.

---

## 10. Gotchas we hit, in this repo, for real

These are not hypothetical. Each cost time and is now defended against in the code.

**`prisma.$connect()` does not connect.** With a driver adapter, Prisma hands off to a lazy `pg.Pool`
that opens no socket until a query runs. Our server booted "successfully" against a database with the
wrong password. `src/server.ts` now issues an actual round-trip:

```ts
await prisma.$queryRaw`SELECT 1`;
```

**`sslmode=require` means different things in psql and node-postgres.** psql encrypts without
validating the certificate. node-postgres validates, and Node doesn't trust Amazon's root CA — so RDS
fails with `self-signed certificate in certificate chain`. The fix is to supply the CA
(`backend/certs/`), **not** `rejectUnauthorized: false`, which leaves the connection encrypted but
unauthenticated and therefore impersonable.

**`pg` discards your `ssl` object when the URL contains `sslmode`.** Passing `ssl: { ca }` alongside
`?sslmode=require` silently drops the `ca`. Verified by testing all three combinations. So
`DATABASE_URL` keeps `sslmode=require` — the form RDS gives you, psql expects, and the Prisma CLI needs
— and `toPoolConnectionString()` in `src/db/prisma.ts` strips the parameter for the pool only.

**`citext` folds case but does not trim.** `' jane@x.com'` and `'jane@x.com'` are still two distinct
values and both will insert. Normalization is the Zod schema's job (`.trim()`), on both the server and
the client.

---

## 11. Advanced

### Transactions

Two forms. The sequential array runs the operations in one transaction:

```ts
const [org, membership] = await prisma.$transaction([
  prisma.organization.create({ data: { name } }),
  prisma.membership.create({ data: { userId, organizationId, isOwner: true } }),
]);
```

The interactive form takes a callback, and is what you need whenever a later write depends on an
earlier read. It's how the outbox pattern (architecture §3.11) stays atomic:

```ts
await prisma.$transaction(async (tx) => {
  const job = await tx.job.update({ where: { id }, data: { status: 'DONE' } });
  await tx.eventOutbox.create({ data: { type: 'job.completed', payload: job } });
});
```

Use `tx`, never `prisma`, inside the callback — a query on `prisma` opens a _separate_ connection
outside the transaction, which is a bug that only shows up on rollback.

### Raw SQL

```ts
const rows = await prisma.$queryRaw<{ product_id: string; total: bigint }[]>`
  SELECT product_id, SUM(quantity) AS total
  FROM stock_movements
  WHERE created_at > ${since}
  GROUP BY product_id
`;
```

The template tag parameterizes `${since}` — it is **not** string interpolation, and it is safe. Its
unsafe sibling `$queryRawUnsafe` concatenates, and is how you get SQL injection.

Three things to remember: column names come back as written (`product_id`, not `productId`, §6);
`SUM()` returns `bigint`, which `JSON.stringify` throws on; and `@map` does not apply, so you write
the real table and column names.

### Row-Level Security (not yet built)

Architecture §3.10 requires every tenant-scoped query to run inside a transaction that sets
`SET LOCAL app.current_tenant`. That will live in `src/db/prisma.ts` as `runAsTenant()`. Two notes
recorded now so they aren't rediscovered later:

- `users` is the one table that gets **no** tenant RLS policy. It can't have one — a user row exists
  before any organization does. Access to user data is mediated through `memberships`, which _is_
  tenant-scoped.
- The app's database role must be a **non-owner**. Table owners bypass RLS, so a policy applied while
  connected as `postgres` protects nothing.

### Connection pooling

`max: 5` is per Node process. AppSail scales to many processes, so the real ceiling is
`max × instances`. If that approaches your RDS `max_connections`, put a pooler (PgBouncer, RDS Proxy)
in front rather than raising `max`.

### Prisma Studio

`npm run db:studio` opens a browser GUI over the database. Useful for inspecting rows during
development. It connects with `DATABASE_URL` — so it connects to **RDS**, not a local copy. Deleting
rows there deletes them for everyone on the dev database.

---

## 12. Command reference

Run from `backend/`.

| Command                     | What it does                                     | Touches the DB? |
| --------------------------- | ------------------------------------------------ | --------------- |
| `npm run db:generate`       | Rewrite `generated/prisma` from the schema       | No              |
| `npm run db:migrate`        | Diff schema → write + apply migration → generate | **Yes, writes** |
| `npm run db:pull`           | Overwrite schema files from the real tables      | Reads           |
| `npm run db:studio`         | Browser GUI over the data                        | Reads/writes    |
| `npm run dev`               | Start the API with hot reload                    | Reads/writes    |
| `npm run build`             | `prisma generate && tsc`                         | No              |
| `npx prisma validate`       | Check the schema parses                          | No              |
| `npx prisma format`         | Format the `.prisma` files                       | No              |
| `npx prisma migrate deploy` | Apply pending migrations (staging/prod)          | **Yes, writes** |

---

## 13. Troubleshooting

| Symptom                                                 | Cause / fix                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Cannot find module '../../generated/prisma/client.ts'` | Fresh clone — `generated/` is git-ignored. Run `npm run db:generate`                                       |
| Types don't match a field you just added                | You edited the schema but didn't re-run `generate`                                                         |
| `PrismaClientInitializationError: adapter required`     | Prisma 7 needs a driver adapter — see §9                                                                   |
| `self-signed certificate in certificate chain`          | Missing or ignored RDS CA — see §10                                                                        |
| Server starts, first request fails with auth error      | `$connect()` is lazy — check with `$queryRaw` at boot (§10)                                                |
| `Do not know how to serialize a BigInt`                 | A raw `SUM()`/`COUNT()` result — cast in SQL or convert before `res.json`                                  |
| `prisma generate` says "schema not found"               | `prisma.config.ts` points at `prisma/schema` (a folder) — don't recreate `schema.prisma` at `prisma/` root |
| Unique email check passes but insert 500s               | Racing signups. Catch `P2002` instead of pre-checking (§7)                                                 |
| `migrate dev` offers to reset the database              | Prisma has no migration history for tables that already exist — baseline instead (§8)                      |

---

## 14. Where things go next

| Coming                                     | Schema file          | Notes                                                                          |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------ |
| `Organization`, `Membership`, `Invitation` | `tenant.prisma`      | `Membership` carries `isOwner`, `roleId`, `permissionProfileId` — never `User` |
| `RefreshToken`, `ApiKey`                   | `auth.prisma`        | Unblocks logout + token rotation (architecture §3.8)                           |
| `Role`, `Permission`, `PermissionProfile`  | `authz.prisma`       | Architecture §3.9                                                              |
| RLS policies                               | `prisma/rls.sql`     | Applied via a `--create-only` migration (§8)                                   |
| First real migration                       | `prisma/migrations/` | Baseline the hand-created `users` table first                                  |

---

## 15. Learning: reading a model line in plain language

> This section is for someone still getting comfortable with `.prisma` syntax. §4.3 lists the
> attributes tersely; here we slow down and explain _how to decide what to use where_. All examples
> come from `tenant.prisma` (`User`, `RefreshToken`, `PasswordResetToken`).

### 15.1 A field has three parts

Read every model line left to right — it's always the same shape:

```prisma
name  String  @db.VarChar(80)
 │       │            │
 │       │            └── attributes:  extra rules (0 or more, order doesn't matter)
 │       └────────────── type:        how your TypeScript code sees the value
 └────────────────────── field name:  what you call it in code
```

- **Field name** — always a plain name. Never put anything on it (see 15.5).
- **Type** — one of Prisma's generic types: `String`, `Int`, `Boolean`, `DateTime`, `Float`,
  `BigInt`, `Decimal`, `Json`, `Bytes` — **or the name of another model** (that makes it a relation,
  see 15.4). A trailing `?` means nullable; a trailing `[]` means a list.
- **Attributes** — the `@...` parts. They add rules like "this is the primary key" or "store it as
  this exact Postgres type".

### 15.2 Two layers of type: Prisma type vs database type

This trips up everyone at first. There are **two** type systems, and a field can name both:

```prisma
name  String  @db.VarChar(80)
      ───┬──   ──────┬───────
   Prisma type    database column type
 (how your JS      (how Postgres
  code sees it)     stores it)
```

- **`String`** = the **Prisma type**. It only tells your TypeScript code "this is a JS string". It is
  database-agnostic — it means the same thing on Postgres, MySQL, or SQLite.
- **`@db.VarChar(80)`** = the **actual Postgres column type**. `VarChar`, `Citext`, `Uuid`,
  `Timestamptz` are real SQL types — they are **not** Prisma types and can never stand alone.

You always need the Prisma type. The `@db.*` part is **optional**.

**If you omit `@db.*`, the column still gets a type — Prisma picks a default.** Nothing is ever
untyped. That's why `passwordHash String? @map("password_hash")` has no `@db.*`: Prisma's default for
`String` on Postgres is `text`, and `text` (unlimited length, exact comparison) is exactly right for
a password hash. Writing `@db.Text` would just repeat the default.

Defaults Prisma uses on Postgres when you leave `@db.*` off:

| Prisma type | Default column type | Common override with `@db.*`               |
| ----------- | ------------------- | ------------------------------------------ |
| `String`    | `text`              | `@db.VarChar(n)`, `@db.Citext`, `@db.Uuid` |
| `Int`       | `integer`           | `@db.SmallInt`                             |
| `DateTime`  | `timestamp`         | `@db.Timestamptz(6)`, `@db.Date`           |
| `Boolean`   | `boolean`           | —                                          |

So all three of these are `String` in your code but **three different columns** in Postgres:

```prisma
passwordHash String? @map("password_hash")  // → text        (default)
name         String  @db.VarChar(80)         // → varchar(80) (capped length)
email        String  @db.Citext              // → citext      (case-insensitive)
```

Rule of thumb: **add `@db.*` only when the default isn't what you want** — a length cap
(`VarChar(80)`), case-insensitivity (`Citext`), a UUID column (`Uuid`), or a timezone-aware timestamp
(`Timestamptz`).

### 15.3 `@` vs `@@` — field rules vs table rules

- A **single `@`** attaches to **one field** and sits on that field's line.
- A **double `@@`** attaches to **the whole model** and sits on its own line inside the model.

| Attribute          | `@` or `@@` | What it does                                                             |
| ------------------ | ----------- | ------------------------------------------------------------------------ |
| `@id`              | field       | Marks the **primary key** (each model needs one identity)                |
| `@unique`          | field       | No two rows may share this value (emails, tokens)                        |
| `@default(...)`    | field       | Value used when you don't supply one — `now()`, `true`, a generated UUID |
| `@updatedAt`       | field       | Prisma auto-sets it to "now" on **every update**                         |
| `@map("col_name")` | field       | The real **column** name in Postgres (code stays camelCase — §6)         |
| `@db.*`            | field       | The exact Postgres **column type** (15.2)                                |
| `@relation(...)`   | field       | Defines how a relation links (15.4)                                      |
| `@@map("table")`   | model       | The real **table** name in Postgres                                      |
| `@@index([field])` | model       | A non-unique index to speed up lookups by that column                    |
| `@@id([a, b])`     | model       | Composite primary key (key made of two+ columns)                         |
| `@@unique([a, b])` | model       | Composite unique constraint                                              |

`PasswordResetToken` shows a model-level index — the app looks rows up **by email**, so:

```prisma
@@index([email])   // faster WHERE email = ...
@@map("password_reset_tokens")
```

**How to decide what to use:**

1. Primary key? → `@id` (for UUIDs, usually with `@default(dbgenerated("gen_random_uuid()"))`).
2. Must be unique? → `@unique` (one field) or `@@unique([...])` (a combination).
3. Should the DB fill it in? → `@default(now())` (created time), `@updatedAt` (modified time),
   `@default(dbgenerated(...))` (generated id), or `@default(true)`/`@default("...")` (a constant).
4. Code name ≠ column name? → `@map("snake_case")`. Table name differs? → `@@map`.
5. Need a specific storage type? → `@db.*` (see the table in 15.2).
6. Type points to another model? → it's a relation (15.4).
7. Looked up/sorted by this column a lot (and it's not already `@id`/`@unique`)? → `@@index`.

Note: `@id`, `@unique`, `@default`, `@relation`, `@@index` change **behaviour/constraints**, while
`@map` and `@db.*` only change **names and storage** — they never affect logic.

### 15.4 Relations: why `refreshTokens` is not a column

Look at the two sides of the User ↔ RefreshToken relationship:

```prisma
model User {
  // ...
  refreshTokens RefreshToken[]                 // (A) the "many" side
}

model RefreshToken {
  userId String @map("user_id") @db.Uuid       // (B) the real foreign-key column
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)  // (C)
}
```

**How Prisma knows `refreshTokens` isn't a column:** its type is `RefreshToken` — the **name of
another model**, not a scalar like `String`. Any field whose type is a model is a **relation**, never
a stored column. The `[]` makes it "many".

A one-to-many link is physically stored in **one place only**: a foreign-key column on the "many"
side. Here that's `RefreshToken.userId` (line B) — a normal `String`/`Uuid` column. So:

- **(B) `userId`** — a scalar → a real column (`user_id`) holding the foreign key.
- **(C) `user User @relation(...)`** — the side that **owns** the link. `@relation` says: the local
  FK column is `userId`, it points at `User.id`, and `onDelete: Cascade` means "if the user is
  deleted, delete their tokens too." Only this side needs `@relation`.
- **(A) `refreshTokens RefreshToken[]`** — the **virtual back-reference**. Nothing is stored for it in
  the `users` table. It exists only so you can navigate from a user to their tokens in queries.

**Using the virtual back-reference** — even though there's no column, you can read it like a property
and Prisma runs the lookup for you:

```ts
// Load a user together with their tokens
const user = await prisma.user.findUnique({
  where: { email: input.email },
  include: { refreshTokens: true }, // → user.refreshTokens is an array of RefreshToken rows
});

// Filter users BY their tokens (only possible because the relation is declared)
await prisma.user.findMany({
  where: { refreshTokens: { some: { expiresAt: { gt: new Date() } } } },
});

// Go the other way, from a token to its owner (the FK side)
const token = await prisma.refreshToken.findUnique({
  where: { token: raw },
  include: { user: true }, // → token.user is the User row
});
```

Which side gets `@relation`? The one holding the foreign key (the "belongs to" side). The other side
just lists the model — with `[]` for many, no `@relation` needed.

### 15.5 Syntax rules that surprise people

**Attribute order doesn't matter.** These are identical:

```prisma
email String? @unique @db.Citext
email String? @db.Citext @unique   // same thing
```

Prisma treats attributes as a set. (A common _style_ is `@id`/`@unique` first, then `@default`, then
`@map`, then `@db.*` — but it's only convention.)

**`?` and `[]` belong on the type, never the field name.** They are type modifiers — they describe
the shape of the value:

```prisma
bio   String?   // ✅ optional (nullable) string
tags  String[]  // ✅ list of strings
bio?  String    // ❌ syntax error — never put ? on the name
```

**Don't confuse "reorder attributes" with "drop the `?`".** Removing `?` changes the column from
`NULL`-allowed (optional) to `NOT NULL` (required) — a real behaviour change, not a cosmetic one.
Keep the `?` if the field should stay optional.

### 15.6 See the real SQL for yourself

To prove any of the above — including which default column type Prisma chose — generate the
`CREATE TABLE` statements without touching the database:

```bash
cd backend
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema --script
```

You'll see `password_hash text`, `name varchar(80)`, `email citext`, and the `user_id` foreign key —
confirming that every field has a real column type even when you never wrote one.

---

## 16. Related docs

- `docs/ARCHITECTURE_AND_TECH_STACK.md` — §3.4 (why Prisma), §3.10 (multi-tenancy + RLS), §4 (folder
  structure), §6 (serverless constraints).
- `docs/CODE_QUALITY_AND_FORMATTING.md` — why `generated/` is excluded from ESLint and Prettier.
- Prisma docs: <https://www.prisma.io/docs> — check the version selector; default is often not 7.
