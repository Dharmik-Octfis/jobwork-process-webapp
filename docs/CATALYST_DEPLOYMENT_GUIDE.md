# Deploying to Zoho Catalyst — A Complete, Beginner-Friendly Guide

**Project:** jobwork-process-webapp
**Catalyst project:** `jobwork-test` (org: OCTFIS)
**AppSail app:** `jobwork-api`
**Live URL:** https://jobwork-api-10128926223.development.catalystappsail.com
**Last updated:** 2026-07-14

> This guide assumes you have never used Zoho Catalyst before. Every command explains what it
> does, every file explains why it exists, and every line of config is explained. Follow it top
> to bottom the first time. After that, jump straight to **Part 6 — Routine Redeploy**.

---

## Part 1 — Understand the shape of the deployment (read this first)

Do not skip this. If you understand this section, the rest is mechanical.

### 1.1 What Catalyst is

Zoho Catalyst is a cloud platform (like AWS or Heroku). Inside Catalyst you create a
**project**, and inside a project you enable **services**. We use exactly one service:

| Catalyst service       | What it is                               | Do we use it? |
| ---------------------- | ---------------------------------------- | ------------- |
| **AppSail**            | Runs a server application (our Node app) | ✅ **Yes**    |
| **Web Client Hosting** | A static file CDN for HTML/CSS/JS        | ❌ No         |
| Functions / Cron       | Scheduled serverless code                | ❌ Not yet    |
| Catalyst Data Store    | Catalyst's own database                  | ❌ No         |

### 1.2 The one big decision: we use AppSail ONLY

A typical setup would put the React app on **Web Client Hosting** and the API on **AppSail** —
two separate services, two separate URLs.

**We deliberately do not do that.** Instead, our Express server does two jobs at once:

```
                    ONE AppSail app  (one URL, one server)
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
Browser │  GET /api/login   ─────►  Express API route          │  ────► AWS RDS
   ───► │  GET /            ─────►  Express serves index.html  │       (PostgreSQL)
        │  GET /assets/*.js ─────►  Express serves static file │
        │                                                      │
        └──────────────────────────────────────────────────────┘
```

**Why this is better for us:**

| Benefit                 | Explanation                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **No CORS problems**    | The browser loads the page and calls the API from the **same origin**. Cross-origin rules never trigger. No `CORS_ORIGINS` juggling.         |
| **Cookies just work**   | A future httpOnly refresh-token cookie stays _first-party_. No `SameSite=None; Secure` complexity.                                           |
| **One thing to deploy** | One command, one URL, one place to look at logs.                                                                                             |
| **Same as local dev**   | In dev, Vite proxies `/api` to Express so it _looks_ same-origin. In production it genuinely _is_ same-origin. Dev and prod behave the same. |

The cost is that Express serves static files instead of a CDN. For an internal business app this
is completely fine.

**Consequence to remember:** the React build output must physically live **inside the `backend/`
folder**, because Catalyst only uploads `backend/`. That is why we point Vite's output at
`backend/public` (Part 3, Step 6).

### 1.3 Where the database lives

**PostgreSQL is NOT on Catalyst.** It is on **AWS RDS**, outside Catalyst entirely. Catalyst
only runs the Node app; the app dials out to RDS over the internet.

This has a critical implication that trips up almost everyone — see **Part 2, Step 0**.

### 1.4 The most important thing to understand about AppSail

> **AppSail does NOT run `npm install` for you.**

On most platforms (Heroku, Render, Vercel) you push source code and the platform installs
dependencies and builds it. **AppSail does not.** It takes the folder you point it at, zips it,
and runs your start command inside a Linux container.

That means **everything the app needs at runtime must already be in the folder before you
deploy**:

- `dist/` — your compiled JavaScript (you must run the TypeScript build yourself)
- `node_modules/` — your installed packages (you must have installed them yourself)
- `public/` — the built React app (you must have run the Vite build yourself)
- `certs/` — the RDS certificate

If any of these is missing or stale, you deploy a broken app. **This is why the build order in
Part 4 matters so much.**

### 1.5 How `catalyst deploy` decides _where_ to deploy

When you run `catalyst deploy`, three independent things determine the destination. They live at
**different scopes**, and only two of them are inside your repo.

| What gets picked                     | Decided by                    | Scope                        |
| ------------------------------------ | ----------------------------- | ---------------------------- |
| **Which Zoho account**               | your `catalyst login` session | 🌍 **Global — machine-wide** |
| **Which Catalyst project + env**     | `.catalystrc` (repo root)     | 📁 Per folder                |
| **Which AppSail, from which folder** | `catalyst.json` (repo root)   | 📁 Per folder                |

> ℹ️ Both repo-root files are **generated per deploy** by `scripts/deploy.mjs` and gitignored —
> `.catalystrc` from `deploy/<target>.catalystrc.json`, `catalyst.json` from `deploy/services.json`.
> The table describes what the CLI reads; §1.5b describes where those files come from.

**The account is global.** It is stored **outside your repo**, in:

```
Windows:  %APPDATA%\zcatalyst-cli-nodejs\Config\zcatalyst-cli.json
```

There is exactly **one logged-in Zoho account per machine** at a time. Nothing in your repo
influences it.

**The project is per-folder.** `.catalystrc` names it:

```json
"projects": [{ "id": "9867000000485004", "name": "jobwork-test", "env": [{ "name": "Development" }] }],
"actives":  { "project": 1, "env": 1 }
```

**The AppSail is per-folder.** `catalyst.json` names it, and names the folder to upload:

```json
{ "appsail": [{ "source": "backend", "name": "jobwork-api" }] }
```

This repo holds **more than one** AppSail, so that file is generated per deploy holding only the one
service being deployed — see §1.5b.

> ✅ **This is why working on several Catalyst projects is safe.** Each repo carries its own
> `.catalystrc` + `catalyst.json`. `catalyst deploy` reads whichever ones are in the folder you are
> standing in. **The `cd` is the selector** — you never pass a project flag, and switching repos
> switches the target automatically.
>
> ⚠️ **The one real footgun is the account.** If your two Catalyst projects live under _different
> Zoho accounts_, the per-folder config will still name the right project, but the CLI will be
> authenticated as the wrong user. You must `catalyst login` to switch.

### 1.5b Two targets in one repo — how staging and production stay apart

Staging and production live under **different Zoho accounts**, so the `cd`-is-the-selector trick
above does not apply: one repo, two destinations. And the repo holds more than one AppSail, so it is
one repo, two destinations, **several services**. `scripts/deploy.mjs` is the selector for both
dimensions, and `.catalystrc` + `catalyst.json` become **generated files** (git-ignored) rather than
shared settings.

```bash
npm run deploy:staging:api        # target + service, both explicit
npm run deploy:production:api
# `deploy:staging` / `deploy:production` remain as aliases for the :api pair.
```

Neither dimension is ever defaulted. A default target deploys to the wrong account; a default
service deploys the wrong app.

| Per target    | File                              | Holds                                      |
| ------------- | --------------------------------- | ------------------------------------------ |
| Zoho account  | `deploy/targets.json` → `account` | the login the CLI must be authenticated as |
| Project + env | `deploy/<target>.catalystrc.json` | copied to `.catalystrc` at deploy time     |

| Per service                | File                                      | Holds                                             |
| -------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Folder, AppSail name       | `deploy/services.json`                    | → the generated `catalyst.json`, one entry        |
| Build steps, required keys | `deploy/services.json`                    | npm scripts to run; env keys checked before build |
| Secrets                    | `deploy/targets.json` → `services.<name>` | git-ignored env file per target **per service**   |
| AppSail name override      | `deploy/targets.json` → `services.<name>` | optional; a different AppSail per account         |

**The account check is the point of the script.** Three of the four settings are repo files it
writes; the account is machine-wide and it cannot set it. So it reads the CLI's own login file
(`%APPDATA%\zcatalyst-cli-nodejs\Config\zcatalyst-cli.json`, `active_dc` + that DC's `user.Email`)
and **refuses to deploy** when it does not match the target — the failure mode a correct-looking
`.catalystrc` cannot protect you from. Switch accounts with `catalyst logout && catalyst login`.

It also cross-checks `ZC_PROJECT_ID` / `ZC_PROJECT_KEY` / `ZC_ENVIRONMENT` in the env file against
the project in the `.catalystrc` payload. A half-edited copy of staging's env file would otherwise
run the app in one project while its Stratus and Cache credentials point at another.

Every check runs **before** anything is written, built or uploaded, so a rejected deploy leaves the
working tree untouched. Then it prints the resolved account, project, environment, AppSail, env file
and **database host**, and makes you type the target name to proceed:

```
  ┌─ Deploy target: STAGING
  │  Zoho account : user1@demo14.octfis.in  (dc: in)
  │  Project      : Jobwork  [69851000000066569]
  │  Environment  : Development
  │  AppSail      : jobwork-api ← backend/
  │  Env file     : backend/.env.staging  (26 variables)
  │  Database     : jobwork-db-dev...ap-south-1.rds.amazonaws.com:5432/jobwork_dev
  └─ Build        : web + backend

  Type "staging" to deploy, anything else to abort:
```

Flags: `--yes` (skip confirmation — required when stdin is not a TTY), `--skip-build` (reuse the
existing `dist/` + `public/`), `--skip-account-check` (when the CLI login file cannot be read).

**Setting up a target** — once per account. `catalyst init` already knows every id; don't retype them:

```bash
catalyst logout && catalyst login     # as THAT target's Zoho account
rm .catalystrc && catalyst init       # pick its project + environment
npm run capture:staging               # or capture:production
```

`scripts/capture-target.mjs` writes the generated `.catalystrc` to `deploy/<target>.catalystrc.json`
and records the logged-in account + DC in `deploy/targets.json`. It refuses to capture when the
account or the project already belongs to the _other_ target — two targets pointing at one place
deploys successfully into the wrong environment, so it cannot be a warning.

> ⚠️ **`rm .catalystrc` first, or `catalyst init` fails.** It validates the portal already bound in
> the directory against your session before doing anything, so an old target's `.catalystrc` produces
> `The Catalyst portal initialized in the current project directory is not accessible with the
currently logged in user`. The file is generated — deleting it costs nothing.

> ⚠️ **Nothing `ZC_*` carries across accounts.** A second account means a different org, so the
> production env file needs its **own** Stratus bucket, its own Self Client
> (`ZC_CLIENT_ID`/`ZC_CLIENT_SECRET`/`ZC_REFRESH_TOKEN`), and its own `ZC_PROJECT_ID` /
> `ZC_PROJECT_KEY` / `ZC_ENVIRONMENT`. Copying staging's values gives you an app that boots and then
> fails every upload.

> ⚠️ **`ZC_ENVIRONMENT` is the environment's real name, not the target's name.** A target called
> `production` deploying into a Catalyst **Development** environment needs
> `ZC_ENVIRONMENT="Development"`. `deploy.mjs` compares it against `.catalystrc` and blocks the
> mismatch.

**The first deploy into a fresh project goes interactive.** The AppSail named in `catalyst.json`
does not exist in the new project yet, so `catalyst deploy appsail` drops into its create flow and
prompts. Answer:

| Prompt                | Answer                          | Why                                                                               |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| Name for your AppSail | **the name the banner printed** | Per target — see below.                                                           |
| Build directory       | _(blank)_                       | `build_path` is relative to `source: backend`; it must end up `.`, not `backend`. |
| Stack                 | **NodeJS 24**                   | Matches the service's `app-config.base.json`.                                     |
| Command to start      | `node dist/src/server.js`       | Matches the service's `app-config.base.json`.                                     |

> 🔴 **Answer the name prompt with the name `npm run deploy:<target>:<service>` printed** on its
> `AppSail :` line, not from memory — a service may be a **different AppSail per target**, and the
> banner is the only place the resolved name appears.
>
> `catalyst.json` used to be committed, which forced one identical AppSail name across both projects:
> answering this prompt with anything else made the CLI rewrite the shared file, and the _other_
> target then deployed to that name too, creating a stray AppSail there or failing. It is now
> **generated per deploy** from `deploy/services.json` plus the target's optional `appsail` override,
> so a rewrite is discarded rather than persisted, and per-target names are safe. The `accounts`
> service uses that override deliberately — staging and production are different Zoho accounts in
> different data centres, so they are genuinely different AppSails.
>
> `api` still uses one name for both targets. That was always safe because the projects live in
> different accounts, where names may repeat; Catalyst appends a per-project suffix to the URL
> (`jobwork-api-<zaid>.<env>.catalystappsail.com`), so nothing is ambiguous.

Answering the build-directory prompt with `backend` yields `build_path: "backend"` → the CLI zips
`backend/backend` → an empty bundle. `build-app-config.mjs` rewrites `app-config.json` from
`app-config.base.json` on every deploy, so this self-corrects on the _next_ run — but the run you are
in ships nothing.

> ℹ️ **`web/` needs no per-target config.** `VITE_API_URL=/api` is same-origin and the bundle is
> served by the same AppSail, so both targets build identically.

### 1.6 Why `node_modules` must be bundled (the runtime model)

AppSail offers **two runtimes**, and the choice explains everything about how deployment feels.

| Runtime                                      | Where dependencies get installed        | Consequence                                                      |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| **Catalyst-Managed Runtime** ← _we use this_ | **Nowhere.** You upload `node_modules`. | Your machine is effectively the build server for a Linux target. |
| **Custom (Docker) Runtime**                  | Inside the image, on Linux (`npm ci`)   | Normal. Portable. Nothing platform-specific to get wrong.        |

The managed runtime is an **upload-and-run** platform, not a **build-and-run** platform. Compare:

- **Heroku / Render / Elastic Beanstalk / any CI pipeline:** you push _source_, and the platform
  runs `npm install` **on the target Linux machine**. Your dev OS never matters.
- **AppSail managed runtime:** you push a _finished folder_, and it just runs your start command.
  Nothing re-resolves anything for the target OS.

**Three things follow, and they are not obvious:**

1. **This has nothing to do with TypeScript.** TypeScript is why you ship a compiled `dist/`. It is
   not why you ship `node_modules`. A plain-JavaScript backend with no build step would bundle
   `node_modules` identically — `require('express')` resolves from disk at runtime regardless.
2. **`node_modules` isn't "bundled" in the webpack sense.** Nothing packs or tree-shakes it. It is
   simply a folder sitting on your disk (because _you_ ran `npm install`, possibly days ago), and
   the CLI zips it along with everything else.
3. **The zip is a faithful copy of your machine.** Whatever `npm install` put on your **Windows**
   disk is exactly what lands in a **Linux** container. Nothing in between re-resolves it. This is
   why any dependency containing **native binaries** needs care — see Part 7.

> **The escape hatch.** If this model ever becomes painful, the Docker runtime removes the entire
> class of problem: your `Dockerfile` runs `npm ci` on Linux, `node_modules` is never uploaded from
> Windows, and the same image runs unchanged on AWS/GCP/anywhere. The CLI supports it today
> (`catalyst deploy appsail --source <image> --port <port>`).

### 1.7 What `catalyst deploy` actually does, step by step

```
  YOUR MACHINE                                    ZOHO CLOUD
┌──────────────────────────────┐
│ 1. Read catalyst.json        │  → "deploy AppSail 'jobwork-api' from folder backend/"
│ 2. Read .catalystrc          │  → "into project jobwork-test / Development"
│ 3. Read CLI login (%APPDATA%)│  → "as this Zoho account"
│ 4. Read backend/app-config   │  → stack node24, command, memory, env_variables
│ 5. Run predeploy script      │  (LOCAL — if scripts.predeploy is set)
│ 6. ZIP backend/  (build_path)│  ── includes dist/, node_modules/, public/, certs/, .env (!) ──┐
└──────────────────────────────┘                                                                │
                                                                                                ▼
                                                              ┌─────────────────────────────────────┐
                                                              │ 7. Upload + UNZIP into a Linux      │
                                                              │    container (stack: node24)        │
                                                              │ 8. Inject console env variables     │
                                                              │ 9. Run: node dist/src/server.js     │
                                                              │10. Health-check the listening port  │
                                                              └─────────────────────────────────────┘
```

Steps 1–6 happen **entirely on your laptop**. Steps 7–10 happen in Zoho's cloud. There is **no build
step anywhere in the cloud half** — that is the whole point of §1.6.

Note step 6: the zip includes **`backend/.env`**. `.gitignore` has no effect on a zip. See Step 16.

### 1.8 `catalyst deploy` vs `catalyst deploy appsail`

| Command                            | What it deploys                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `catalyst deploy`                  | **Every resource** declared in `catalyst.json` — functions, client, AppSail, Slate.                                   |
| `catalyst deploy appsail`          | **Only the AppSail.** Also accepts overrides: `--name`, `--build-path`, `--stack`, `--command`, `--source`, `--port`. |
| `catalyst deploy --only appsail`   | Same targeting, without the subcommand's override flags. Supports `--only appsail:jobwork-api`.                       |
| `catalyst deploy --except client`  | Everything **but** the named target.                                                                                  |
| `catalyst deploy --ignore-scripts` | Skip the `preserve` / `predeploy` lifecycle hooks.                                                                    |

**These are no longer equivalent for us.** `--only appsail` is **resource** targeting, not **service**
targeting: it pushes every entry in `catalyst.json`'s `appsail` array. With two services registered,
one command would deploy both — and the confirmation banner, reading only the first entry, would not
say so.

`scripts/deploy.mjs` closes that by **generating `catalyst.json` with a single entry** for the service
being deployed, then running the narrow form. Two properties fall out: `--only appsail` is exactly
right because there is only one entry to find, and the narrow form still excludes any future
Function/Cron/Client resource that bare `catalyst deploy` would push.

> The table above notes `--only appsail:jobwork-api`. We do **not** rely on name targeting — it is
> undocumented by Zoho for this flag and untested here, and one-entry generation is correct whether
> the CLI supports it or not.

> 🔴 **Do not use the `appsail` _subcommand_ in a script.** `catalyst deploy appsail` is not just
> narrow targeting: `--name`, `--build-path`, `--stack` and `--command` are **its options**, and it
> **prompts for every one you don't pass**, ignoring `catalyst.json` and `app-config.json`. In a
> scripted deploy that hangs waiting for input, and the answers it collects can overwrite the
> committed `catalyst.json` with a different AppSail name — breaking the _other_ deploy target.
>
> `catalyst deploy --only appsail` is pure targeting: declarative, no prompts, same single resource.
> Check with `catalyst deploy appsail --help` — the flag list is the giveaway.

---

## Part 2 — Prerequisites (do these once)

### Step 0 — Open AWS RDS to Zoho's network ⚠️ START THIS FIRST

**This is the single most likely thing to break your deployment, and it may need someone else's
help, so start it before anything else.**

Your database works on your laptop because **your IP address** is allowed through the RDS
firewall. Catalyst runs in Zoho's cloud, which has **completely different IP addresses**. By
default, RDS will simply refuse the connection.

In the AWS console:

1. Go to your RDS instance → **Modify** → set **Publicly accessible = Yes**.
2. Go to its **Security Group** → **Inbound rules** → allow **TCP port 5432**.
3. For the source, allowlist **Zoho Catalyst's outbound IP range**. Ask Zoho support for the
   range for your data centre (we are on the **India DC** — our Catalyst timezone is
   `Asia/Kolkata`).

> ⚠️ **Do not take the shortcut of allowing `0.0.0.0/0`.** That opens your production database
> to the entire internet. A leaked password would then be enough to steal all your data.

**Why this failure is so confusing when it happens:** our app deliberately tests the database
connection at startup. In `backend/src/server.ts`:

```ts
await prisma.$queryRaw`SELECT 1`; // line 17 — a real round-trip to the DB
```

and if it fails:

```ts
main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1); // line 38 — kill the process
});
```

So an unreachable database does not show up as a nice "database error" page. The whole app
**crash-loops**, and AppSail just reports that the app won't start. If you ever see that, check
RDS connectivity first.

(This "fail fast" design is intentional and good — it is far better to know at boot than to
discover it when your first user tries to log in.)

### Step 1 — Install Node.js

Catalyst will run our app on the **Node 24** runtime. Keep your local Node on version 24 too, so
that what works locally works there.

```bash
node -v      # should print v24.x.x
```

### Step 2 — Install the Catalyst CLI

```bash
npm install -g zcatalyst-cli
```

**What this does:** installs the `catalyst` command globally on your machine. `-g` means
"global" — available from any folder, not just this project. This is the tool that talks to
Zoho's servers.

Verify:

```bash
catalyst --version    # 1.26.2 or newer
```

### Step 3 — Log in to Zoho

```bash
catalyst login
```

**What this does:** opens your browser and asks you to log in to Zoho. It then saves an
authentication token on your machine so the CLI can deploy on your behalf.

⚠️ **Log in with the Zoho account that owns the Catalyst project.** If your account has multiple
projects (including colleagues' projects), you must be careful in the next step not to deploy
into the wrong one.

### Step 4 — Make sure a Catalyst project exists

Go to https://catalyst.zoho.com and confirm the project **`jobwork-test`** exists. If you are
setting this up fresh, create a new project — **do not reuse a colleague's project.** Deploying
into someone else's project can overwrite their app.

---

## Part 3 — One-time repo setup

You only do Part 3 **once, ever**. It creates config files and makes small code changes. After
this, deploying is just Part 4.

> **If you cloned this repo and these files already exist, skip to Part 4.**

### Step 5 — Initialize Catalyst in the repo

Run at the repo root:

```bash
catalyst init
```

**What this does:** links this folder on your computer to a project in the Zoho cloud.

When prompted:

- **Select your project** → `jobwork-test`
- **Select components** → **AppSail only**

> ❗ **Do NOT select "Client".** "Client" means Web Client Hosting (a static site). We are not
> using it — Express serves our frontend instead (Part 1.2). Selecting it would create a `client/`
> folder that we would never use.

**Files this creates:**

**`.catalystrc`** (repo root) — remembers _which_ Zoho project and environment you selected:

```json
{
  "projects": [
    {
      "id": "9867000000485004",
      "name": "jobwork-test",
      "timezone": "Asia/Kolkata",
      "env": [{ "id": "767455168", "name": "Development" }]
    }
  ]
}
```

⚠️ **This file used to be committed, and no longer is.** With one destination, committing it meant
every clone targeted the same project automatically. With staging and production under **different
Zoho accounts** that stopped working: one committed file cannot name two destinations, and it would
show up dirty in `git status` every time you switched.

It is now **git-ignored and generated** — `scripts/deploy.mjs` writes it from
`deploy/<target>.catalystrc.json` on every deploy (§1.5b). The committed sources of truth live in
`deploy/`. Don't hand-edit `.catalystrc`; your next deploy overwrites it.

### Step 6 — Register the backend as an AppSail app

```bash
catalyst init appsail --force
```

**What this does:** tells the CLI "this folder is a server app that should run on AppSail".
`--force` lets it run even though `catalyst init` has already been run.

Answer the prompts exactly like this:

| Prompt                                        | Answer                                  | Why                                                                                |
| --------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Select the runtime                            | **Catalyst-Managed Runtime**            | Catalyst provides the Node runtime. (The alternative is supplying a Docker image.) |
| Get started with example AppSails?            | **No**                                  | We have our own app.                                                               |
| Initialize an AppSail in this directory?      | **No**                                  | Our app is in `backend/`, not the repo root.                                       |
| Exact path to your AppSail's source directory | `E:\...\jobwork-process-webapp\backend` | This is the folder Catalyst will upload.                                           |
| Name for your AppSail                         | `jobwork-api`                           | Becomes part of the public URL.                                                    |
| Build path                                    | _(leave blank — we fix it in Step 7)_   | —                                                                                  |
| Stack                                         | **NodeJS 24**                           | Must match your local Node version.                                                |

**Files this creates:**

**`catalyst.json`** (repo root) — the project manifest. This is how `catalyst deploy` knows
_what_ to deploy and _from where_:

```json
{
  "appsail": [
    {
      "source": "backend", // ← the folder to upload
      "name": "jobwork-api" // ← the app's name in the Catalyst console
    }
  ]
}
```

`"source": "backend"` is the entire mechanism. It is **not** magic and **not** based on folder
names — `catalyst deploy` reads this file and uploads exactly the folder named here.

🔴 **Do not commit `catalyst.json`.** It is gitignored and generated per deploy from
`deploy/services.json`, holding only the service being deployed (§1.5, §1.8). The committed source of
truth is `deploy/services.json`; that is what every developer shares.

**`backend/app-config.json`** — the AppSail app's own settings. The CLI creates it with a
**placeholder that will fail**. We fix it next.

### Step 7 — Fix `backend/app-config.json`

The CLI writes this useless placeholder:

```json
{
  "command": "echo Please specify the start-up command in the app-config.json file ...",
  "build_path": "",
  ...
}
```

If you deploy this, the app "starts", prints an error message, and immediately exits. **Replace
the whole file with:**

```json
{
  "command": "node dist/src/server.js",
  "build_path": ".",
  "stack": "node24",
  "env_variables": {},
  "memory": 256,
  "scripts": {}
}
```

**Every key explained:**

| Key             | Our value                 | What it means                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`       | `node dist/src/server.js` | The command Catalyst runs to start your app, executed **inside the `backend/` folder**. This path exists because `tsc` compiles `src/server.ts` → `dist/src/server.js`. It matches the `start` script in `backend/package.json`.                                                                                          |
| `build_path`    | `.`                       | Which sub-folder of `source` to upload. `.` means **all of `backend/`**. We need all of it: `dist/`, `node_modules/`, `public/`, `certs/`, and `generated/` must travel together.                                                                                                                                         |
| `stack`         | `node24`                  | The Linux runtime image Catalyst boots. Matches your local Node 24.                                                                                                                                                                                                                                                       |
| `env_variables` | generated                 | **Do not hand-edit.** `npm run config:appsail -- <target>` writes this from the git-ignored `backend/.env.<target>`; the committed template is `app-config.base.json`. `catalyst deploy` ships this key and it **replaces** the AppSail config, so an empty `{}` here silently deletes every variable set in the console. |
| `memory`        | `256`                     | RAM in MB for each instance. 256 MB is fine for an Express + Prisma app.                                                                                                                                                                                                                                                  |
| `scripts`       | `{}`                      | `preserve` / `predeploy` lifecycle hooks. ⚠️ These run **on your machine** before upload — they are _not_ remote build steps (see §1.6). We drive the build from `scripts/deploy.mjs` instead, so this stays empty.                                                                                                       |

✅ **Commit `app-config.base.json`.** ❌ **Never commit the generated `app-config.json`** — it carries
every secret for whichever target you last deployed (Part 7, item 4).

### Step 8 — Make the app listen on Catalyst's port

**The problem:** locally, your app reads `PORT` from `.env` and listens there. **AppSail ignores
`PORT`.** It picks its own port, tells you via an environment variable named
`X_ZOHO_CATALYST_LISTEN_PORT`, and then checks that something is listening there. If your app
listens on the wrong port, Catalyst decides the app is dead — even though it is running fine.

**The fix.** In `backend/src/config/env.ts`, add this to the `envSchema` object, right after
`PORT`:

```ts
  /**
   * AppSail injects the port it wants the app to listen on and ignores `PORT`.
   * Absent locally, so `PORT` remains the dev default.
   */
  X_ZOHO_CATALYST_LISTEN_PORT: z.coerce.number().int().positive().optional(),
```

Line by line:

- `z.coerce.number()` — environment variables are always **strings**; `coerce` turns `"9000"`
  into the number `9000`.
- `.int().positive()` — a port must be a positive whole number.
- `.optional()` — **this is the important part.** On your laptop this variable does not exist. If
  it were required, the app would refuse to start locally.

Then change the exported `port`:

```ts
port: raw.X_ZOHO_CATALYST_LISTEN_PORT ?? raw.PORT,
```

`??` means "use the left value, but if it is null/undefined use the right one". So:

- **On Catalyst:** `X_ZOHO_CATALYST_LISTEN_PORT` is set → use it.
- **On your laptop:** it is undefined → fall back to `PORT` from `.env`.

**One change, both environments work.** You never have to edit this again.

### Step 9 — Make Express serve the React app

This is what makes the "one server does both jobs" design (Part 1.2) actually work.

In `backend/src/app.ts`:

**A.** Add this import at the very top:

```ts
import { join } from 'node:path';
```

**B.** Insert this block **after** `app.use('/api', apiRouter);` and **before** the
`notFoundHandler` block:

```ts
// The Vite build (web/) is emitted into `public/` so it ships inside the same
// AppSail bundle as the API. Same origin, so no CORS and no cross-site cookie.
const publicDir = join(process.cwd(), 'public');

app.use(express.static(publicDir));

// React Router owns every non-API route, so a hard refresh on /login must get
// index.html back rather than a 404 from the API's notFoundHandler.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) {
    next();
    return;
  }
  res.sendFile(join(publicDir, 'index.html'));
});
```

**Explained line by line:**

- `const publicDir = join(process.cwd(), 'public');`
  `process.cwd()` is "the folder the app was started from". On Catalyst that is `backend/`, so
  this resolves to `backend/public` — where Vite puts the React build. (`backend/src/db/prisma.ts`
  already makes this same assumption for the RDS certificate, so the two are consistent.)

- `app.use(express.static(publicDir));`
  Serves real files: if the browser asks for `/assets/index-abc.js` and that file exists in
  `public/assets/`, send it. This handles JS, CSS, images, and fonts.

- **The fallback middleware — why it is needed.**
  React Router runs **in the browser**. When you click a link to `/login`, no request hits the
  server. But if the user **refreshes the page** on `/login`, the browser asks the _server_ for
  `/login` — and there is no file called `login` and no Express route for it. Without this
  middleware the user gets a 404 on every refresh.

  So: for any **GET** request that is **not** an API call and didn't match a real file, send back
  `index.html`. The browser loads React, React Router reads the URL, and shows the right page.

- `if (req.method !== 'GET' || req.path.startsWith('/api'))` → `next()`
  This guard is what keeps the API working correctly:
  - **Not a GET?** (a POST to a wrong URL) → skip; let the normal 404 handle it.
  - **Starts with `/api`?** → skip; a wrong API path must return a **JSON 404**, not an HTML page.
    An API client receiving HTML instead of JSON is a horrible bug to debug.

**⚠️ The order of these `app.use()` calls is critical:**

```
1. app.use('/api', apiRouter)      ← API routes win first
2. express.static(publicDir)       ← then real files (JS/CSS/images)
3. SPA fallback → index.html       ← then anything else that's a page request
4. notFoundHandler                 ← finally, genuine 404s
```

Put the fallback before the API router and it would swallow your entire API.

### Step 10 — Point the Vite build into `backend/public`

By default `npm run build` in `web/` writes to `web/dist`. **Catalyst never uploads `web/`** — it
only uploads `backend/`. So the build output has to land inside `backend/`.

In `web/vite.config.ts`, add a `build` block:

```ts
export default defineConfig({
  plugins: [react()],
  // Emit into the backend so the static files ship inside the same AppSail
  // bundle as the API — Express serves them (see backend/src/app.ts).
  build: { outDir: '../backend/public', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
```

- `outDir: '../backend/public'` — put the built files where Express is looking for them (Step 9).
- `emptyOutDir: true` — **required.** Because the output folder is now _outside_ `web/`, Vite
  refuses to delete files there without explicit permission (a safety feature — it does not want
  to nuke a folder it doesn't own). Without this you accumulate **stale assets** from old builds.
- **Keep the `server.proxy` block.** It only affects `npm run dev`. It is what forwards `/api`
  calls to your local Express during development.

### Step 11 — Frontend production config

Create **`web/.env.production`**:

```
VITE_API_URL=/api
```

**Why `/api` and not a full URL?** Because Express serves the frontend and the API from the same
origin. The browser is already on `https://jobwork-api-….catalystappsail.com`, so a request to
`/api/login` goes to the right place automatically. No hostname needed.

**Why this must exist before you build:** Vite **bakes `VITE_*` variables into the JavaScript
bundle at build time**. They are not read at runtime. So changing this value later means you must
**rebuild and redeploy** the frontend.

> Note: `web/src/config/env.ts` already defaults to `/api`, so this file is really belt-and-braces.
> It is also gitignored (the root `.gitignore` ignores `.env.*`), which is fine.

### Step 12 — Ignore the build output

Add one line to `backend/.gitignore`:

```
/public
```

`backend/public` is **generated output**, not source code. It is rebuilt on every deploy, so it
must never be committed — otherwise every developer's build creates a huge, noisy diff.

---

## Part 4 — Build (do this before EVERY deploy)

> 🔴 **The order of these two steps matters.** The frontend build writes into `backend/public`,
> and the deploy uploads `backend/`. Build the frontend **first**.

### Step 13 — Build the frontend

```bash
cd web
npm ci
npm run build
```

- `npm ci` — installs dependencies **exactly** as recorded in `package-lock.json`. (Use this
  rather than `npm install`, which can silently upgrade packages.)
- `npm run build` — runs `tsc -b && vite build`: typechecks, then bundles React into static files.

**Verify it worked:**

```bash
ls ../backend/public/index.html      # this file MUST exist
```

You should see output like:

```
../backend/public/index.html               0.63 kB
../backend/public/assets/index-*.css       8.71 kB
../backend/public/assets/index-*.js      459.36 kB
```

If those files landed in `web/dist` instead, Step 10 was not applied.

### Step 14 — Build the backend

```bash
cd ../backend
npm ci
npm run build
```

`npm run build` runs `prisma generate && tsc`:

- **`prisma generate`** — reads `prisma/schema/` and writes a typed database client into
  `backend/generated/prisma/`. This folder is gitignored, so it **must** be regenerated on every
  fresh machine, or the app won't compile.
- **`tsc`** — compiles TypeScript → JavaScript into `backend/dist/`.

**Verify it worked:**

```bash
ls dist/src/server.js      # this file MUST exist
```

This is exactly the file named in `app-config.json`'s `command`. If it is missing, the deployed
app cannot start.

### Step 15 — Smoke-test locally (strongly recommended)

Before spending 40 seconds uploading, prove the built app actually works. This runs **the same
command Catalyst will run**:

```bash
cd backend
node dist/src/server.js
```

You should see:

```
prisma:query SELECT 1
API listening on http://localhost:7000 (development)
```

Now, in a second terminal, check all four behaviours:

```bash
# 1. The React app is served
curl -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:7000/
#    expect: 200 text/html

# 2. SPA fallback — a hard refresh on an inner route must NOT 404
curl -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:7000/login
#    expect: 200 text/html

# 3. The API still works
curl http://localhost:7000/api/health
#    expect: {"status":"ok"}

# 4. A bad API path returns JSON, not HTML
curl http://localhost:7000/api/nope
#    expect: {"message":"Cannot GET /api/nope"}  (404)
```

If all four pass, the deploy will almost certainly work. Stop the server with `Ctrl+C`.

---

## Part 5 — Deploy

### Step 16 — Keep `.env` out of the upload

Because `build_path` is `"."`, **the entire `backend/` folder is zipped — including
`backend/.env`**, which holds your real database password. `.gitignore` does not help here: the
Catalyst bundle is a zip of the folder, not a git export.

Two problems if you leave it:

1. Your production secrets end up inside the deployment artifact.
2. `backend/src/config/env.ts` starts with `import 'dotenv/config'`, so that file gets **loaded in
   production**. Your `.env` says `NODE_ENV=development`, which would turn on SQL query logging
   (`db/prisma.ts:71`) and disable production behaviour.

**`scripts/deploy.mjs` does this for you** — it parks `backend/.env` at `.env.deploy-backup` in the
repo root for the duration of the upload and restores it in a `finally` (Part 6). The manual
equivalent, if you ever call `catalyst deploy` by hand:

```bash
mv backend/.env .env.backup      # ...and put it back in Step 19
```

### Step 17 — Deploy

From the repo root:

```bash
npm run deploy:staging       # or: npm run deploy:production
```

**What this does, precisely:**

0. Verifies the logged-in Zoho account, writes `.catalystrc`, `catalyst.json` and the service's
   `app-config.json` for the target, runs the service's build steps, and parks its local `.env`
   (§1.5b). Then, via `catalyst deploy --only appsail`:

1. Reads the generated `catalyst.json` → **one** AppSail app named `jobwork-api`, `source: backend`.
2. Reads `backend/app-config.json` → learns the stack (`node24`), the start command, the memory.
3. Zips the whole `backend/` folder (`build_path: "."`) and uploads it.
4. Boots a Linux container, unzips it, and runs `node dist/src/server.js`.

Successful output looks like:

```
√ AppSail[jobwork-api] uploaded in 42 seconds
√ DEPLOYMENT SUCCESSFUL: jobwork-api
i APPSAIL URL : https://jobwork-api-10128926223.development.catalystappsail.com
```

> ⚠️ **On a brand-new app, the app will not actually run yet** — you removed `.env` and haven't set
> the cloud variables. `DEPLOYMENT SUCCESSFUL` means _"uploaded and started"_, not _"healthy"_.
> That is expected. Continue to Step 18.
>
> **This is why the first deploy must come before setting environment variables: the app does not
> exist in the Catalyst console until you deploy it once.** You cannot configure something that
> isn't there.

### Step 18 — Set the environment variables in the Catalyst console

Now that `jobwork-api` exists, go to:

**Console → `jobwork-test` → AppSail → `jobwork-api` → Configuration → Environment Variables**

| Variable               | Value                                      | Why                                                                    |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `DATABASE_URL`         | your RDS URL — **keep `?sslmode=require`** | How the app reaches PostgreSQL.                                        |
| `DATABASE_SSL_CA_PATH` | `./certs/rds-ap-south-1-bundle.pem`        | The certificate that proves the DB server is really Amazon.            |
| `JWT_ACCESS_SECRET`    | your 32+ character secret                  | Signs login tokens. **Must be ≥ 32 chars** or the app refuses to boot. |
| `JWT_ACCESS_TTL`       | `15m`                                      | How long an access token stays valid.                                  |
| `NODE_ENV`             | `production`                               | Turns off SQL query logging; enables production behaviour.             |

**❌ Do NOT set `PORT`.** Catalyst supplies `X_ZOHO_CATALYST_LISTEN_PORT`, which Step 8 already
handles. Setting `PORT` would do nothing but confuse the next person.

**Why these must be here and not in a file:** `backend/.env` is gitignored _and_ excluded from the
upload (Step 16). The Catalyst console is the **only** place production secrets live.

**What happens if you forget one:** `env.ts` validates every variable at boot with Zod and throws:

```
Invalid environment variables:
  - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be at least 32 characters
```

…and the app exits. This is deliberate — better a loud crash at startup than silently unsigned
tokens.

### Step 19 — Redeploy, then restore your local `.env`

```bash
catalyst deploy
```

This second deploy picks up the environment variables. **This one should come up healthy.**

Then restore your development environment:

```bash
mv .env.backup backend/.env
```

### Step 20 — Verify the live app

Open **https://jobwork-api-10128926223.development.catalystappsail.com** and check:

- [ ] `/api/health` returns `{"status":"ok"}` → the server is alive.
- [ ] `/` loads the React login page → static serving works.
- [ ] **Hard-refresh on an inner route** (e.g. `/login`) → must NOT 404. This proves the SPA
      fallback from Step 9 works.
- [ ] **Actually log in** → this is the only check that proves the **database connection** works
      end-to-end.

If anything fails, go to **AppSail → Logs** in the console. `server.ts:37` prints
`Failed to start:` followed by the real reason.

---

## Part 6 — Routine redeploy (every time after the first)

Once Parts 2–3 are done, a normal deploy is **one command that names its destination**:

```bash
npm run deploy:staging       # or: npm run deploy:production
```

`scripts/deploy.mjs` (§1.5b) does the whole sequence: verify the Zoho account → verify the env file
and `.catalystrc` agree → show the target and ask → write `.catalystrc` → generate
`backend/app-config.json` → `build:web` → `build:backend` → park `backend/.env` → `catalyst deploy
appsail` → restore `backend/.env`.

> ✅ **The `.env` dance is now automatic.** It used to be a manual `mv backend/.env .env.backup`
> before every deploy and a `mv` back after (Step 16) — miss it and you uploaded the real DB password
> and `NODE_ENV=development`. The script parks it at `.env.deploy-backup` **in the repo root** (not
> inside `backend/`, where `build_path: "."` would just zip it under a new name) and restores it in a
> `finally`, plus on Ctrl-C. If a run is killed hard enough to skip both, the next run finds the
> parked file, sees no `backend/.env`, and puts it back. If it finds _both_, it stops and makes you
> decide which is current.

You do **not** need to touch the console again — but **not** because the values persist. They do
not. `catalyst deploy` pushes `app-config.json`, whose `env_variables` **replaces** the AppSail
configuration wholesale, wiping anything typed into the Configuration tab. (`NODE_ENV` appears to
survive only because AppSail injects it itself.) The wipe is easy to miss: the container already
running keeps its environment — a process's env is fixed at spawn — so the app keeps working until
the next cold start, when a fresh process boots against the emptied config and `env.ts` throws
`Invalid environment variables`.

The console is therefore **not a store**. `backend/.env.<target>` is. Add variables there — and
remember there are now **two** such files. A variable added to `.env.staging` and not `.env.production`
is a variable that exists in staging and vanishes at the next production cold start.

> ⚠️ **`npm run deploy:appsail` is gone.** It deployed to whatever `.catalystrc` happened to say,
> which with two accounts is a coin flip. It now exits 1 pointing at the two target-named scripts.
>
> Catalyst's `catalyst.json` has an `ignore` array that would remove the need to park `.env` at all,
> but Zoho's docs only document it for **`functions`**, not `appsail`. It is untested here — do not
> rely on it without verifying.

> ℹ️ **Why `npm install` is inside both build scripts.** It makes branch switching safe (§6.1). If
> the lockfile didn't change, npm no-ops in about a second, so the cost is negligible.

### 6.1 What you must redo after switching git branches

**`node_modules/` and `dist/` are gitignored — and git does not touch ignored directories.** So when
you `git checkout` another branch, both silently keep the _previous_ branch's contents. Nothing warns
you.

| Artifact            | Tracked by git? | What happens on branch switch                               | What you must do                          |
| ------------------- | --------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `src/`              | ✅ Yes          | Updated to the new branch                                   | —                                         |
| `package-lock.json` | ✅ Yes          | Updated to the new branch                                   | —                                         |
| `node_modules/`     | ❌ Ignored      | **Left alone** — now possibly out of sync with the lockfile | `npm ci` **only if the lockfile changed** |
| `dist/`, `public/`  | ❌ Ignored      | **Left alone** — still the old branch's compiled output     | **Always rebuild**                        |

**Dependencies — only when the lockfile changed.** Check instead of guessing:

```bash
git diff --name-only HEAD@{1} HEAD -- '*package-lock.json'
```

Nothing printed → your `node_modules` is already correct, skip the install.

**Build — every time.** A stale `dist/` does not always crash loudly. It usually just runs **last
branch's business logic**, silently, which is far worse than a `Cannot find module` error.

✅ **`npm run deploy:<target>` handles both of these for you** — it installs and rebuilds both folders
before deploying. That is exactly why the build belongs _inside_ the deploy command rather than in
your memory. (`--skip-build` opts out, for a redeploy of an artifact you just built.)

---

## Part 7 — What to be careful about

These are the traps, ranked by how likely they are to hurt you.

### 1. 🔴 RDS must be reachable from Zoho's cloud

The number one cause of a failed deployment. It works locally because _your_ IP is allowlisted.
See **Part 2, Step 0**. Symptom: the app crash-loops with no obvious database error, because
`server.ts:17` fails and `server.ts:38` exits the process.

### 2. 🔴 Build the frontend BEFORE you deploy

Vite writes into `backend/public`; `catalyst deploy` uploads `backend/`. If you deploy without
building, you ship **whatever was in `public/` last time** — or nothing at all. Symptom: the API
works but the website is blank or shows an old version.

### 3. 🔴 AppSail does not run `npm install`

`node_modules/` must physically exist in `backend/` before you deploy. **Never delete
`node_modules` to "save upload size".** Symptom: `Cannot find module 'express'`.

### 4. 🟠 Never commit `app-config.json`

Secrets **must** live in its `env_variables` — the console does not survive a deploy (Step 18) — so
the file is git-ignored and generated by `npm run config:appsail -- <target>` from
`backend/.env.<target>`. Edit `app-config.base.json` for non-secret settings (`command`, `stack`,
`memory`); never add `app-config.json` back to git.

### 5. 🟠 `.env` gets uploaded unless it is moved

`build_path: "."` zips the whole folder, and `.gitignore` has no effect on a zip. Symptom if it
slips through: production silently runs in `development` mode against your dev database.
`scripts/deploy.mjs` now parks it automatically (Part 6) — this only bites you if you invoke
`catalyst deploy` by hand.

### 6. 🟠 Changing `VITE_API_URL` requires a rebuild

Vite bakes it into the JS bundle. Editing it without rebuilding changes nothing.

### 7. 🟠 Deploying into the wrong project — or the wrong account

If your Zoho account has several projects (e.g. colleagues' work), `catalyst init` will happily
let you pick the wrong one, and deploying into a colleague's project can overwrite their app.

Since staging and production sit under **different Zoho accounts**, the sharper version of this is
deploying staging's build into production. `npm run deploy:<target>` is the mitigation: it verifies
the logged-in account, cross-checks the env file against the project, prints the destination
including the **database host**, and makes you type the target name (§1.5b). Deploying by calling
`catalyst deploy` directly skips every one of those checks.

### 8. 🟡 The first deploy of a new app is always two deploys

Deploy → the app appears in the console → set env vars → deploy again. There is no way to
pre-configure an app that does not exist yet.

### 9. 🟡 Be careful with `npm prune --omit=dev`

It is tempting to run this before deploying to shrink the upload. It can **remove
platform-specific optional dependencies** that your app needs at runtime on Linux, producing a
`Cannot find module` crash that does not reproduce on your machine. Unless you have a specific
reason, **just don't**. The upload is only ~40 seconds.

### 10. 🟡 Keep local Node and the AppSail stack in sync

We are on `node24` in `app-config.json`. If your laptop runs Node 20, you may compile something
that behaves differently in the cloud.

---

## Part 8 — Quick reference: every file and what it does

| File                                          | Committed?               | Created by                  | Purpose                                                                                                                |
| --------------------------------------------- | ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `deploy/services.json`                        | ✅ Yes                   | you                         | **The service manifest** — per service: source folder, AppSail name, build steps, required env keys (§1.5b).           |
| `deploy/targets.json`                         | ✅ Yes                   | you                         | **The target manifest** — per target: Zoho account, DC, `.catalystrc` payload, and per service its env file (§1.5b).   |
| `deploy/<target>.catalystrc.json`             | ✅ Yes                   | `catalyst init`, then you   | The Catalyst **project + environment** for one target. Copied to `.catalystrc` at deploy time.                         |
| `backend/app-config.base.json`                | ✅ Yes                   | you                         | Non-secret AppSail settings: start command, Node stack, memory. Same for both targets. One per service.                |
| `catalyst.json`                               | ❌ No (generated)        | `scripts/deploy.mjs`        | The **one** service being deployed, from `deploy/services.json`. One entry is what keeps `--only appsail` narrow.      |
| `.catalystrc`                                 | ❌ No (generated)        | `scripts/deploy.mjs`        | Whichever target you deployed last. Local scratch — do not hand-edit (§1.5b).                                          |
| `backend/app-config.json`                     | ❌ No (generated)        | `scripts/deploy.mjs`        | `app-config.base.json` + the target's env file as `env_variables`. **Carries real secrets.**                           |
| CLI login (`%APPDATA%\zcatalyst-cli-nodejs\`) | ❌ No (outside the repo) | `catalyst login`            | Which **Zoho account** the CLI acts as. **Global — one per machine** (§1.5). Checked by `deploy.mjs`.                  |
| `<service>/.env.<target>`                     | ❌ No                    | you                         | One per target **per service**: its own database, secrets and `ZC_*` credentials. Template: `.env.production.example`. |
| `backend/.env`                                | ❌ No                    | you                         | **Local dev only.** Parked automatically during deploy so it is not uploaded.                                          |
| `web/.env.production`                         | ❌ No                    | you                         | Baked into the JS bundle at build time. Sets `VITE_API_URL=/api` — same for both targets.                              |
| `backend/dist/`                               | ❌ No                    | `npm run build`             | Compiled JavaScript. **Must exist before deploy.**                                                                     |
| `backend/public/`                             | ❌ No                    | `npm run build` (in `web/`) | The built React app. **Must exist before deploy.**                                                                     |
| `backend/node_modules/`                       | ❌ No                    | `npm ci`                    | Dependencies. **Must exist before deploy** — AppSail will not install them.                                            |
| `backend/generated/prisma/`                   | ❌ No                    | `prisma generate`           | The typed database client. Regenerated by `npm run build`.                                                             |
| `backend/certs/*.pem`                         | ✅ Yes                   | AWS                         | Amazon's public certificate. Contains no secrets.                                                                      |

---

## Part 9 — Troubleshooting

| Symptom                                                | Most likely cause                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `deploy: wrong Zoho account for target …`              | The CLI is logged in as the other environment's account. `catalyst logout && catalyst login`. |
| `deploy: … disagree about the destination`             | The target's env file has another target's `ZC_PROJECT_ID`/`ZC_PROJECT_KEY`/`ZC_ENVIRONMENT`. |
| `deploy: … still contains REPLACE_ME`                  | That target's Catalyst project has not been set up yet. See the file's `$comment` (§1.5b).    |
| App crash-loops, no clear error                        | **RDS unreachable from Zoho.** See Part 2, Step 0.                                            |
| `Invalid environment variables: …`                     | A variable is missing in the console. See Step 18.                                            |
| `Cannot find module 'express'`                         | `node_modules/` was not in `backend/` at deploy time.                                         |
| `Cannot find module '/app/dist/src/server.js'`         | You forgot `npm run build` in `backend/`.                                                     |
| Website is blank, but `/api/health` works              | `backend/public/` was empty — you forgot to build the frontend **first**.                     |
| Refreshing `/login` gives a 404                        | The SPA fallback in Step 9 is missing, or placed in the wrong order.                          |
| API returns HTML instead of JSON                       | The SPA fallback is missing its `req.path.startsWith('/api')` guard.                          |
| "Execution failed. Check the startup command or port." | `command` in `app-config.json` is wrong, or the app is listening on the wrong port (Step 8).  |

**Where to look:** Catalyst console → **AppSail → jobwork-api → Logs**. Our app logs the port it
bound to on startup (`server.ts:22`) and the exact reason for any boot failure (`server.ts:37`).
