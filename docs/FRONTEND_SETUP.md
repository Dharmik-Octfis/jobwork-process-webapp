# Frontend Setup Guide (`web/`)

> **Purpose.** Step-by-step reproducible setup for the React frontend, plus the rationale for every
> dependency. A new developer should be able to recreate `web/` from scratch using only this file.
> Higher-level design lives in `docs/ARCHITECTURE_AND_TECH_STACK.md` (esp. §3.15,
> §3.16, §4) and `docs/DEPLOYMENT_ZOHO_CATALYST.md`.

**Stack:** React + Vite + TypeScript (a static SPA — see the deployment doc for why it hosts on
Catalyst **Web Client Hosting**, not AppSail).

_Last updated: 2026-07-07._

---

## 1. Prerequisites

| Tool    | Version                 | Notes                             |
| ------- | ----------------------- | --------------------------------- |
| Node.js | 18+ (developed on 24.x) | JavaScript runtime + `npm`        |
| npm     | 9+ (developed on 11.x)  | Package manager (ships with Node) |

Check with:

```powershell
node --version
npm --version
```

---

## 2. Scaffold the project (one-time)

The project was created with Vite's official React + TypeScript template.

```powershell
# Run from the REPO ROOT (not from inside web/), so it fills the web/ folder:
npm create vite@latest web -- --template react-ts
```

- `web` = target folder · `--template react-ts` = React + TypeScript.
- ⚠️ **Gotcha:** run this from the **repo root**. Running it from _inside_ `web/` creates a nested
  `web/web/` folder. If that happens, move the contents up one level and delete the nested folder.

This generates: `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`,
`public/`, and `src/` (`main.tsx`, `App.tsx`, `index.css`, …).

---

## 3. Install dependencies

The scaffold installs React + the dev toolchain automatically. Then add the runtime libraries the app
needs:

```powershell
cd web
npm install            # (safety) install what the scaffold declared
npm install react-router-dom @tanstack/react-query axios zod react-hook-form @hookform/resolvers
```

- Runtime libs (above) go in `"dependencies"` — they ship to the browser.
- Build-only tools (Vite, TypeScript, types, ESLint) live in `"devDependencies"` — set up by the
  scaffold.

---

## 4. Dependencies & why

### Runtime (`dependencies`)

| Package                 | Role                                          | Why we chose it                                                                                |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `react`, `react-dom`    | UI library                                    | Team standard (architecture §3.15)                                                             |
| `react-router-dom`      | Routing (URL → page)                          | `/login`, protected routes, redirects                                                          |
| `@tanstack/react-query` | **Server state** — fetch/cache/loading/errors | Architecture §3.16: server state ≠ client state. (Package renamed from the old `react-query`.) |
| `axios`                 | HTTP client                                   | Talks to the Express API; interceptors for the 401→refresh flow (§3.8)                         |
| `zod`                   | Validation + inferred TS types                | One schema → runtime validation **and** static types (§3.6)                                    |
| `react-hook-form`       | Form state management                         | Efficient field/submit/error handling                                                          |
| `@hookform/resolvers`   | Bridge: Zod ↔ react-hook-form                 | Validate forms with the Zod schema                                                             |

### Build tooling (`devDependencies`, from the scaffold)

| Package                                           | Role                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| `vite`                                            | Dev server + production bundler (fast; over CRA — §3.15) |
| `@vitejs/plugin-react`                            | Teaches Vite to compile React/JSX                        |
| `typescript`                                      | Type checker (`tsc`) (§3.1)                              |
| `@types/react`, `@types/react-dom`, `@types/node` | Type definitions                                         |
| `eslint` + plugins                                | Code-style linting                                       |

> **No Redux / Zustand** for now — global client state uses **React Context** (`AuthProvider`,
> `ThemeProvider`); server state uses React Query. See architecture §3.16.

---

## 5. Scripts

Run inside `web/`:

| Command           | What it does                                                                           |
| ----------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server (hot-reload) at `http://localhost:5173`. Stop with `Ctrl+C`. |
| `npm run build`   | Type-check (`tsc -b`) + produce the production build in `dist/` (static files → CDN).  |
| `npm run preview` | Serve the built `dist/` locally to sanity-check the production build.                  |
| `npm run lint`    | Run ESLint over the codebase.                                                          |

---

## 6. Folder structure (target)

Frontend feature folders **mirror the backend modules** (architecture §4). Built incrementally; the
`auth` (login) feature comes first.

```
web/src/
├── main.tsx                # entry — mounts <App/> into #root
├── App.tsx                 # top-level providers + router outlet
│
├── app/                    # app-wide setup
│   ├── router.tsx          # route definitions (React Router)
│   ├── queryClient.ts      # React Query client config
│   └── providers.tsx       # wraps Auth, Query, Theme providers
│
├── api/                    # HTTP layer (talks to the Express backend)
│   ├── client.ts           # axios instance; injects access token
│   └── endpoints.ts        # centralized API path constants
│
├── config/
│   └── env.ts              # reads import.meta.env (VITE_API_URL, …)
│
├── providers/
│   └── AuthProvider.tsx    # holds access token (in memory) + current user
│
├── components/             # shared, presentational UI
│   └── ui/                 # Button, Input, Spinner, …
│
├── routes/
│   └── ProtectedRoute.tsx  # redirect to /login if unauthenticated
│
└── features/               # one folder per feature — MIRRORS backend modules
    └── auth/               # ── login feature (first) ──
        ├── LoginPage.tsx        # the login screen
        ├── auth.api.ts          # calls POST /api/auth/login
        ├── login.schemas.ts     # Zod validation for the login form
        └── useLogin.ts          # React Query mutation hook
```

### Naming conventions (per feature)

| Pattern                    | Role                                    |
| -------------------------- | --------------------------------------- |
| `*Page.tsx`                | A routed screen                         |
| `*Form.tsx` / `*Table.tsx` | Feature-local UI pieces                 |
| `use*.ts`                  | Data hooks (React Query fetch/mutate)   |
| `*.api.ts`                 | HTTP calls to the backend               |
| `*.schemas.ts`             | Zod validation for that feature's forms |

---

## 7. Environment variables

Vite exposes only vars prefixed `VITE_`, inlined **at build time** (`.env` is git-ignored; commit
`.env.example`).

| Var            | Dev                                 | Prod                  |
| -------------- | ----------------------------------- | --------------------- |
| `VITE_API_URL` | `/api` (Vite proxy → local backend) | deployed API base URL |

Changing a `VITE_*` value requires a rebuild + redeploy of the frontend (see deployment doc §7.2).

---

## 8. Related docs

- `docs/CODE_QUALITY_AND_FORMATTING.md` — Prettier, ESLint (no-unused-vars), line endings, and the
  pre-commit hook (Husky + lint-staged) that keep formatting consistent across the team.
- `docs/ARCHITECTURE_AND_TECH_STACK.md` — full stack decisions (§3.15 frontend,
  §3.16 state management, §4 folder structure).
- `docs/DEPLOYMENT_ZOHO_CATALYST.md` — how `web/` deploys to Catalyst Web Client
  Hosting.
