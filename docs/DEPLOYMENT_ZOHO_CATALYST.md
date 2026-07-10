# Deployment & Configuration — Zoho Catalyst

**Project:** Production Monitoring & Inventory Management (multi-tenant SaaS)
**Hosting target:** Zoho Catalyst
**Companion docs:** `ARCHITECTURE_AND_TECH_STACK.md`, `DATABASE_DECISION.md`,
`AWS-RDS-PostgreSQL-Complete-Guide.md`, `HOSTING_CATALYST_VS_ALTERNATIVES.md`
**Last updated:** 2026-07-07

> **Purpose.** This is the single source of truth for **how the app is deployed and configured on
> Zoho Catalyst**. Architecture/tech-stack rationale lives in `ARCHITECTURE_AND_TECH_STACK.md`; this
> file is the operational "how do we ship it" companion.

---

## 1. The big picture (read first)

The whole product ships to **one Zoho account → one Catalyst project**. That single project holds
several **components**, and our two source folders (`web/` and `backend/`) map onto two of them.

```
   Monorepo (one git repo)              ONE Catalyst project (ONE Zoho account)
┌────────────────────────┐           ┌────────────────────────────────────────┐
│ web/     (React+Vite)  │ ─build──► │  Web Client Hosting   (static CDN)      │
│ backend/ (Express API) │ ─deploy─► │  AppSail              (Node / Docker)   │
│ backend/jobs/workers   │ ─deploy─► │  Functions + Cron     (background jobs) │
└────────────────────────┘           │  Catalyst Cache       (hot reads)       │
                                      └────────────────────────────────────────┘
   PostgreSQL is EXTERNAL managed (AWS RDS) — NOT hosted on Catalyst.
```

**Key facts:**

| Question                                       | Answer                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| One Zoho account for both frontend + backend?  | ✅ Yes — one account, one Catalyst project.                              |
| Separate accounts/projects for web vs backend? | ❌ No — both are components of the **same** project.                     |
| Single command to deploy both?                 | ✅ `catalyst deploy` (after building the frontend).                      |
| Does `docker-compose` deploy to Catalyst?      | ❌ No — docker-compose is **local dev only** (see §9).                   |
| Common root `package.json`?                    | ❌ Not required — each folder has its own; the root has `catalyst.json`. |

---

## 2. Which Catalyst service hosts what

| App part                   | Catalyst service                          | What that service is                                   | Why                                                                     |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Backend** (Express)      | **AppSail**                               | Runs a server app (Node runtime **or** a Docker image) | It executes server code, holds routes, talks to Postgres                |
| **Frontend** (React build) | **Web Client Hosting**                    | A **static file CDN** — serves HTML/CSS/JS only        | After `npm run build` the frontend is just static files                 |
| **Background jobs**        | **Functions + Cron / Job Scheduling**     | Scheduled serverless execution                         | Outbox delivery, Zoho sync, low-stock alerts (see `ARCHITECTURE §3.11`) |
| **Cache**                  | **Catalyst Cache**                        | Shared key-value store all instances reach             | Hot reads (dashboards, product lists)                                   |
| **Database**               | **External managed PostgreSQL** (AWS RDS) | Not a Catalyst service                                 | ACID, RLS, portability (see `DATABASE_DECISION.md`)                     |

> ⚠️ **The frontend does NOT go on AppSail.** AppSail runs _server code_. A built React app is static
> files, so it goes on **Web Client Hosting**. AppSail is for the backend only.

---

## 3. How `catalyst deploy` knows which folder goes where

It is **not** magic and **not** based on folder names. Deployment is **config-driven**: `catalyst init`
creates small **manifest files** that tag each folder, and `catalyst deploy` reads them.

```
jobwork-process-webapp/
├── catalyst.json              ← PROJECT manifest: project ID + which components exist
│
├── client/                    ← tagged as Web Client Hosting…
│   └── client-package.json    ← …by THIS file ("I am the web client; serve these files")
│
└── <appsail-app>/             ← tagged as an AppSail app…
    └── app-config.json        ← …by THIS file (runtime = node, start command, port)
```

| Manifest file         | Location               | Declares                                                                           |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `catalyst.json`       | repo root              | The project ID/account and which components the project has                        |
| `client-package.json` | the client folder      | "This folder is a **web client** → **Web Client Hosting**"                         |
| `app-config.json`     | the AppSail app folder | "This folder is an **AppSail app**: Node stack, start command, port → **AppSail**" |

`catalyst deploy` walks `catalyst.json`, finds each declared component, reads its manifest, and pushes
it to the matching service. That's the entire mechanism.

---

## 4. Reconciling our `web/` + `backend/` names with Catalyst's layout

Catalyst's defaults expect a folder named `client` (web hosting) and an app folder for AppSail. Our
architecture uses `web/` and `backend/`. Reconcile this **once**, at setup, using either option:

**Option A — point the Vite build at Catalyst's client folder (recommended, simplest):**

- Let `catalyst init` create the `client/` folder (with `client-package.json`).
- In `web/vite.config.ts`, set the build output there:
  ```ts
  // web/vite.config.ts
  export default defineConfig({
    plugins: [react()],
    build: { outDir: '../client', emptyOutDir: true }, // React build → Catalyst client folder
  });
  ```
- Now `npm run build` (inside `web/`) fills `client/`, and `catalyst deploy` ships it.

**Option B — keep our names and edit the manifests** so `catalyst.json` / `client-package.json` point
at `web/dist`, and the AppSail `app-config.json` lives in / points at `backend/`. More manual, but
preserves the exact folder names from the architecture doc.

> **Decision (default):** use **Option A** for the frontend (build straight into `client/`) and place
> the AppSail app manifest in `backend/`. Revisit only if the layout becomes awkward.

---

## 5. Prerequisites (one-time, per machine)

```bash
npm install -g zcatalyst-cli   # the Catalyst CLI
catalyst login                 # opens a browser; log in with the Zoho account that owns the project
```

- You must be logged into the **Zoho account that owns the Catalyst project**.
- Node.js must match the AppSail runtime version you select (keep local and Catalyst in sync).

---

## 6. First-time project setup

Run once, at the repo root:

```bash
catalyst init
# When prompted, select:
#   • AppSail             (backend API)
#   • Web Client Hosting  (frontend static site)
#   • Functions / Cron    (background jobs)
```

This creates `catalyst.json` at the root plus the per-component manifest files (§3). Commit these to
git so every environment deploys identically.

Then wire the frontend build output per §4 (Option A) and confirm the AppSail manifest points at the
Express entry point (`backend/dist/server.js` after `tsc`, or the Docker image).

---

## 7. Configuration & environment variables

Secrets are **never** committed. They are set in the Catalyst console (or via CLI) per environment.

### 7.1 Backend (AppSail) env vars

| Var                                     | Example                             | Notes                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | `postgres://user:pass@host:5432/db` | External managed Postgres; **use a connection pooler** (AppSail multiplies instances — see `ARCHITECTURE §6`). Prefer the app's **non-owner** DB role so RLS is enforced. |
| `JWT_ACCESS_SECRET`                     | (random 32+ bytes)                  | Short-lived access token signing (15 min).                                                                                                                                |
| `JWT_REFRESH_SECRET`                    | (random 32+ bytes)                  | Refresh token signing (7 days, rotating).                                                                                                                                 |
| `NODE_ENV`                              | `production`                        | —                                                                                                                                                                         |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | —                                   | Zoho Books integration (set when that module ships).                                                                                                                      |
| `CORS_ORIGIN`                           | the Web Hosting URL                 | Lock the API to the frontend origin.                                                                                                                                      |

`backend/src/config/env.ts` validates these with **Zod at boot** and fails fast if any is missing
(`ARCHITECTURE §4`).

### 7.2 Frontend (Web Client Hosting) env vars

Vite inlines `VITE_*` vars **at build time**, so they must be set **before `npm run build`**, not in
the Catalyst console.

| Var            | Dev value                                         | Prod value                                                                     |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `VITE_API_URL` | `/api` (Vite dev proxy forwards to local backend) | the deployed API base URL (e.g. `https://<project>.catalyst...appsail.../api`) |

Because these bake into the static bundle, a change to `VITE_API_URL` requires a **rebuild + redeploy**
of the frontend.

### 7.3 Same-origin vs CORS

- If the frontend and API are served under the **same domain** (path-routed), the browser hits `/api`
  directly — simplest, and refresh-token cookies work without CORS config.
- If they're on **different origins**, set `CORS_ORIGIN` on the backend and configure the API base URL
  on the frontend, and ensure the refresh cookie is `SameSite=None; Secure`.

---

## 8. The deploy commands

```bash
# 1) Build the frontend (static files → client/ per §4 Option A)
cd web && npm run build && cd ..

# 2) Push everything (API + web + cron) in ONE command
catalyst deploy
```

`catalyst deploy` reads `catalyst.json` and ships each component to its service:

```
catalyst deploy ──reads catalyst.json──►  client/         → Web Client Hosting
                                      └►  <appsail app>/  → AppSail
                                      └►  functions/cron  → Functions / Cron
```

**Optional convenience:** a tiny **root** `package.json` (scripts only — not a dependency manifest) so
the two steps feel like one:

```jsonc
// jobwork-process-webapp/package.json  (optional, convenience only)
{
  "private": true,
  "scripts": {
    "deploy": "cd web && npm run build && cd .. && catalyst deploy",
  },
}
```

Then `npm run deploy` runs build + deploy. The actual Catalyst push is still the single
`catalyst deploy`.

---

## 9. docker-compose is LOCAL DEV ONLY

This is the most common misconception — state it plainly: **Catalyst never reads
`docker-compose.yml`.**

|              | `docker-compose.yml`                                    | `catalyst deploy`                                                                 |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Purpose**  | Run Postgres + the app **on your laptop** for local dev | Ship to production                                                                |
| **Shape**    | Multiple long-running containers at once                | AppSail takes **one** stateless image (`backend/Dockerfile`), not a compose stack |
| **Database** | A throwaway local Postgres container                    | The **external managed** Postgres (RDS) — not in Catalyst                         |

Why AppSail can't use compose: AppSail is **serverless** — many short-lived, autoscaled copies of _one_
stateless container. A compose stack (app + DB, long-running, stateful) is the opposite model. In
production, Postgres is a separate managed service and Catalyst runs only the stateless Express image.

---

## 10. Recommended repo layout for deployment

```
jobwork-process-webapp/
├── catalyst.json          ← ties the project together (from `catalyst init`)
├── package.json           ← OPTIONAL: convenience deploy script only (§8)
├── docker-compose.yml     ← LOCAL DEV ONLY (postgres + app)
├── README.md
├── client/                ← Web Client Hosting target (Vite build output, §4 Option A)
│   └── client-package.json
├── web/                   ← React + Vite source
│   ├── package.json       ← frontend deps
│   └── vite.config.ts     ← build.outDir = "../client"
└── backend/               ← Express API source (AppSail)
    ├── package.json       ← backend deps
    ├── app-config.json    ← AppSail manifest (or created under an app folder by `catalyst init`)
    └── Dockerfile         ← single image → AppSail (optional; Node runtime also works)
```

---

## 11. Deploy checklist

- [ ] `catalyst login` with the account that **owns** the project.
- [ ] `catalyst.json` + manifests committed to git.
- [ ] Frontend `VITE_API_URL` set to the **production** API URL, then `npm run build`.
- [ ] Backend env vars (`DATABASE_URL`, JWT secrets, `CORS_ORIGIN`, Zoho creds) set in Catalyst.
- [ ] `DATABASE_URL` points at the managed Postgres via a **connection pooler**, non-owner role.
- [ ] External Postgres is in the **same region** as the Catalyst data center (low latency).
- [ ] Run `catalyst deploy`; verify the web URL loads and `/api/health` responds.
- [ ] Confirm cron jobs are registered (outbox delivery running).

---

## 12. Open questions / to confirm at deploy time

1. **Exact AppSail runtime** — Node version vs our Docker image? (Keep local Node in sync.)
2. **Domain strategy** — same-origin path routing (`/api`) vs separate API subdomain (affects CORS +
   cookie `SameSite`).
3. **Managed Postgres provider/region** — see `AWS-RDS-PostgreSQL-Complete-Guide.md`; must be close to
   the Catalyst data center.
4. **Secrets management** — Catalyst console env vars vs a secrets manager, and rotation policy for JWT
   secrets.
