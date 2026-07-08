# Architecture & Technology Stack — Decision Document

**Project:** Production Monitoring & Inventory Management (multi-tenant SaaS)
**Hosting target:** Zoho Catalyst (AppSail)
**Audience:** Engineering, Product Management, Tech Lead, HOD
**Status:** Proposed / For approval
**Last updated:** 2026-07-06

---

## 1. Executive summary

We are building a **multi-tenant SaaS platform** (one product, many customer companies) covering
production monitoring, inventory management, invoicing, and third-party integrations (Zoho Books,
outbound/inbound webhooks). Estimated scale: **~150 database tables** across ~10 business domains.

The recommended architecture is a **modular monolith** built on **Node.js + Express + TypeScript**,
backed by **PostgreSQL (via Prisma)**, deployed as a **containerized app on Zoho Catalyst AppSail**,
with a **React + Vite** front end hosted on Catalyst Web Client Hosting.

This document records **every technology choice, the alternatives considered, and the pros and cons**,
so the decision is auditable and defensible.

---

## 2. Guiding principles

1. **Correctness over cleverness.** The core of the product is inventory accuracy and invoicing.
   Data integrity (transactions, ACID) is non-negotiable.
2. **Use what the team knows.** The team is productive in Express (not Fastify). We optimize for
   delivery speed and maintainability, not novelty.
3. **Avoid lock-in on the data layer.** The database and ORM must remain portable so hosting
   decisions never become one-way doors.
4. **Design for multi-tenancy from day one.** A cross-tenant data leak is an existential risk for a
   product sold to multiple businesses. It cannot be retrofitted safely.
5. **Match the code to the runtime.** The host (AppSail) is serverless; the app must be stateless.

---

## 3. Technology stack — decisions with pros & cons

### 3.1 Language: TypeScript ✅

| Pros | Cons |
| --- | --- |
| Compile-time safety across a 150-table codebase | Small build step (`tsc` / `tsx`) |
| Prisma generates fully-typed queries — autocomplete on every column | Slight learning curve vs plain JS |
| Zod infers types from validation schemas (no drift) | — |
| Safe refactoring as the codebase grows | — |

**Decision:** TypeScript everywhere (backend + frontend). For a product we intend to sell and maintain
for years, shipping plain JavaScript would be a false economy.

---

### 3.2 Backend framework: Express ✅ (over Fastify / NestJS)

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Express** | Team already knows it; huge ecosystem; simple; AppSail-supported | Less built-in structure; manual typing of `req.user` | **Chosen** |
| Fastify | Faster, schema validation built in | Team has no experience — slows delivery | Rejected (skills) |
| NestJS | Batteries-included structure | Heavy, opinionated, steeper curve | Rejected (overkill now) |

**Decision:** **Express + TypeScript.** Team familiarity outweighs Fastify's marginal performance
edge. Structure is imposed by our own conventions (Section 4), not the framework.

---

### 3.3 Architecture style: Modular Monolith ✅ (over Microservices)

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Modular monolith** | One deployable; simple ops; fast to build; clear domain modules; can split later | Requires discipline to keep modules decoupled | **Chosen** |
| Microservices | Independent scaling/deploys | Massive ops overhead; distributed transactions; premature for launch | Rejected (too early) |

**Decision:** **Modular monolith.** 150 tables is large, but it's still *one product*. Microservices now
would multiply operational cost for no benefit. The module boundaries (Section 4) are drawn so any
domain can be extracted into its own service **later** if it ever needs independent scaling.

**Governing rule:** modules communicate through **service functions**, never by reading another
module's tables directly. This is what preserves the future option to split.

---

### 3.4 ORM: Prisma ✅ (over Sequelize / raw SQL / Drizzle)

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Prisma** | Excellent TS types; migrations; readable schema; multi-file schema; raw-SQL escape hatch | Weaker at very complex aggregations (use `$queryRaw`) | **Chosen** |
| Sequelize | Mature | Poor TypeScript story; boilerplate | Rejected (bad TS fit) |
| Raw SQL only | Max control/perf | No type safety, no migrations, no tenant guardrails; unmaintainable at 150 tables | Rejected |
| Drizzle | TS-first, close to SQL | New to team; less mature tooling | Backup option |

**Decision:** **Prisma for ~95% of queries + `prisma.$queryRaw` for the few heavy reports.**
Best balance of safety, speed, and maintainability. Raw-SQL-only is unmaintainable at this scale;
Sequelize's TypeScript experience is poor for a greenfield project.

**Schema organization:** at ~150 tables, a single `schema.prisma` is unwieldy. Use Prisma's
**multi-file schema folder**, split by domain:

```
prisma/schema/
  schema.prisma        # generator + datasource only
  tenant.prisma        catalog.prisma      inventory.prisma
  machines.prisma      jobs.prisma         production.prisma
  billing.prisma       integrations.prisma webhooks.prisma      audit.prisma
```

Prisma merges these at build time; cross-file relations work normally.

---

### 3.5 Database: PostgreSQL ✅

See the companion document **`DATABASE_DECISION.md`** for the full analysis (including why we reject
Zoho's ZCQL/Data Store). Summary: Postgres gives us **ACID transactions, unlimited joins, Row-Level
Security, and portability** — all mandatory for inventory + invoicing.

---

### 3.6 Validation: Zod ✅ (over Joi)

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Zod** | Validation **and** inferred TS types from one schema; no drift | — | **Chosen** |
| Joi | Mature | Does not infer TS types — validation and types drift apart | Rejected |

**Decision:** **Zod.** In a TypeScript codebase, one schema producing both runtime validation and the
static type is a decisive advantage over Joi.

---

### 3.7 API documentation: OpenAPI generated from Zod ✅

**Decision:** Generate the OpenAPI/Swagger spec from Zod schemas rather than hand-writing Swagger.
Hand-maintained docs drift from reality; generated docs stay correct.

---

### 3.8 Authentication: JWT access + refresh (rotating) ✅

| Element | Choice | Reason |
| --- | --- | --- |
| Access token | Short-lived (15 min), kept **in memory** on the client | Limits damage if stolen; not readable by XSS from localStorage |
| Refresh token | Long-lived (7 days), **httpOnly + Secure cookie** | Not accessible to JavaScript |
| Refresh storage | **Hashed** in DB, **rotated** on each use | A DB leak can't be replayed; token reuse is detectable → revoke family |
| Passwords | **argon2id** | Current OWASP-recommended hash |

**Decision:** Standard, secure JWT pattern with rotation. Do not store access tokens in localStorage.

---

### 3.9 Authorization: RBAC ✅

Roles per tenant: **OWNER / ADMIN / OPERATOR / VIEWER**, enforced by a `requireRole` middleware on
every mutating route. Designed in from day one — bolting on RBAC later is error-prone.

---

### 3.10 Multi-tenancy: shared DB + `tenantId` + Row-Level Security ✅

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Shared DB + tenantId + RLS** | Simplest to operate & scale; one migration set; DB-level safety net | Requires discipline + RLS setup | **Chosen** |
| Schema-per-tenant | Stronger isolation | Migration overhead grows with customers | Rejected (ops cost) |
| DB-per-tenant | Maximum isolation | Heaviest ops; connection routing | Rejected (premature) |

**Enforcement is two-layered:**
1. **Application layer** — every query is tenant-scoped in the service.
2. **Database layer** — PostgreSQL **Row-Level Security** policies filter every row by
   `current_setting('app.current_tenant')`, set per request inside a transaction (`SET LOCAL`).
   Even a forgotten `WHERE` clause cannot leak another tenant's data.

**Critical detail:** the app's DB role must be a **non-owner** (owners bypass RLS), and we use
`FORCE ROW LEVEL SECURITY` as a backstop.

---

### 3.11 Background jobs & the webhook/integration backbone

**On a normal server:** BullMQ + Redis.
**On Catalyst (serverless):** there is no always-on worker and no Redis → **replace with Catalyst
Cron + Job Scheduling.**

**The Outbox Pattern (unchanged, and a better fit for serverless):**

```
1. Business action (e.g. job completes) — in ONE DB transaction:
     • update the business row
     • INSERT an event row into event_outbox
2. A Catalyst Cron job (every ~1 min) reads new event_outbox rows
3. It delivers the webhook / pushes the invoice to Zoho Books
4. On failure → retry with backoff; every attempt logged in webhook_delivery
```

| Pros | Cons |
| --- | --- |
| No event ever silently lost | Slight delivery latency (cron interval) |
| Survives external API downtime (Zoho rate limits/outages) | Requires idempotency keys to avoid duplicates |
| Customer-visible delivery status possible | — |

**Decision:** Outbox in Postgres + Catalyst Cron worker. This is the single most important reliability
pattern in the system; everything integration-related hangs off it.

---

### 3.12 Real-time dashboard

**On a normal server:** Socket.IO (WebSockets).
**On Catalyst (serverless):** instances are short-lived (~5 min) and autoscale, so persistent
WebSocket connections don't fit.

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Short polling / SSE** | Simple; fits serverless; adequate for manual-entry data | Not sub-second live | **Chosen (start here)** |
| Catalyst Signals / push | Platform-native | Extra integration | Option later |
| External realtime (Pusher/Ably) | True low-latency push | Added cost/dependency | Only if needed |

**Decision:** Start with **polling**. The data source is manual operator entry — sub-second realtime
is not required. Don't over-engineer realtime on a serverless host.

---

### 3.13 Caching

**Redis (as cache) → Catalyst Cache.** Cache hot reads (dashboards, product lists) in a shared store
all app instances can reach. Never cache in an instance's memory (instances don't share memory).

---

### 3.14 Containerization: Docker ✅ (kept)

AppSail **supports OCI/Docker images**. We keep Docker for:
- consistent local dev (`docker-compose` for Postgres + Redis-equivalent locally),
- a portable production image deployable to AppSail *or* any other host later.

**Decision:** Keep Docker. It is not wasted on Catalyst and preserves portability.

---

### 3.15 Frontend: React + Vite + TypeScript ✅

| Pros | Cons |
| --- | --- |
| Team-standard; huge ecosystem | — |
| Vite = fast builds & dev server (over CRA) | — |
| Static build hosts on Catalyst Web Client Hosting | — |

**Decision:** React + **Vite** (not Create React App). Frontend feature folders **mirror** backend
modules for consistency.

---

### 3.16 Frontend state management: React Query + Context ✅ (no Redux)

Frontend state splits into two kinds, each with a different best tool. Conflating them is why
teams over-reach for Redux.

| Kind of state | Examples here | Tool |
| --- | --- | --- |
| **Server state** — lives in the DB, fetched over HTTP | products, jobs, inventory, invoices, current user | **React Query** (`use*.ts` hooks) |
| **Client state** — exists only in the browser | access token (in memory), theme, sidebar open/closed, form fields | **React Context** + local `useState` |

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **React Query + Context** | ~90% of our state is server state — caching, loading, refetch, invalidation come for free; minimal boilerplate | Discipline to keep client vs server state separate | **Chosen** |
| Redux (Toolkit) | Powerful for complex *client* state (canvas/editor undo-redo) | Heavy boilerplate; re-implements caching React Query already gives; wrong fit for a forms-over-data app | Rejected (overkill) |
| Zustand | Tiny (~1 KB), simple global store | Not needed until complex shared *client* state appears | Backup option (later) |

**Decision:** **No Redux.** **Server state → React Query** (`app/queryClient.ts` + per-feature
`use*.ts` hooks). **Global client state → React Context** (`AuthProvider` holds the in-memory access
token per §3.8; `ThemeProvider`). Reach for **Zustand** only if complex shared *client* state (e.g. a
multi-step wizard) appears later. This matches guiding principle #2 — optimize for delivery speed and
maintainability, not novelty.

---

## 4. Folder structure (full project)

> Two meanings of "schema": the **database table schema** lives once in `prisma/schema/` (split by
> domain). The **input-validation schema** (Zod) lives per feature as `*.schemas.ts`. There is **no**
> per-feature table file.

```
production-monitor/
│
├── backend/                          # Express + TypeScript API (modular monolith)
│   ├── prisma/
│   │   ├── schema/                   # ⭐ table schema split by DOMAIN
│   │   │   ├── schema.prisma         #    generator + datasource config
│   │   │   ├── tenant.prisma         #    Tenant, User, Role, RefreshToken, ApiKey
│   │   │   ├── catalog.prisma        #    Product, Category, Unit, Bom
│   │   │   ├── inventory.prisma      #    Warehouse, StockMovement, StockLevel, Batch
│   │   │   ├── machines.prisma       #    Machine, WorkCenter, MachineStatus
│   │   │   ├── jobs.prisma           #    Job, JobRun, JobStep, JobAssignment
│   │   │   ├── production.prisma     #    ProductionLog, Downtime, QualityCheck
│   │   │   ├── billing.prisma        #    Invoice, InvoiceLine, Payment, TaxRate
│   │   │   ├── integrations.prisma   #    Integration, OAuthToken, ExternalRef, SyncState
│   │   │   ├── webhooks.prisma       #    EventOutbox, WebhookEndpoint, WebhookDelivery
│   │   │   └── audit.prisma          #    AuditLog, ActivityFeed
│   │   ├── migrations/               #    auto-generated by Prisma — never hand-edit
│   │   ├── rls.sql                   #    Row-Level Security policies (tenant safety net)
│   │   └── seed.ts                   #    demo tenant + admin user
│   │
│   ├── src/
│   │   ├── config/env.ts             # validate & export env vars (Zod) — fail fast at boot
│   │   ├── db/prisma.ts              # Prisma client + runAsTenant() (sets RLS context)
│   │   ├── lib/                      # jwt, password (argon2), crypto, idempotency, apiError
│   │   ├── middlewares/              # authenticate, requireRole, tenantContext, validate, errorHandler
│   │   │
│   │   ├── modules/                  # ⭐ one folder PER DOMAIN
│   │   │   └── products/             #    ── example feature, fully shown ──
│   │   │       ├── products.routes.ts       # URLs → handlers (wiring only)
│   │   │       ├── products.controller.ts   # reads req, sends res (knows HTTP)
│   │   │       ├── products.service.ts      # logic + DB via Prisma (NO HTTP)
│   │   │       └── products.schemas.ts      # Zod input validation
│   │   │   # auth/ inventory/ machines/ jobs/ production/ billing/ integrations/
│   │   │
│   │   ├── events/                   # outbox backbone (webhooks + integrations)
│   │   │   ├── outbox.service.ts     # write events in the same DB transaction
│   │   │   └── events.ts             # event type definitions
│   │   ├── jobs/                     # background workers (Catalyst Cron-triggered)
│   │   │   └── workers/              # webhookDelivery, zohoSync, lowStockAlert
│   │   ├── webhooks/inbound.routes.ts# INBOUND webhook receivers (signed, idempotent)
│   │   ├── realtime/socket.ts        # polling/SSE (or Signals) — live dashboard
│   │   ├── routes/index.ts           # mounts every module router under /api
│   │   ├── types/express.d.ts        # adds req.user / req.tenantId to Express types
│   │   ├── app.ts                    # build Express app: middleware + routes + docs
│   │   └── server.ts                 # entry point: app.listen()
│   │
│   ├── Dockerfile   .dockerignore   tsconfig.json   package.json   .env
│
├── web/                              # React + Vite + TypeScript (static build → Catalyst Web Hosting)
│   ├── index.html                    # Vite HTML entry
│   ├── vite.config.ts                # Vite config (aliases, proxy to API in dev)
│   ├── tsconfig.json                 # TypeScript config
│   ├── package.json                  # frontend dependencies & scripts
│   ├── .env                          # VITE_API_URL, etc.
│   ├── Dockerfile                    # builds static assets, serves them
│   ├── public/
│   │   ├── favicon.svg
│   │   └── logo.svg
│   │
│   └── src/
│       ├── main.tsx                  # app entry — mounts <App/>
│       ├── App.tsx                   # top-level providers + router outlet
│       ├── vite-env.d.ts             # Vite type declarations
│       │
│       ├── app/                      # app-wide setup
│       │   ├── router.tsx            # route definitions (React Router)
│       │   ├── queryClient.ts        # React Query client config
│       │   └── providers.tsx         # wraps Auth, Query, Theme providers
│       │
│       ├── api/                      # HTTP layer (talks to the Express backend)
│       │   ├── client.ts             # axios/fetch instance; injects access token
│       │   ├── interceptors.ts       # 401 → refresh-token retry logic
│       │   └── endpoints.ts          # centralized API path constants
│       │
│       ├── config/
│       │   └── env.ts                # reads import.meta.env (VITE_API_URL, ...)
│       │
│       ├── types/                    # shared TS types (mirror backend DTOs)
│       │   ├── product.ts
│       │   ├── inventory.ts
│       │   ├── job.ts
│       │   ├── invoice.ts
│       │   └── user.ts
│       │
│       ├── lib/                      # framework-agnostic helpers
│       │   ├── formatDate.ts
│       │   ├── formatCurrency.ts
│       │   ├── formatNumber.ts
│       │   └── cn.ts                 # className merge helper
│       │
│       ├── hooks/                    # shared reusable hooks
│       │   ├── useDebounce.ts
│       │   ├── usePagination.ts
│       │   ├── useToast.ts
│       │   └── usePolling.ts         # ⭐ live-dashboard polling (replaces WebSocket)
│       │
│       ├── components/               # shared, presentational UI (no business logic)
│       │   ├── ui/                   # design-system primitives
│       │   │   ├── Button.tsx
│       │   │   ├── Input.tsx
│       │   │   ├── Select.tsx
│       │   │   ├── Modal.tsx
│       │   │   ├── Table.tsx
│       │   │   ├── Badge.tsx
│       │   │   ├── Spinner.tsx
│       │   │   └── Card.tsx
│       │   ├── layout/
│       │   │   ├── AppLayout.tsx      # sidebar + header shell for authed pages
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Header.tsx
│       │   │   └── TenantSwitcher.tsx # if a user belongs to multiple tenants
│       │   └── feedback/
│       │       ├── EmptyState.tsx
│       │       ├── ErrorState.tsx
│       │       └── ConfirmDialog.tsx
│       │
│       ├── providers/                # React context providers
│       │   ├── AuthProvider.tsx      # holds access token (in memory) + current user
│       │   └── ThemeProvider.tsx
│       │
│       ├── routes/                   # route-level guards
│       │   ├── ProtectedRoute.tsx    # redirect to /login if unauthenticated
│       │   └── RoleRoute.tsx         # RBAC: OWNER/ADMIN/OPERATOR/VIEWER
│       │
│       └── features/                 # ⭐ one folder per feature — MIRRORS backend modules
│           └── products/             # ── example feature; EVERY other feature follows this shape ──
│               ├── ProductsPage.tsx        # list screen
│               ├── ProductDetailPage.tsx   # single product view
│               ├── ProductForm.tsx         # create/edit form
│               ├── ProductsTable.tsx       # table component for this feature
│               ├── useProducts.ts          # list query hook (React Query)
│               ├── useProduct.ts           # single-item query hook
│               ├── useCreateProduct.ts     # create mutation hook
│               ├── products.api.ts         # calls backend /api/products
│               └── products.schemas.ts     # Zod validation for the product form
│           #
│           # The remaining features — auth, dashboard, inventory, machines, jobs,
│           # production, billing, integrations, settings — each mirror a backend
│           # module and use the SAME file layout shown in products/ above.
│           # (Create them as you build each feature; products/ is the template.)
│
├── docker-compose.yml                # local dev: postgres (+ cache)
├── .env.example   .gitignore   README.md
```

### Frontend file-naming conventions (per feature)

| File pattern | Role | Knows about |
| --- | --- | --- |
| `*Page.tsx` | A routed screen | Composition of components + hooks |
| `*Form.tsx` / `*Table.tsx` / `*Card.tsx` | Feature-local UI pieces | Props only |
| `use*.ts` | Data hooks (React Query fetch/mutate) | The API layer, caching |
| `*.api.ts` | HTTP calls to the backend | `api/client.ts`, endpoint paths |
| `*.schemas.ts` | Zod validation for that feature's forms | Field rules (mirrors server Zod) |

Feature folders **mirror the backend modules** (`features/products/` ↔ `modules/products/`), so
navigating full-stack is trivial. Truly shared UI lives in `components/ui`; anything specific to one
feature stays inside that feature's folder.

Additional frontend rules:

1. **No business logic in components** — data logic lives in hooks (`use*.ts`) and `*.api.ts`, keeping
   screens declarative and testable.
2. **Auth token in memory** (`AuthProvider`), refresh via the httpOnly cookie + `api/interceptors.ts`
   — matches the backend auth design (Section 3.8).
3. **Live data via `usePolling`**, not WebSockets — consistent with the serverless (AppSail) hosting
   decision (Section 3.12 / Section 6).

### Frontend request flow (products example)

```
ProductsPage.tsx
   └─ useProducts()            (hooks / React Query — caching, loading, refetch)
        └─ products.api.ts     (HTTP call)
             └─ api/client.ts  (adds Authorization: Bearer <access token>)
                  └─ GET /api/products  ──►  Express backend
```

For a create action, `ProductForm.tsx` validates with `products.schemas.ts` (Zod) **before** calling
`useCreateProduct()` → `products.api.ts`. Client-side Zod mirrors the server-side Zod, so users get
instant feedback while the server still validates authoritatively.

### The five rules that keep this maintainable at 150 tables

1. **Tables** live in `prisma/schema/*.prisma`, split by domain — never a per-feature table file.
2. Each `modules/<domain>/` has the same four files: **routes → controller → service → schemas**.
3. **Services never touch another module's tables directly** — call that module's service instead.
4. Every external call (Zoho, outbound webhooks) goes through the **outbox → Cron worker**, never inline.
5. Every tenant-scoped query goes through **`runAsTenant()`** so RLS is always enforced.

---

## 5. Request lifecycle (how the layers cooperate)

```
Browser ──GET /api/products──► routes ──► controller ──► service ──► runAsTenant()
                                                                        │
                                          (SET LOCAL app.current_tenant) │
                                                                        ▼
                                                              Prisma ──► PostgreSQL
                                                              (RLS auto-filters by tenant)
```

For writes (`POST`), the **`validate` middleware** runs the Zod schema first and rejects bad input
before it reaches the controller.

---

## 6. Serverless (AppSail) implications on the code

AppSail runs **many identical instances** of the app behind a load balancer, spawned/killed by
traffic. Consequences we design around:

| Constraint | Rule | Why |
| --- | --- | --- |
| Instances don't share memory | No state in module-level variables | Next request may hit a different instance |
| Instances are short-lived (~5 min) | No always-on workers | Use Catalyst Cron instead of in-process BullMQ |
| Connections multiply across instances | Use a **connection pooler** | Avoid exhausting Postgres connections |
| No persistent sockets | Polling/SSE, not WebSockets | Connections don't survive instance churn |
| Cold starts | Keep boot fast; cache hot reads | First request to a new instance has latency |

A well-built stateless Express app satisfies all of these with **no rewrite** — only the jobs and
realtime *implementations* change (Catalyst SDK instead of BullMQ/Socket.IO).

---

## 7. Deployment on Zoho Catalyst

```bash
npm install -g zcatalyst-cli
catalyst login
catalyst init                     # select AppSail + Web Client Hosting + Functions/Cron
cd web && npm run build && cd ..  # React → static files
catalyst deploy                   # pushes API (AppSail) + web (hosting) + cron in one command
```

- **Backend** → AppSail (Node runtime or our Docker image). Env vars (`DATABASE_URL`, JWT secrets,
  Zoho credentials) set in the console/CLI.
- **Frontend** → Web Client Hosting (static build).
- **Background jobs** → Catalyst Cron + Job Scheduling.
- **Cache** → Catalyst Cache.
- **Database** → external managed PostgreSQL (see `DATABASE_DECISION.md`), same region as the
  Catalyst data center for low latency.

---

## 8. Summary table — final stack

| Concern | Choice | Replaces / over |
| --- | --- | --- |
| Language | TypeScript | plain JS |
| Backend | Express | Fastify, NestJS |
| Architecture | Modular monolith | microservices |
| ORM | Prisma (+ `$queryRaw`) | Sequelize, raw-only, Drizzle |
| Database | PostgreSQL (external managed) | Zoho ZCQL/Data Store |
| Validation | Zod | Joi |
| API docs | OpenAPI from Zod | hand-written Swagger |
| Auth | JWT access+refresh (rotating), argon2 | — |
| Multi-tenancy | Shared DB + tenantId + RLS | schema/db-per-tenant |
| Jobs | Catalyst Cron + Outbox | BullMQ + Redis |
| Realtime | Polling/SSE (→ Signals) | Socket.IO |
| Cache | Catalyst Cache | Redis cache |
| Container | Docker | — |
| Frontend | React + Vite | CRA |
| FE state | React Query + Context | Redux |
| Host | Catalyst AppSail + Web Hosting | manual VM |

---

## 9. Open questions for stakeholders

1. **Traffic profile** — steady all-day usage vs spiky (shift-change bursts)? Affects DB plan sizing.
2. **Webhooks direction** — outbound (we notify customers' systems), inbound (machines/Zoho notify us),
   or both? Determines which subsystem is built first.
3. **Data ingestion** — confirmed manual entry now; will machines auto-report later? If yes, we
   revisit a time-series layer (TimescaleDB) at that point.
4. **Compliance** — will enterprise customers require specific certifications/regions? Affects the
   eventual database-provider endgame (see `DATABASE_DECISION.md`).
