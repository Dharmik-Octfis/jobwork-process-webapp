# Zoho Books Auto-Sync — every 2 hours, resumable, rate-budgeted

**Status: planned 2026-10-09. Nothing built.**

Pulls Items, Customers and Vendors from a tenant's connected Zoho Books organization into the
matching modules here, automatically every 2 hours, without a user pressing **Sync**. A manual sync
restarts the 2-hour clock. Must hold for many organizations, more modules later, and first syncs of
thousands of records.

The manual sync it builds on lives in `backend/src/modules/integrations/zoho/` and is reached from
**Settings → Integrations → Zoho Books**. §2 says why it cannot simply be put on a timer.

---

## 0. Decisions already taken (2026-10-09)

| Question                                         | Decision                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A record deleted **here** still exists in Zoho   | **Stays deleted.** Auto-sync never sets `isDeleted: false`; it counts the record as skipped.                                                |
| When the 2 hours start                           | From the **start** of the last **successful** run, manual or auto: `next_run_at = started_at + interval`.                                   |
| How much of the customer's Zoho API quota we use | Auto-sync spends at most **~60 %** of the organization's daily allowance; the rest is left for manual syncs and the customer's other tools. |
| A record deleted **in Zoho**                     | **Deferred.** Nothing is built for it (§12). The link table in §4.3 is all a later reconcile needs.                                         |
| Who creates the Catalyst cron and job pool       | **A person, per environment, from the runbook in §11** — not a script, not on deploy.                                                       |

## 1. What it is, in one paragraph

Postgres holds the schedule: each (organization, module) row has a `next_run_at`. A Catalyst cron
fires every 5 minutes and calls one internal endpoint, the **tick**. The tick claims a few due rows
with `FOR UPDATE SKIP LOCKED`, and for each one runs **one chunk** — one Zoho page, at most ~200
records — and commits the records, the cursor and the watermark in the same transaction. A job with
more pages stays queued for the next tick. A finished job sets the next `next_run_at`. The manual
**Sync** button enqueues the same job at high priority, so manual and auto are one code path.

The cron is only a clock. Correctness lives in the database, so the clock can be swapped (Job
Scheduling, Cloud Scale cron, a local script) without touching the code.

## 2. Why the current manual sync cannot be scheduled as-is

Read end to end on 2026-10-09. Line numbers are `zoho.api.service.ts` unless stated.

| #   | Finding                                                                                                                                          | Where                               | Consequence once it runs every 2 hours                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | 🔴 Sync settings — field mappings, status, `lastSyncAt`, `autoSyncInterval` — live in an in-process `Map`, not the database.                     | `:29`, `:959`, `:1018`, `:2535`     | A restart or deploy loses them; each AppSail instance has its own copy. The next run is a first sync again and custom mappings revert to defaults. |
| F2  | 🔴 Fetch failures are swallowed and the watermark advances anyway: a non-200 page `break`s, any exception returns `[]`, then `lastSyncAt = now`. | `:1206–1211`, `:1288–1290`, `:2525` | A 429 or timeout on page 3 drops pages 3+ **permanently** — the next run only asks for changes after a point it never reached. Silent data loss.   |
| F3  | Hard cap `maxPages = 50` (10,000 records), no warning.                                                                                           | `:1173`                             | Large first syncs are truncated and reported as successful.                                                                                        |
| F4  | When nothing is fetched, a first or full sync reports the local row count — or the literals 5 / 4 / 3 — as "migrated".                           | `:2485–2506`                        | Sync history shows numbers that never happened.                                                                                                    |
| F5  | One Zoho `GET /contacts/:id` per customer/vendor, and one `runAsTenant` transaction per record.                                                  | `:1947`, `:2000`, `:2126`           | N+1 on both sides. 5,000 contacts ≈ 5,000 Zoho calls — more than the Standard plan's **2,000/day** — and ≈ 5,000 transactions.                     |
| F6  | Records are matched every run by name / email / SKU. The Zoho id survives only inside `sku = ZOHO-…` or `customFields.zoho_item_id`.             | `:2016–2026`, `:2137–2147`          | A rename in Zoho creates a duplicate. Two concurrent runs can both decide "not found" and both create.                                             |
| F7  | An update sets `isDeleted: false`.                                                                                                               | `:2056`                             | Contradicts decision 1 (§0): a locally deleted record reappears every 2 hours.                                                                     |
| F8  | The whole sync runs inside the HTTP request.                                                                                                     | `zoho.controller.ts:237–242`        | Fine at 50 records, cannot finish within a request at 10,000.                                                                                      |
| F9  | No lock per (organization, module); token refresh is not serialised.                                                                             | `zoho.token.service.ts:49–134`      | A manual and an auto run overlap; each refreshes the token, and Zoho caps active access tokens per refresh token.                                  |
| F10 | Raw Zoho values are written into `customFields` without `validateCustomFields`.                                                                  | `:1974`, `:2051`                    | Breaks the CLAUDE.md custom-fields rule; a wrong type from Zoho is stored as-is.                                                                   |

**F1 and F2 block auto-sync outright.** Everything else is cost or correctness that a timer turns
from occasional into routine.

## 3. Constraints the design is shaped by

**Zoho Books API** ([introduction](https://www.zoho.com/books/api/v3/introduction/)) — per Zoho
organization, and shared with everything else the customer runs against it:

| Limit             | Free  | Standard  | Professional | Premium and above |
| ----------------- | ----- | --------- | ------------ | ----------------- |
| Requests / day    | 1,000 | 2,000     | 5,000        | 10,000            |
| Requests / minute | 100   | 100       | 100          | 100               |
| Concurrent calls  | 5     | 10 (soft) | 10 (soft)    | 10 (soft)         |

Over the limit → HTTP **429**.

**Zoho OAuth** ([token limits](https://www.zoho.com/accounts/protocol/oauth/token-limits.html)): a
refresh token may hold a limited number of active access tokens (10 per the official page). Reuse the
access token until it expires; never refresh per job.

**Catalyst:** Cloud Scale Cron repeats at most **hourly**; Job Scheduling Cron repeats down to **1
minute** and can target **AppSail**. Every invocation is time-bounded, so no unit of work may be "the
whole sync". Job Scheduling is marked early access, and Circuits are not offered in the `in` data
centre production runs in.

**Our database:** the dev RDS caps at ~79 connections, so total worker concurrency is a fixed small
number, never "one per organization".

## 4. Data model

All three tables carry `organization_id` and get a **direct** RLS policy (`organization_id =
current_tenant`) written into the migration by hand, plus an entry in `TENANT_TABLES` — `db:draft`
will not generate either (CLAUDE.md, "migrate diff is blind to RLS").

### 4.1 `integration_sync_configs` — replaces the in-memory `Map` (F1)

One row per organization × provider × module.

```prisma
model IntegrationSyncConfig {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId      String    @map("organization_id") @db.Uuid
  provider            String    @db.VarChar(30)  // ZOHO_BOOKS
  module              String    @db.VarChar(50)  // item | customer | vendor
  status              String    @default("ACTIVE") @db.VarChar(20) // ACTIVE | PAUSED | INACTIVE
  direction           String    @default("ZOHO_TO_APP") @db.VarChar(20)
  fieldMappings       Json      @default("[]") @map("field_mappings")
  duplicationPreference String  @map("duplication_preference") @db.VarChar(50)
  conflictResolution  String    @map("conflict_resolution") @db.VarChar(50)
  syncAddresses       Boolean   @default(true) @map("sync_addresses")
  syncContactPersons  Boolean   @default(true) @map("sync_contact_persons")
  intervalMinutes     Int       @default(120) @map("interval_minutes")
  nextRunAt           DateTime? @map("next_run_at") @db.Timestamptz(6)   // THE schedule
  watermarkAt         DateTime? @map("watermark_at") @db.Timestamptz(6)  // Zoho last_modified_time fully stored
  lastSuccessAt       DateTime? @map("last_success_at") @db.Timestamptz(6)
  lastError           String?   @map("last_error") @db.Text
  consecutiveFailures Int       @default(0) @map("consecutive_failures")
  // + the five audit columns (users edit mappings here)

  @@unique([organizationId, provider, module])
  @@index([nextRunAt], map: "idx_sync_configs_due")  // partial in SQL: WHERE status = 'ACTIVE'
  @@map("integration_sync_configs")
}
```

### 4.2 `integration_sync_jobs` — one row per run (F8, F9)

| Column                                                            | Purpose                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `config_id`, `organization_id`                                    | which module                                          |
| `trigger` (`auto \| manual \| full`)                              | why it ran                                            |
| `priority` (int, manual = high)                                   | claim order                                           |
| `state` (`queued \| running \| succeeded \| failed \| cancelled`) |                                                       |
| `cursor` jsonb                                                    | `{ page, watermarkAtStart, phase }` — where to resume |
| `lease_until` timestamptz                                         | a running job whose lease expired is reclaimable      |
| `run_after` timestamptz                                           | backoff after a 429 / error                           |
| `attempt` int                                                     | retry count for backoff                               |
| `added`, `updated`, `skipped`, `failed` int                       | real counters — no fallbacks (F4)                     |
| `error_logs` jsonb (capped), `last_error`                         | per-record failures                                   |
| `requested_by` uuid null, `started_at`, `finished_at`             | `requested_by` is null for auto                       |

**At most one active run per module is a database rule:**

```sql
CREATE UNIQUE INDEX uq_sync_jobs_one_active
  ON integration_sync_jobs (config_id)
  WHERE state IN ('queued', 'running');
```

A manual click while a run is active hits this index and gets the existing job back instead of a
second one.

`zoho_sync_history` stays as the history the UI already reads; one row is written when a job
finishes.

### 4.3 `integration_record_links` — identity by Zoho id (F6)

`(organization_id, provider, entity_type, external_id) UNIQUE → local_id`, plus
`external_modified_at` and `payload_hash`. Name/email/SKU matching (the configured duplication
preference) happens **only the first time** a Zoho id is seen; every later run looks up by id. The
hash lets a run skip writing an unchanged record.

Backfill: existing `sku = 'ZOHO-<id>'` and `customFields.zoho_item_id` values seed the table, so
records already synced are not matched by name again.

### 4.4 The tick must find due rows across tenants — under RLS

The tick has no tenant: "which configs are due?" spans every organization, and `jobwork_app`
under RLS sees none. Do **not** connect as the owner or bypass RLS for this. Use one narrow
`SECURITY DEFINER` function, owned by the migration role, that claims and returns ids only:

```sql
-- returns only identifiers; every read/write of the job's data happens later inside runAsTenant
claim_due_sync_jobs(p_limit int, p_lease interval)
  RETURNS TABLE (job_id uuid, organization_id uuid, module varchar)
```

It (1) inserts a `queued` job for each due active config that has none, (2) selects claimable jobs
— `queued` with `run_after <= now()`, or `running` with `lease_until < now()` — ordered by
`priority, run_after`, `FOR UPDATE SKIP LOCKED LIMIT p_limit`, (3) marks them `running` with a
lease, and returns the ids. Everything after that is ordinary `runAsTenant(organizationId, …)`.

_Alternative considered:_ a schedule table with no RLS, like `memberships`. Rejected — it would be
a deliberate hole in `TENANT_TABLES` that the next table copies.

## 5. Behaviour

### 5.1 Scheduling

- Successful run (any trigger): `next_run_at = job.started_at + interval_minutes`.
- New connection or newly activated module: `next_run_at = now() + random(0..10 min)` — jitter, so
  organizations that connect together do not sync together forever.
- Paused / inactive module, or integration not `CONNECTED`: no job is created.
- One indexed column scales to any number of tenants. **No per-organization Catalyst cron** —
  dynamic crons do not migrate to production and are invisible in bulk.

### 5.2 Chunking and resume

A tick runs each claimed job for **one page** (≤ 200 records) or until the tick's **20 s
deadline**, whichever is first, then commits records + cursor + watermark together. The budget
assumes a **30 s per-request limit** in front of AppSail (unconfirmed for AppSail — Q6) and leaves
10 s of headroom. Because a deadline can land mid-page (contact detail calls are the slow part),
the cursor carries the **offset within the page** as well as the page number.

Two rules follow from the time limit:

- **Nothing runs after the response is sent.** A gateway that cuts the request at 30 s does not stop
  Node, and an instance may be scaled down once idle — so "respond, then keep working" is work
  that silently dies. Every unit of work finishes and commits before the tick responds.
- **One page's write fits Prisma's interactive-transaction default (5 s).** With §5.5's bulk shape
  a 200-record page should take well under that; if it does not, shrink the page — do not raise
  `timeout` (CLAUDE.md, "Query shape"). More pages → job back to `queued`, `run_after =
now()`. A crash leaves the lease to expire; the next tick resumes from the last committed page.
  Writes are idempotent upserts on `external_id`, so a repeated page is harmless. F3's cap and F8's
  request timeout disappear.

### 5.3 Watermark (F2)

- The watermark is the **Zoho record's `last_modified_time`**, never our clock.
- It advances **only** after the page's write commits. A failed or partial fetch never advances it.
- Each incremental run re-reads a few minutes of overlap; idempotent writes make that free.
- 🔴 **Verify before building:** that `last_modified_time` works as a **list filter** on
  `/books/v3/items` and `/books/v3/contacts`. It is not confirmed, and the current code's fallback
  (`:1236–1274`) suggests someone was unsure. The safer shape is `sort_column=last_modified_time&
sort_order=D`, paging until a record is older than the watermark. Decide against a real Zoho org.

### 5.4 Rate budget

- Per-Zoho-organization counters in Postgres (calls today, calls this minute), so every instance
  sees one number.
- Checked **before** every call. Auto-sync stops at ~60 % of the daily allowance (§0).
- Plan allowance: read from Zoho if exposed, else a per-integration setting defaulting to 2,000.
- 429 → stop the chunk, `run_after` = retry time (respect `Retry-After` if sent). Never retry in a
  loop.
- Contact detail calls (F5): only when the contact's `last_modified_time` moved **and** addresses or
  contact persons are enabled. A large first contact sync may span days on low plans — the UI says
  so ("2,140 of 5,000 contacts synced; continuing").

### 5.5 Writes — one round trip per page (F5, F10, F7)

Inside one `runAsTenant` per page:

1. Links for the page in one query: `external_id IN (…≤200)`.
2. Distinct categories / units / payment terms / currencies resolved once per page, not per record.
3. `createMany` for new records; update only where `payload_hash` changed.
4. Custom fields through `loadActiveDefinitions` + `validateCustomFields`.
5. A linked record that is `isDeleted` here is **skipped**, never restored.

### 5.6 Failure handling

| Failure                   | Response                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| 429, network, 5xx         | Backoff 5 → 15 → 45 min via `run_after`; cursor kept.                                            |
| Token revoked / expired   | Integration → `TOKEN_EXPIRED`; schedule **paused**; UI shows "Reconnect Zoho Books". No retries. |
| One bad record            | Counted `failed`, reason in `error_logs`; the page continues.                                    |
| 5 consecutive failed runs | Module auto-paused, `last_error` shown.                                                          |
| Worker dies mid-chunk     | Lease expires; next tick reclaims.                                                               |

Token refresh is serialised per organization (`pg_advisory_xact_lock` on the integration id, or a
conditional `UPDATE … WHERE expires_at < now()` that one worker wins). All jobs of an organization
share the one access token.

### 5.7 Manual sync moves onto the queue

- `POST /sync/instant` and `/sync/all` **enqueue** (priority high) and return the job id(s) at
  once — 200 envelope, per CLAUDE.md (no 204).
- New `GET /sync/jobs/:id` for progress; the UI polls it while a job is active.
- An active run for that module → the existing job is returned (§4.2 index).
- A successful manual run moves `next_run_at` exactly like an auto run (§5.1).

### 5.8 The tick endpoint

`POST /api/internal/integrations/sync/tick`

- 🔴 **A deliberate exception to the three-middleware rule**: no user, no org, so no
  `authenticate` / `tenantContext` / `requirePermission`. Its gate is a shared secret header
  (`X-Sync-Tick-Secret`) compared in constant time against `SYNC_TICK_SECRET`. Missing or wrong → 401. Unset on the server → the route is not mounted.
- Mounted before `/organizations` in `routes/index.ts`.
- Kill switch: `ZOHO_AUTO_SYNC_ENABLED=false` → 200, `data: { claimed: 0 }`, does nothing.
- Bounded: claims at most `K` (start 20) jobs, runs at most `W` (start 4) concurrently — separate
  `runAsTenant` calls, so `Promise.all` genuinely overlaps here — stops starting work at the 20 s
  deadline (§5.2), and responds with `{ claimed, completed, requeued, failed }`. A job it claimed
  but did not reach goes back to `queued` with its lease cleared, not left to expire.

## 6. Capacity check

1,000 organizations × 3 modules / 2 h ≈ 1,500 jobs per cycle ≈ 12–13 / min. A typical incremental
job is 1–2 Zoho calls and one transaction. A 5-minute tick with K = 20, W = 4 clears that with room
to spare on ~4 connections. Per Zoho organization: 12 runs × 3 modules × ~1–2 calls ≈ 40–70
calls/day from auto-sync — inside even the Free plan's 1,000.

## 7. Rejected alternatives

| Alternative                            | Why not                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `setInterval` / `node-cron` in Express | Fires on every instance; dies on deploy or scale-down; nothing watches it.                            |
| Cloud Scale Cron hourly                | Up to 59 min late. Kept as the **fallback clock** (§11.6) — correctness does not depend on the clock. |
| Redis / BullMQ                         | New infrastructure for what `SKIP LOCKED` already does at this scale.                                 |
| One Catalyst cron per organization     | §5.1.                                                                                                 |
| Whole sync per request (today)         | F8.                                                                                                   |

## 8. UI changes

- Module card: **Last synced**, **Next sync** (`next_run_at`), status chip (Active / Paused /
  Needs reconnect), and a live progress line while a job runs.
- **Sync** button → enqueues; shows "Queued" / "Syncing… page n" from `GET /sync/jobs/:id`.
- History keeps reading `zoho_sync_history`; counters are now real (F4).
- Short field messages per CLAUDE.md; responsive and keyboard rules apply to any new control.

## 9. Build order

Each step is shippable and leaves manual sync working.

1. **Persist config** — `integration_sync_configs` (+ RLS, `TENANT_TABLES`); move every
   `tenantSyncSettingsStore` read/write onto it; delete the `Map` and `tenantSyncLogsStore`. _(F1)_
2. **Correct the pull** — errors propagate; watermark from Zoho's timestamps, advanced only after
   commit; remove `maxPages` cap and the fallback counts; resolve §5.3's verification. _(F2–F4)_
3. **Links + batch writes** — `integration_record_links` with backfill; per-page transaction; custom
   fields validated; never restore deleted. _(F5–F7, F10)_
4. **Jobs + claim function + worker** — `integration_sync_jobs`, `claim_due_sync_jobs`, chunk runner;
   manual sync enqueues; `GET /sync/jobs/:id`; UI progress. _(F8, F9)_
5. **Rate budget + token lock.** _(§5.4, §5.6)_
6. **Tick endpoint + `npm run sync:tick`** — test locally and on staging by calling it by hand.
7. **Runbook §11 on staging, then production.** Only after step 6 is deployed and hand-tested;
   a cron created earlier just fires failing requests.
8. **Retention** for `integration_sync_jobs` and `zoho_sync_history`.

Tests (per CLAUDE.md, own fixtures, hard-deleted): resume after a simulated mid-run failure leaves
no gap; watermark unchanged after a failed page; two concurrent claims never return the same job;
manual click during an active run returns the same job; a locally deleted record is not restored;
RLS — a job for org A never reads org B.

## 10. Configuration

| Key                         | Where                   | Notes                                                        |
| --------------------------- | ----------------------- | ------------------------------------------------------------ |
| `SYNC_TICK_SECRET`          | `backend/.env.<target>` | ≥ 32 random bytes, different per target. Never in git.       |
| `ZOHO_AUTO_SYNC_ENABLED`    | `backend/.env.<target>` | `false` = tick does nothing. Default `false` until §11 done. |
| `SYNC_TICK_MAX_JOBS` (K)    | optional, default 20    |                                                              |
| `SYNC_TICK_CONCURRENCY` (W) | optional, default 4     | Counts against the DB pool.                                  |

Add both required keys to `deploy/services.json` → `api.requiredEnv` only once the feature ships,
so a deploy without them is refused rather than booting with a dead tick.

## 11. Runbook — Catalyst cron and job pool

Done **by a person, once per environment**, after step 6 is deployed. Staging and production are
**different Zoho accounts** (`deploy/targets.json`), so each needs its own pool and cron, and
nothing created in one appears in the other — Catalyst's "pre-defined crons migrate on deploy"
applies within one project only.

Console field names below are from the Catalyst docs, not walked yet. **Correct this section on
the first real setup.**

### 11.1 Before you start

- [ ] You are signed in to the Catalyst console as the account in `deploy/targets.json` for this
      target — staging `jay.v@octfis.com` (`com`), production `user1@demo14.octfis.in` (`in`).
      The wrong account is the easiest mistake here and nothing will warn you.
- [ ] The api build with the tick endpoint is deployed to this target.
- [ ] `SYNC_TICK_SECRET` is set in `backend/.env.<target>` and that env was deployed.
- [ ] `ZOHO_AUTO_SYNC_ENABLED=false` for now.
- [ ] Hand test passes: `POST https://<api-url>/api/internal/integrations/sync/tick` with the header
      returns 200 `{ claimed: 0 }`; without it returns 401.
- [ ] **Job Scheduling is available** in this project (console → project → _Job Scheduling_). If it
      is not, use §11.6 instead.

### 11.2 Create the job pool

| Field        | Value                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Name         | `zoho-sync-tick`                                                                                                   |
| Type         | **AppSail** — target `jobwork-api` (the `api` AppSail; check the deploy banner's `AppSail :` line for this target) |
| Max parallel | **1** — overlapping ticks are safe (`SKIP LOCKED`) but pointless                                                   |
| Request      | `POST /api/internal/integrations/sync/tick`, header `X-Sync-Tick-Secret: <secret>`                                 |

If the AppSail pool type cannot set a path or a header, use a **Webhook** pool instead with the
full URL `https://<api-url>/api/internal/integrations/sync/tick`, method POST, and the same
header. Record which one worked here.

### 11.3 Create the cron

| Field    | Value                                                      |
| -------- | ---------------------------------------------------------- |
| Name     | `zoho-sync-tick`                                           |
| Kind     | **Pre-defined** (console), never dynamic                   |
| Schedule | Cron expression `*/5 * * * *`, time zone UTC               |
| Job pool | `zoho-sync-tick`                                           |
| Retries  | **0** — the next tick is the retry                         |
| Alerts   | Application Alerts on failure / timeout → the team mailbox |

### 11.4 Turn it on and verify

1. Set `ZOHO_AUTO_SYNC_ENABLED=true` in `backend/.env.<target>`; deploy the api.
2. Within 10 minutes the cron's execution history shows **200**s every 5 minutes.
3. For a connected test organization, `integration_sync_jobs` gains `succeeded` rows and its
   config's `next_run_at` moves 2 hours past the run's `started_at`.
4. Press **Sync** on that organization; confirm `next_run_at` moves to 2 hours after that run.

### 11.5 Stop or roll back

- **Stop syncing, keep everything:** `ZOHO_AUTO_SYNC_ENABLED=false` + deploy. Ticks still arrive
  and do nothing.
- **Stop the clock:** disable the cron in the console. Jobs simply wait; nothing is lost, and the
  first tick after re-enabling picks up every overdue module.
- A secret leak: rotate `SYNC_TICK_SECRET` in the env file **and** the pool's header together.

### 11.6 Fallback — no Job Scheduling on this account

Create a **Cloud Scale → Cron** instead: recurring every **1 hour**, target **URL**
`https://<api-url>/api/internal/integrations/sync/tick`, POST, same header. Syncs then start up to
59 minutes late. No code change — the database decides what is due. Raise K so an hourly tick still
clears the backlog.

### 11.7 Local development

No Catalyst cron locally. `npm run sync:tick` (backend) posts to
`http://localhost:3000/api/internal/integrations/sync/tick` with the secret from `backend/.env`.
Run it by hand, or in a loop while testing.

## 12. Open questions

| #   | Question                                                                                                                                                                                                                                          | Status                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Q1  | Records deleted **in Zoho**: weekly/nightly ID reconcile now, webhooks later? Locally soft-delete unused records, flag "Removed in Zoho" on referenced ones? Webhook delete-trigger support is unverified.                                        | **Deferred by the user.**                           |
| Q2  | Does `last_modified_time` work as a list filter on items and contacts? (§5.3)                                                                                                                                                                     | Verify in step 2.                                   |
| Q3  | Can the customer's Zoho plan / daily allowance be read from the API? (§5.4)                                                                                                                                                                       | Verify in step 5.                                   |
| Q4  | Job Scheduling availability and the exact AppSail-pool fields on both accounts. (§11)                                                                                                                                                             | Verify at §11.1.                                    |
| Q5  | Do `integration_sync_jobs` / `integration_record_links` need the five audit columns? Proposed: no — system-written operational rows, like `zoho_sync_history`. `custom_fields` on none of the three: they are not business data.                  | Confirm at review.                                  |
| Q6  | Per-request time limit in front of AppSail (browser calls **and** the job pool's call to the tick). Planned for 30 s (§5.2's 20 s deadline); the Catalyst docs read so far state 30 s only for Basic/Advanced I/O functions, nothing for AppSail. | Verify at §11.1 — time a deliberately slow request. |
