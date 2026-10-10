# Zoho Books 2-Hour Auto-Synchronization Engine: Final Implementation Plan

> **Author / Role:** Principal Systems Architect  
> **Target Environment:** Express 5 + TypeScript Monolith, Zoho Catalyst AppSail, AWS RDS PostgreSQL (~79 Connection Ceiling)  
> **Infrastructure Cost:** **$0 Additional Cost** (100% native using existing compute and database)  
> **Core Objective:** Reliable, distributed background auto-synchronization for multi-tenant organizations on a 2-hour staggered cycle with zero web application disruption.

---

## 1. Executive Summary & Manager Presentation Pitch

### The 30-Second Elevator Pitch:

> _"We are implementing an automated, background synchronization engine for Zoho Books that syncs data incrementally every **2 hours** per module per organization. It runs as a **PostgreSQL-backed distributed queue** with zero external message broker dependencies (No Redis, No SQS, $0 added cost). It is strictly throttled to use **max 2 of our 79 database connections**, ensuring that our website users experience **zero lag** and normal web traffic is never starved."_

---

## 2. End-to-End System Topology

```mermaid
flowchart TD
    subgraph MultiAppSail["Catalyst AppSail Runtime Cluster"]
        subgraph WebLayer["Priority 1: User Web Traffic"]
            Express["Express 5 HTTP Handlers\n(Logins, Orders, Reports)\nReserved: 77 / 79 DB Connections"]
        end

        subgraph BackgroundLayer["Priority 2: Background Auto-Sync Workers"]
            Heartbeat["Scheduler Heartbeat (Every 30s)"]
            WorkerPool["Throttled Worker Pool (Concurrency = 2)\nCapped: Max 2 / 79 DB Connections\nYields Event Loop via setImmediate()"]
        end
    end

    subgraph PostgresDB["AWS RDS PostgreSQL (Shared Dev/Prod)"]
        QueueTable[("PostgreSQL Queue Table\n(zoho_sync_tasks)\nAtomic Dequeue: FOR UPDATE SKIP LOCKED")]
        HistoryTable[("Audit History Table\n(zoho_sync_history)")]
    end

    subgraph ExternalServices["External APIs"]
        ZohoAPI["Zoho Books Direct API\n(Incremental: last_modified_time)"]
    end

    Express -->|User Queries| PostgresDB
    Heartbeat -->|Scan Due Jobs (next_sync_at <= NOW)| QueueTable
    WorkerPool -->|Claim Next Task (SKIP LOCKED)| QueueTable
    WorkerPool -->|Fetch Delta Changes| ZohoAPI
    WorkerPool -->|Upsert in Micro-Chunks of 10| PostgresDB
    WorkerPool -->|Reset Lease & Set next_sync_at = NOW + 2h| QueueTable
    WorkerPool -->|Log Execution Summary| HistoryTable
```

---

## 3. The 4 Essential Architectural Pillars

### Pillar 1: PostgreSQL-Backed Queue & Crash Recovery

- **The Concept:** Instead of an ephemeral in-memory array that is destroyed whenever AppSail restarts or deploys, the database table **`zoho_sync_tasks` acts as the persistent queue**.
- **Queue States:** `IDLE` (Waiting for 2-hour window) $\rightarrow$ `SYNCING` (Leased by worker) $\rightarrow$ `FAILED` (Max retries exceeded) $\rightarrow$ `PAUSED`.
- **Crash Recovery Watchdog:** If an AppSail container restarts or crashes mid-sync, the heartbeat automatically reclaims abandoned tasks whose lease expired (`lock_expires_at < NOW()`) and resets them to `IDLE`.

```sql
-- Crash Recovery Query (Runs every 60 seconds)
UPDATE zoho_sync_tasks
SET status = 'IDLE', locked_by = NULL, locked_at = NULL, lock_expires_at = NULL
WHERE status = 'SYNCING' AND lock_expires_at < NOW();
```

---

### Pillar 2: Distributed Atomic Task Claiming (`FOR UPDATE SKIP LOCKED`)

- **The Concept:** When AppSail scales to multiple containers, instances must never process the same organization's module at the same time.
- **The Mechanism:** Workers lease the next available due task using standard PostgreSQL row locking:

```sql
-- Atomic Dequeue Query
WITH next_task AS (
  SELECT id
  FROM zoho_sync_tasks
  WHERE status = 'IDLE'
    AND next_sync_at <= NOW()
    AND (lock_expires_at IS NULL OR lock_expires_at < NOW())
  ORDER BY next_sync_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE zoho_sync_tasks
SET
  status = 'SYNCING',
  locked_by = $1, -- Unique instance ID (e.g. appsail-node:pid:uuid)
  locked_at = NOW(),
  lock_expires_at = NOW() + INTERVAL '10 minutes'
FROM next_task
WHERE zoho_sync_tasks.id = next_task.id
RETURNING zoho_sync_tasks.*;
```

---

### Pillar 3: Measured Resource Limits (Website Protection)

| Resource                    | Allocated Limit                    | Why It Protects Web Users                                                                                                                          |
| :-------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS RDS Connection Pool** | **Max 2 Connections**              | AWS RDS has a ~79 connection ceiling. Allocating max 2 connections to sync guarantees **77 connections (97.5%) are always open for web visitors**. |
| **Worker Concurrency**      | **Max 2 Tasks per Node**           | Prevents CPU spikes and memory exhaustion on the AppSail container.                                                                                |
| **Zoho API Rate Limiter**   | **Max 80 req/min per Org**         | Built-in sliding-window token bucket prevents Zoho `429 Too Many Requests` errors.                                                                 |
| **Event Loop Yielding**     | **`setImmediate()` every 10 rows** | Yields CPU time back to Node.js between database records, ensuring user HTTP requests are handled with **0ms latency**.                            |

---

### Pillar 4: Production Observability & Realistic SLOs

> [!IMPORTANT]
> **Operational Expectations:**
>
> 1. **Soft 2-Hour SLO:** The system guarantees that modules sync on a 2-hour cadence under normal loads. During network latency spikes or large data bursts, jobs queue gracefully without dropping work.
> 2. **Telemetry Metrics Monitored in Production:**
>    - **Task Lag:** $\text{Lag} = \text{Actual Execution Time} - \text{next\_sync\_at}$ (Alert if lag $> 15\text{ minutes}$).
>    - **Sync Duration:** Time taken per module (P50, P95).
>    - **Zoho API Throttling Rate:** Count of 429 rate-limit responses.
>    - **RDS Pool Saturation:** Active pool clients vs 79 limit.

---

## 4. Database Schema: `zoho_sync_tasks`

Add the dedicated task model to `prisma/schema/integrations.prisma`:

```prisma
/// Stores persistent queue state, schedules, and active distributed leases for Zoho synchronization.
model ZohoSyncTask {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String    @map("organization_id") @db.Uuid
  moduleKey      String    @map("module_key") @db.VarChar(50) // item | customer | vendor
  status         String    @default("IDLE") @map("status") @db.VarChar(30) // IDLE | SYNCING | FAILED | PAUSED
  lastSyncAt     DateTime? @map("last_sync_at") @db.Timestamptz(6)
  nextSyncAt     DateTime  @default(now()) @map("next_sync_at") @db.Timestamptz(6)
  lockedBy       String?   @map("locked_by") @db.VarChar(128)
  lockedAt       DateTime? @map("locked_at") @db.Timestamptz(6)
  lockExpiresAt  DateTime? @map("lock_expires_at") @db.Timestamptz(6)
  retryCount     Int       @default(0) @map("retry_count")
  lastError      String?   @map("last_error") @db.Text
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([organizationId, moduleKey], map: "uq_zoho_sync_tasks_org_module")
  @@index([status, nextSyncAt], map: "idx_zoho_sync_tasks_claim")
  @@index([status, lockExpiresAt], map: "idx_zoho_sync_tasks_recovery")
  @@map("zoho_sync_tasks")
}
```

---

## 5. Execution State Machine & Lifecycle

```
[ IDLE ] ──(next_sync_at <= NOW)──> [ CLAIMED / SYNCING (10m Lease) ]
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
                 [ SUCCESS ]                                  [ FAILURE ]
                      │                                            │
        next_sync_at = NOW + 2 Hours              next_sync_at = NOW + (15m * 2^retries)
              retry_count = 0                               retry_count += 1
              Release Lease                                  Release Lease
                      │                                            │
                      ▼                                            ▼
                  [ IDLE ]                                     [ IDLE ]
```

---

## 6. File-by-File Implementation Checklist

### Step 1: Database Migration

- [ ] Add `ZohoSyncTask` model to `prisma/schema/integrations.prisma`.
- [ ] Run project migration workflow:
      `npm run db:draft -- add_zoho_sync_tasks` $\rightarrow$ `npm run db:promote` $\rightarrow$ `npm run db:apply`.
- [ ] Add RLS policy for `zoho_sync_tasks` and register table in `src/db/rls.test.ts`.

### Step 2: Create Core Worker Engine (`zoho.auto-sync.worker.ts`)

- [ ] **Path:** `src/modules/integrations/zoho/zoho.auto-sync.worker.ts`.
- [ ] Implements `ZohoAutoSyncQueueManager` singleton.
- [ ] Runs 30-second heartbeat to claim tasks with `FOR UPDATE SKIP LOCKED`.
- [ ] Runs 60-second crash recovery watchdog to reclaim expired locks.
- [ ] Executes incremental sync via `executeInstantSync(orgId, moduleKey, undefined, { fullSync: false, syncMode: 'incremental' })`.
- [ ] Updates `next_sync_at` (+2 hours on success, exponential backoff on error).

### Step 3: Wire into Server Lifecycle (`src/server.ts`)

- [ ] Initialize worker **after `verifyDatabase()` passes** (ensures fast port-binding on AppSail).
- [ ] Register graceful shutdown on `SIGINT` / `SIGTERM` to drain active jobs cleanly.

### Step 4: Observability & Health Routes

- [ ] Controller: Add `getAutoSyncTelemetry` in `zoho.controller.ts`.
- [ ] Route: Register `GET /organizations/:orgId/settings/integrations/zoho/telemetry` in `zoho.routes.ts`.

### Step 5: Test Suite & Verification (`zoho.auto-sync.worker.test.ts`)

- [ ] Test 1: Task claiming under simulated multi-instance concurrency (no collisions).
- [ ] Test 2: Crash recovery watchdog resets expired leases.
- [ ] Test 3: Success state advances `next_sync_at` by 2 hours.
- [ ] Test 4: Failure triggers exponential backoff.
