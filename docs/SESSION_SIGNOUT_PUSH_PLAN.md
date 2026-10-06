# Instant sign-out in every tab — push instead of poll

> **Status: ⏸️ DEFERRED 2026-10-06 — nothing here is built, and nothing changes now.** Written
> 2026-10-05, reviewed end to end 2026-10-06 (§0 records the outcome). Replaces the 15-second poll
> in `web/src/features/auth/useSessionWatch.ts` with a server push. Read §2 before changing any
> code that ends a session, and §8 before building — three facts about AppSail are still unverified.
>
> Builds on: `SSO_AND_IDENTITY.md` §10 (back-channel logout) and §11 (cross-tab sign-out — this
> is the "SSE / WebSocket from our own backend" row of its table). Revisits
> `ARCHITECTURE_AND_TECH_STACK.md` §3.12, which chose polling — see §9 here.

---

## 0. Decision 2026-10-06 — what stays, what happens later

The plan was checked against the code and found sound: the three revoke sites are exactly the three
in §2, `compression()` really is global so `no-transform` is load-bearing, `EventSource` really
cannot carry the Bearer token, and the "payload is a hint, re-read the row" rule means no forged or
stale notification can sign out a live session. **Nothing in it is built, and nothing is being
changed today.** The poll stays exactly as it is.

**Why it is deferred, not dropped.** At today's scale (QC, no real customers) the poll is noise:
one indexed `findFirst` per visible tab per 15 s, and hidden tabs catch up the instant they regain
focus, which is the first moment anyone could see the sign-out. The security bound is identical
either way — `refresh` is the only enforcement point and 15 minutes the worst case (§6). The push
plan buys latency (≤15 s → ~1 s), and at 100–150 customer companies it also buys pool time, which is
the figure that actually runs out first:

| Poll interval | Visible tabs at peak | Requests/s | Pooled connections held by polling alone (of 25) |
| ------------- | -------------------- | ---------- | ------------------------------------------------ |
| 15 s (today)  | 300–600              | 20–40      | 5–10                                             |
| 5 s           | 300–600              | 60–120     | 15–30 — **saturates the pool on its own**        |

One round trip from AppSail to RDS costs ~255 ms (`db/prisma.ts`), so every poll holds one of an
instance's 5 pooled connections for that long. Postgres itself is nowhere near busy; the pool is.
**So the poll interval is NOT to be lowered as a cheap fix** — that was considered and rejected on
this arithmetic. Push, by contrast, costs one `LISTEN` connection per instance (5 in total) and zero
steady-state queries, which is the shape that scales.

**What we do later, in this order:**

1. **Run §8 on staging before go-live** — a throwaway SSE route streaming a comment line every 10 s
   for 10 minutes. Watch whether lines arrive live or in a burst (8.1), when the connection is cut
   (8.2), and DevTools' Protocol column (8.3). About an hour. This decides everything below.
2. **If 8.1 passes and 8.2 is ≥ ~5 min →** build the plan as written, in §10's order, before go-live.
3. **If 8.1 fails or 8.2 is short →** keep polling and build the per-browser leader poll instead: one
   tab per browser holds `navigator.locks.request('jobwork-session-watch', …)` (the same lock pattern
   `web/src/api/client.ts` already uses for single-flight refresh), polls, and relays over a
   `BroadcastChannel`; followers re-check with their own `fetchSessionStatus()` before signing out
   (§5.2's reasoning). That divides the table above by the tabs-per-browser factor and is the best
   polling can do on this host.
4. **Either way, watch `waiting` in the `requestTiming` log line** once real customers arrive. A
   non-zero `waiting` under light load means the pool is the bottleneck — act on that measurement,
   not on the estimates above.

**Scope reminder, so nobody expects more than this delivers.** Push announces revokes faster; it
does not change _which_ sessions a sign-out revokes. A normal sign-out is per browser by design:
jobwork revokes that browser's own row, and accounts' back-channel logout carries that browser's SSO
`sid` (`accounts/src/oidc/clients.ts` sets `backchannel_logout_session_required: true`), so another
device keeps its session. Only password reset and account disable cross devices, because
`revokeAllSessions` revokes every row. Tabs of one browser always move together — they share the
refresh cookie, hence one session row.

---

## 1. Why we are doing this

### 1.1 The problem today

`authenticate` checks the JWT's signature and expiry and **never reads the database** — a deliberate
throughput decision from 2026-07-24 (CLAUDE.md, `middlewares/authenticate.ts`). So when a session
ends somewhere else, an open tab keeps working until its access token lapses, up to **15 minutes**.
A session ends somewhere else when:

- the user signs out of another Octfis app (SSO back-channel logout, `sso.controller.ts`
  `backchannelLogout`)
- the user signs out in another tab or device (`auth.service.ts` `logout`)
- their password is reset (`auth.service.ts` → `revokeUserSessions(…, 'password_reset')`)
- their account is disabled (`refresh` → `revokeUserSessions(…, 'account_disabled')`)

On a shared shop-floor terminal, "I logged out and the screen kept working" undoes the whole point of
logging out.

Since 2026-08-27 this is covered by a poll: every visible tab calls `GET /api/auth/session` every
15 seconds, plus once each time the tab regains focus. It works, but:

| Problem with the poll        | Detail                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constant traffic             | ~4 requests a minute per open tab, all day, whether or not anything happened. 10 tabs = 40 req/min.                                                                                                                          |
| Not instant                  | Up to 15 s late. Feels broken next to Zoho.                                                                                                                                                                                  |
| Background tabs don't notice | React Query pauses `refetchInterval` while a tab is hidden, so a hidden tab only catches up on focus. Mostly cosmetic: focus is the first moment anyone could see it, and nothing here does work in a hidden tab on its own. |
| Cost scales with tabs        | Each poll is a DB query; the load grows with open tabs, not with how often anyone signs out.                                                                                                                                 |

### 1.2 What Zoho does (observed, 2026-10-05)

In Zoho Books, DevTools → Network → **Socket** shows long-lived WebSockets
(`pconnect?prd=ZB&wmsid=…`, status `101`) opened by a hidden `wms` iframe (Zoho's WebMessaging
Service). One stayed open 3.1 minutes, closed, and was replaced by a new one. **Fetch/XHR shows no
repeated session calls.** Signing out of one Zoho app signs out every other Zoho tab within ~5 s
without touching them.

That is **server push**: each tab holds one open connection, and the server sends a message down it
when the session ends. Requests are made only when something happens. We are copying that shape.

> We have not read Zoho's code; the above is what the Network tab shows. The design below does not
> depend on Zoho's internals being exactly this.

### 1.3 What we get

|                                    | Poll (today)               | Push (this plan)                       |
| ---------------------------------- | -------------------------- | -------------------------------------- |
| Time from sign-out to tab reacting | ≤ 15 s (visible tabs only) | ~1 s, hidden tabs included             |
| Requests while nothing happens     | 4/min per tab              | 0 (one open stream + a tiny heartbeat) |
| DB queries while nothing happens   | 4/min per tab              | 0                                      |
| Works across server instances      | ✅                         | ✅ (§4)                                |

**Not in scope:** the _sign-in_ direction (signing in on one tab lights up another logged-out tab).
A logged-out tab has no session to open a stream with. That still needs the accounts-origin iframe
from `SSO_AND_IDENTITY.md` §11 and stays deferred.

---

## 2. The rule this plan adds

> 🔴 **Every write that sets `refresh_tokens.revoked_at` must go through one helper,
> `endSessions()`, which publishes the event in the same transaction.**

Today there are **three** places that stamp `revoked_at`, written three different ways:

| Where                                       | How it ends sessions                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| `lib/authGuards.ts` `revokeUserSessions`    | `updateMany({ userId, revokedAt: null })`                     |
| `auth.service.ts` `markSessionRevoked`      | `updateMany({ id \| token, revokedAt: null })`                |
| `sso/sso.controller.ts` `backchannelLogout` | `updateMany({ idpSessionId \| idpSubject, revokedAt: null })` |

A fourth site that forgets to publish **fails silently**: the session is revoked, but no tab hears
about it until the next reconnect or focus check (§6.4). That is the same failure shape as a tenant
table with no RLS policy, so it gets the same treatment — one helper, and a test that greps for
`revokedAt: new Date()` outside it (§7).

---

## 3. Architecture

```
 Browser (one stream per BROWSER, not per tab — §5.2)
 ┌───────────────────────────────────────────────────────────────┐
 │ leader tab ── GET /api/auth/events (SSE, Bearer) ─────────┐    │
 │    │ BroadcastChannel('session')                          │    │
 │    ▼                                                      │    │
 │ other tabs                                                │    │
 └───────────────────────────────────────────────────────────┼────┘
                                                             │
               AppSail load balancer — any instance          │
 ┌──────────────────┐   ┌──────────────────┐   ┌─────────────▼────┐
 │ Instance 1       │   │ Instance 2       │   │ Instance 3       │
 │ streams: {…}     │   │ streams: {…}     │   │ streams: {u42}   │
 │ LISTEN ──┐       │   │ LISTEN ──┐       │   │ LISTEN ──┐       │
 └──────────┼───────┘   └──────────┼───────┘   └──────────┼───────┘
            │                      │                      │
            └──────────────┬───────┴──────────────────────┘
                           │  Postgres delivers each NOTIFY to every listener
                    ┌──────┴───────┐
                    │  PostgreSQL  │◄── Instance 2: UPDATE refresh_tokens SET revoked_at …
                    └──────────────┘          + pg_notify('session_ended', '{"userIds":["u42"]}')
                                              in the SAME transaction
```

The flow when user `u42` signs out in another app:

1. The accounts service calls `POST /api/auth/sso/backchannel-logout`. The load balancer sends it to
   **any** instance — say Instance 2.
2. Instance 2 calls `endSessions()`: stamps `revoked_at` on the matching rows **and** runs
   `pg_notify('session_ended', …)` in one transaction.
3. On commit, Postgres delivers the notification to **every** instance that is `LISTEN`ing —
   including Instance 2 itself.
4. Instance 3 holds a stream for `u42`. It re-reads that stream's session row (one query), sees it
   is revoked, sends `event: ended` down the stream, and closes it.
5. The leader tab receives it, broadcasts to the other tabs of that browser, and all of them run the
   existing sign-out (toast → clear session → `/login`).

Which instance handled the **login** is irrelevant at every step. Sessions live in `refresh_tokens`,
not in any instance's memory.

---

## 4. Backend

### 4.1 `endSessions()` — the one way to end a session

New file `backend/src/modules/auth/sessionEvents.ts`.

```ts
type SessionWhere = Prisma.RefreshTokenWhereInput; // id | token | userId | idpSessionId | idpSubject

export async function endSessions(
  where: SessionWhere,
  reason: RevokeReason | 'sso_logout',
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const run = async (tx: Prisma.TransactionClient) => {
    // read the affected users first — updateMany returns only a count
    const rows = await tx.refreshToken.findMany({
      where: { ...where, revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (rows.length === 0) return 0;

    const { count } = await tx.refreshToken.updateMany({
      where: { ...where, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    // delivered only on COMMIT — a rolled-back revoke never signs anyone out
    await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({ userIds: rows.map((r) => r.userId) })})`;
    return count;
  };

  // already inside a transaction (password reset) → join it; otherwise open one
  return isTransaction(client) ? run(client) : prisma.$transaction(run);
}
```

Design notes:

- **The payload is a hint, not the truth.** It carries only `userIds`. A listener never signs a tab
  out because a message said so — it re-reads the row (§4.4). So a forged, duplicated or stale
  notification can cause at most one extra query, never a wrong sign-out.
- **User ids, not session ids.** The back-channel path ends sessions by `idpSessionId` / `idpSubject`
  and never sees our `sid`s. User ids are always known, and the listener narrows to the right streams.
- **`pg_notify` payload limit is 8000 bytes.** A user id is 36 chars, so one notification fits ~200
  users. `endSessions` is per-user or per-session in every caller today; if a bulk caller ever
  appears, chunk.
- **`NOTIFY` works on a pooled connection.** Only `LISTEN` needs a dedicated one (§4.3).
- `jobwork_app` needs **no new privileges** — `LISTEN`/`NOTIFY` are open to any role.

Migrate the three call sites:

| Call site                          | Becomes                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `revokeUserSessions(userId, c, r)` | `endSessions({ userId }, r, c)` — keep the function as a thin wrapper       |
| `markSessionRevoked(where, r)`     | `endSessions(where, r).catch(() => {})` — keeps its swallow-errors contract |
| `backchannelLogout`                | `endSessions(claims.sid ? { idpSessionId } : { idpSubject }, 'sso_logout')` |

`markSessionRevoked` for `expired` and `token_mismatch` is called from `refresh` on a session the
browser is already failing on. Publishing for those is harmless and keeps the rule absolute ("every
revoke publishes") — no exceptions to remember.

### 4.2 Channel name

One channel: `session_ended`.

Production, staging and dev all point at **one** database today (see memory: deployed envs share the
dev database). That is fine here, not a leak: they also share one `refresh_tokens` table, so a revoke
written by any environment really did end that session, and every environment's listener re-checks
against the same rows. A notification from another environment costs at most one query and can never
sign out a session that is still live. When each environment gets its own database (planned for
go-live), the channel is naturally separate.

### 4.3 The listener — one per instance

`sessionEvents.ts` also owns a single dedicated `pg.Client`:

```ts
const listener = new PgClient({ ...poolConfig, application_name: 'jobwork-api-listen' });
await listener.connect();
await listener.query('LISTEN session_ended');
listener.on('notification', (msg) => onSessionEnded(JSON.parse(msg.payload!).userIds));
listener.on('error', reconnect);
listener.on('end', reconnect);
```

- **Not Prisma, not the pool.** Prisma cannot `LISTEN`, and a pooled connection is handed to other
  queries between uses — the subscription would be lost or would block a pool slot forever. Export
  `poolConfig` from `db/prisma.ts` so this connects with the same TLS / CA / URL rules (that file
  documents why a hand-rolled config breaks against RDS).
- **Add `pg` to `package.json` as a direct dependency first.** Today it is only transitive through
  `@prisma/adapter-pg`; `db/prisma.ts` gets away with importing it, a new file should not rely on that.
- Prisma calls from the notification handler run outside any HTTP request. That is fine:
  `db/queryTiming.ts` `recordDbTime` returns early when no request tally is in scope.
- **Never through a pooler in transaction mode** (PgBouncer, RDS Proxy). `LISTEN` there silently
  receives nothing. Today the app connects straight to RDS, so this holds; note it in `PRISMA.md` if a
  pooler is ever added.
- **Started lazily** on the first stream, not at boot. `server.ts` documents that boot-time DB work
  costs ~1.9 s per connection and once cost a cold-start 500 loop. An instance with no streams
  never opens it.
- **Reconnect with backoff** (1 s, 2 s, 4 s … max 30 s). After a reconnect, notifications sent while
  it was down are **lost** — Postgres does not queue them. So after every reconnect, re-check **every
  stream this instance holds** (§4.4, one query). That is what makes a dropped listener safe.
- **Cost:** one connection per instance with at least one stream. Pool `max` is 5, so this is +20% at
  worst. The dev RDS ceiling is 79 (memory: DB connection ceiling); count it in.
- Closed in `server.ts` `shutdown` alongside `prisma.$disconnect()`.

### 4.4 Re-check — batched, never one query per stream

Split today's `getSessionStatus` into:

- `evaluateSession(row)` — the pure if-chain (revoked → reason, expired, `isUsableAccount`). No I/O.
- `getSessionStatuses(sids)` — **one** `findMany({ where: { id: { in: sids } } })` → `Map<sid, status>`.

`GET /auth/session` keeps working through `getSessionStatuses([sid])`, so the focus check and the
stream share one definition of "live". On a notification:

```ts
function onSessionEnded(userIds: string[]) {
  const sids = userIds.flatMap((u) => [...(streamsByUser.get(u) ?? [])].map((s) => s.sid));
  if (sids.length === 0) return; // not ours — the usual case, zero queries
  const statuses = await getSessionStatuses(sids); // ONE query, per CLAUDE.md "Query shape"
  for (const s of streamsFor(sids)) if (!statuses.get(s.sid)!.active) s.end(statuses.get(s.sid)!);
}
```

Debounce by ~100 ms so a burst of notifications (password reset ending 6 sessions, one each) collapses
into one query.

### 4.5 `GET /api/auth/events` — the stream

Mounted in `auth.routes.ts` with `authenticate` (no `tenantContext` — sessions are not per-org).

On connect:

1. `authenticate` has already rejected a bad/expired token with the normal 401 envelope — that still
   goes through `errorHandler`, because no stream has started yet.
2. Check the session **now** with `getSessionStatuses([sid])`. If it is already ended, send
   `event: ended` and close. This is what makes reconnects safe: **any event missed while
   disconnected is caught on the next connect.**
3. Otherwise set the headers, register the stream, send `event: ready`.

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

- **`no-transform` is load-bearing.** `app.ts` mounts `compression()` first and globally, and
  `text/event-stream` counts as compressible — gzip would buffer the events and nothing would arrive
  until the buffer filled. `compression` skips any response whose `Cache-Control` contains
  `no-transform`. `X-Accel-Buffering: no` asks an nginx-style proxy in front to do the same.
- **This endpoint does not use `sendSuccess`.** SSE has its own wire format; like
  `backchannelLogout`, it is a documented exception to the envelope rule. Errors before the stream
  starts still use the envelope.

Messages (all tiny):

```
event: ready
data: {}

: ping                                   ← comment line every 25 s (§8 — tune to AppSail's idle timeout)

event: ended
data: {"reason":"sso_logout"}            ← same reasons as GET /auth/session

event: reauth
data: {}                                 ← access token about to expire — reconnect with a fresh one
```

Closing rules:

- **At the access token's `exp`**, send `event: reauth` and close. A stream must not outlive the
  token that opened it, or a 15-minute token would buy an unlimited stream. The client refreshes —
  and `refresh` is where account standing is enforced, so this keeps that boundary intact.
- **On `SIGTERM`**, close every stream before `server.close()`. Open streams never finish on their
  own. Today this is not the hazard it sounds: `server.ts` calls `process.exit(0)` as soon as
  `prisma.$disconnect()` resolves, so streams would die hard and clients reconnect. Closing them
  explicitly is the polite version — the client sees a clean end instead of a reset.
- **On client disconnect** (`req.on('close')`), unregister. A leaked entry would keep a dead socket in
  the map and leak memory on a 256 MB instance.
- `requestTiming` would log each stream as a multi-minute request. Skip `/auth/events` there.

In-memory registry per instance: `Map<userId, Set<Stream>>` where
`Stream = { sid, res, tokenExp, heartbeat }`. It is **per instance on purpose** — this is the one
place instance memory is correct, because the open socket itself lives on this instance. The
"never cache in instance memory" rule (`ARCHITECTURE_AND_TECH_STACK.md` §3.13) is about shared data;
nothing here is shared.

---

## 5. Frontend

### 5.1 Why not `EventSource`

The browser's built-in `EventSource` **cannot send headers**, and our access token travels as
`Authorization: Bearer` (`web/src/api/client.ts`) — it is not a cookie. The alternatives are worse:

- token in the query string → written into every proxy and access log; a live credential in logs.
- cookie auth for this one route → a second auth path to get right.

So the client reads the stream with **`fetch` + `ReadableStream`**, which does send headers. SSE's
wire format is lines of `event:` / `data:`, so the parser is ~40 lines — no library needed (native
first, per CLAUDE.md).

New file `web/src/features/auth/sessionEvents.ts`:

- `openSessionStream({ onEnded, onReauth, signal })` — `fetch(endpoints.auth.events, { headers: { Authorization }, signal })`,
  decode with `TextDecoderStream`, split on blank lines, dispatch by `event:`.
- **Reconnect** on close or network error with backoff + jitter (1 s → 30 s). Jitter matters: when an
  instance is recycled, every stream it held reconnects at once.
- On a **401** at connect → run the existing `refreshAccessToken()` (it already handles the
  single-flight refresh) and reconnect. If refresh fails, that **is** the sign-out — hand to the
  existing path.
- On `reauth` → same as 401: refresh, reconnect.

### 5.2 One stream per browser, not per tab

Browsers allow only **6 connections per host over HTTP/1.1**. Each open stream holds one, forever.
Six tabs of jobwork would hold all six and **every other request from every tab would hang** — the
app would look frozen. (Over HTTP/2 the limit is ~100 and this goes away — see §8, unverified.)

So only **one tab per browser** holds the stream:

- Leader election with the **Web Locks API**: every tab calls
  `navigator.locks.request('jobwork-session-stream', …)`. The browser grants it to exactly one tab;
  that tab opens the stream and holds the lock until it closes. When the leader closes, the browser
  hands the lock to the next tab automatically — no heartbeat or election code of our own.
- The leader relays events on a **`BroadcastChannel('jobwork-session')`**.
- A follower that receives `ended` **does not trust it blindly** — it calls the existing
  `fetchSessionStatus()` once and acts on that answer. Two tabs of one browser can hold different
  sessions (someone signed in as another user in a new tab, overwriting the cookie), and this keeps
  one user's sign-out from signing out the other.

Every tab of the same browser shares the refresh cookie, so in the normal case the leader's session
**is** every tab's session, and one stream serves them all. Server load drops from "streams per tab"
to "streams per browser".

### 5.3 `useSessionWatch` after the change

Keep everything that happens **after** "this session ended": the latch, `messageFor(reason)`, the
toast, `clearSession()`, `queryClient.clear()`, the soft navigate to `/login`. Only the trigger
changes:

| Trigger                              | Today        | After                      |
| ------------------------------------ | ------------ | -------------------------- |
| Every 15 s                           | ✅ poll      | ❌ removed                 |
| Tab regains focus                    | ✅ one check | ✅ kept — cheap safety net |
| Pushed `ended` (leader or broadcast) | —            | ✅ new                     |

The focus check stays because it costs one request per focus and covers every gap: a stream that is
reconnecting, a browser without Web Locks, a proxy that buffers.

### 5.4 Kill switch

`SESSION_PUSH_ENABLED` (backend env). While it is `false` → `/auth/events` answers 404 and the web
app polls exactly as today. **The 404 is the signal — no flag has to reach the browser.** The stream
client treats a 404 at connect as "poll instead" and stops reconnecting; nothing is plumbed through a
startup response. This is the rollback if AppSail turns out to mishandle long-lived responses,
without a redeploy of the frontend logic.

---

## 6. Failure cases — what happens and why it is safe

| Case                                                                    | Outcome                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 6.1 Sign-out handled by a different instance than the stream            | Normal path — §3. NOTIFY reaches every instance.                                              |
| 6.2 The instance holding the stream is killed (AppSail recycles ~5 min) | Client reconnects to another instance; §4.5 step 2 checks status on connect.                  |
| 6.3 The instance's `LISTEN` connection drops                            | Reconnects; re-checks every held stream in one query (§4.3).                                  |
| 6.4 A revoke happens while the tab's stream is down                     | Caught on reconnect (status on connect) or on next focus.                                     |
| 6.5 Load balancer cuts an idle stream                                   | Heartbeat (§8) keeps it busy; if cut anyway, case 6.2.                                        |
| 6.6 Revoke transaction rolls back                                       | NOTIFY is never delivered — Postgres sends only on commit.                                    |
| 6.7 Forged / duplicated notification                                    | Listener re-reads the row; a live session stays live.                                         |
| 6.8 Someone sets `revoked_at` or `is_active` by hand in SQL             | No notification. Caught on next reconnect / focus / refresh — no worse than today.            |
| 6.9 Network blip on the client                                          | Fetch errors → backoff reconnect. **Never** read as a sign-out (same rule as the poll today). |

The guarantee is unchanged from today's bound: **in the worst case, `refresh` still ends a revoked
session within 15 minutes.** Push only makes the common case instant.

---

## 7. Tests

Backend (`vitest`, own fixtures, hard-deleted — CLAUDE.md "Tests"):

1. `endSessions` publishes on commit: a second `pg.Client` `LISTEN`s, call `endSessions`, assert one
   notification with the user's id.
2. `endSessions` inside a rolled-back transaction publishes **nothing**.
3. **Guard test — the rule in §2:** grep `backend/src` for `revokedAt: new Date()`; the only hit
   allowed is inside `sessionEvents.ts`. This is what catches a fourth revoke site that forgets to
   publish.
4. `GET /auth/events` with an already-revoked `sid` → `event: ended` immediately.
5. Cross-instance: two app instances in-process (`createApp()` twice, separate registries, separate
   listeners), stream on A, `POST /auth/logout` on B → A's stream receives `ended`.
6. Stream closes with `reauth` at token `exp` (fake timers).
7. `authenticate.test.ts` is untouched — `authenticate` itself does not change.

Frontend:

8. SSE parser: split chunks, multi-line `data:`, comment lines ignored.
9. Follower re-checks via `fetchSessionStatus` before signing out.

Manual (staging):

10. Two browsers, one user. Sign out in A → B's open tabs (including hidden ones) land on `/login`
    with the toast within ~2 s. DevTools on B shows **no** repeated `/auth/session` calls.
11. Same, with the sign-out done from another Octfis app (back-channel).
12. Leave a tab idle 30 min: the stream reconnects through instance recycling and token expiry
    without the user noticing and without a toast.

---

## 8. Verify on AppSail BEFORE building — these decide whether the plan works

`ARCHITECTURE_AND_TECH_STACK.md` §3.12 says AppSail instances are short-lived (~5 min) and that
persistent connections "don't fit". Reconnect-on-close (§5.1) is designed for that, but three facts
are still unknown (8.4 is answered). Measure each on **staging** with a 20-line throwaway SSE route
before writing the real code — this is step 1 of §0 and §10:

| Question                                                            | Why it matters                                                      | If the answer is bad                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 Does AppSail's proxy **buffer** streamed responses?             | Buffered = events arrive late or only when the stream closes.       | Plan does not work. Keep polling (§5.4 switch).                                                                                                                                                             |
| 8.2 Max request duration / idle timeout for a streaming response?   | Sets the heartbeat interval and how often clients reconnect.        | Under ~30 s → reconnect churn; reconsider.                                                                                                                                                                  |
| 8.3 HTTP/1.1 or HTTP/2 to the browser? (DevTools → Protocol column) | HTTP/2 removes the 6-connection limit; §5.2 is still worth keeping. | HTTP/1.1 → §5.2 is mandatory, not optional.                                                                                                                                                                 |
| 8.4 How many instances run, and how long does one live?             | Confirms §4.3 connection cost and §6.2 reconnect rate.              | ✅ **Answered 2026-10-05: at most 5 instances at once; an instance idles out after 5 min.** So at most 5 `LISTEN` connections. Whether an open stream counts as "not idle" is unknown — check 8.2 shows it. |

---

## 9. Relation to existing decisions

- **`authenticate` stays DB-free.** Nothing here touches the per-request path; the 2026-07-24 decision
  and its test stand.
- **`refresh` stays the enforcement boundary.** Push is a notification layer on top of it — §6's
  worst case is today's 15-minute bound.
- **`ARCHITECTURE_AND_TECH_STACK.md` §3.12** chose polling for _business data_ on a serverless host.
  This plan is narrower — one tiny event type, and SSE was already listed there as acceptable. Update
  §3.12 after building to record that session events use SSE.
- **`SSO_AND_IDENTITY.md` §11** — mark the SSE row built, and the poll row as the fallback.
- **CLAUDE.md** — add the §2 rule ("every revoke goes through `endSessions`") under the auth section
  once built, since it fails silently like the RLS rules.

---

## 10. Build order

Each step ships on its own and leaves the app working.

1. **§8 checks on staging.** Stop here if 8.1 fails.
2. **`endSessions()` + migrate the three call sites + tests 1–3.** Publishes into the void — nothing
   listens yet. Zero behaviour change.
3. **Listener + `GET /auth/events` + `getSessionStatuses` refactor + tests 4–7**, behind
   `SESSION_PUSH_ENABLED=false`.
4. **Frontend stream, leader election, broadcast + tests 8–9.** Still behind the flag.
5. **Flip the flag on staging**, run manual tests 10–12, watch connection counts in
   `pg_stat_activity` (`application_name = 'jobwork-api-listen'`).
6. **Remove the 15-second interval** from `useSessionWatch` (keep the focus check). Update the docs in §9.

## 11. Files touched

| File                                                         | Change                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `backend/src/modules/auth/sessionEvents.ts`                  | **new** — `endSessions`, listener, stream registry             |
| `backend/src/lib/authGuards.ts`                              | `revokeUserSessions` → wrapper over `endSessions`              |
| `backend/src/modules/auth/auth.service.ts`                   | `markSessionRevoked` → `endSessions`; split `getSessionStatus` |
| `backend/src/modules/auth/sso/sso.controller.ts`             | `backchannelLogout` → `endSessions`                            |
| `backend/src/modules/auth/auth.routes.ts` / `.controller.ts` | `GET /auth/events`                                             |
| `backend/src/db/prisma.ts`                                   | export `poolConfig`                                            |
| `backend/src/server.ts`                                      | close streams + listener on shutdown                           |
| `backend/src/middlewares/requestTiming.ts`                   | skip `/auth/events`                                            |
| `backend/src/config/env.ts`                                  | `SESSION_PUSH_ENABLED`                                         |
| `web/src/features/auth/sessionEvents.ts`                     | **new** — fetch-stream reader, leader lock, broadcast          |
| `web/src/features/auth/useSessionWatch.ts`                   | trigger from stream; drop interval (step 6)                    |
| `web/src/api/endpoints.ts`                                   | `auth.events`                                                  |
