# Authentication: Access & Refresh Tokens

> **Purpose.** Explain, in plain terms, how login sessions work in this project — what the two
> tokens are, where they live, and how every flow (login, refresh, logout, multi-device, password
> reset) behaves. Design context lives in `docs/ARCHITECTURE_AND_TECH_STACK.md` (§3.8).

_Last updated: 2026-07-15._

---

## 1. The two tokens in one minute

Logging in gives the browser **two** tokens with very different jobs:

| Token             | Lifetime          | Job                                              | Where it's kept                                           |
| ----------------- | ----------------- | ------------------------------------------------ | --------------------------------------------------------- |
| **Access token**  | short (**1 min**) | Proves who you are on every API call             | **In memory** in the React app (a JS variable)            |
| **Refresh token** | long (**7 days**) | Gets a new access token when the old one expires | **httpOnly cookie** (browser stores it; JS can't read it) |

Why two? The access token is checked on every request, so it must be fast to verify and cheap to
throw away — we keep it short-lived so a stolen one is useless within a minute. The refresh token is
the valuable long-lived key, so we lock it inside an httpOnly cookie where page JavaScript (and
therefore an XSS attack) can never touch it.

Both are **JWTs** — signed strings the server can verify without a database lookup. The refresh token
_also_ has a matching row in the database (the "session"), which is what lets us revoke it.

---

## 2. Where each token lives (and why)

```
                 BROWSER                                   SERVER
   ┌─────────────────────────────────┐        ┌──────────────────────────────┐
   │ Access token  → JS memory var   │  Bearer │ authenticate middleware       │
   │   (api/client.ts)               │ ──────► │   verifies the header token   │
   │                                 │  header │                              │
   │ Refresh token → httpOnly cookie │  cookie │ /auth/refresh-token & /logout │
   │   (invisible to JS)             │ ──────► │   read it automatically       │
   └─────────────────────────────────┘        └──────────────────────────────┘
```

- **Access token — Bearer, in memory.** The React app holds it in a variable and attaches it to
  every API call as `Authorization: Bearer <token>`. It is **not** in localStorage and **not** in a
  cookie, so it vanishes on a full page reload (that's fine — see §4, silent refresh).
- **Refresh token — httpOnly cookie.** The server sets it with `httpOnly; Secure; SameSite`, scoped
  to the path `/api/auth`, so the browser sends it _only_ to the refresh and logout endpoints and
  never to ordinary API calls. JavaScript cannot read it.

---

## 3. The session table

Each login (each device) creates **one row** in the `refresh_tokens` table:

| Column      | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `id`        | The session id. This value is embedded in the access token as its `sid` claim. |
| `token`     | The refresh token string.                                                      |
| `userId`    | Which user this session belongs to.                                            |
| `expiresAt` | When the refresh token dies.                                                   |
| `createdAt` | When the session started.                                                      |

Key idea: **one row = one logged-in device.** The same user on a laptop and a phone has two rows
with the same `userId`. There is no separate "device info" — a session is identified purely by its
`id` (the `sid`) or by its `token` string.

---

## 4. How each flow works

### 4.1 Login / Signup

```
1. Client sends email + password.
2. Server verifies the password.
3. Server creates a refresh_tokens row  → gets its `id`.
4. Server signs an access token carrying { sub: userId, sid: rowId }.
5. Server sets the refresh token as an httpOnly cookie,
   and returns { user, accessToken } in the JSON body.
6. Client stores the access token in memory (setAccessToken).
```

The refresh token never appears in the response body — only in the cookie. The access token never
goes in a cookie — only in the body.

### 4.2 A normal authenticated request

```
Client: GET /api/whatever   with header  Authorization: Bearer <access token>
Server: verifies the signature + expiry of the token — no database lookup.
        On success, req.user = { id, sid }.
```

This is the fast path: pure signature check, no DB hit, on every request.

### 4.3 Silent refresh (access token expired)

Because the access token lasts only 1 minute, it expires constantly. The client handles this
invisibly:

```
1. Some API call returns 401 (access token expired).
2. The axios response interceptor catches it and calls POST /auth/refresh-token.
   → The refresh cookie rides along automatically.
3. Server checks the refresh token (see §4.4), ROTATES it, returns a new access token.
4. Client stores the new access token and REPLAYS the original request.
   → The user never notices.
```

If many requests get a 401 at once, only **one** refresh actually runs (single-flight); the rest wait
for it and reuse the result.

On a **full page reload** the in-memory access token is gone, so `AuthProvider` runs the same refresh
once on startup to restore the session from the cookie. `ProtectedRoute` waits for that to finish
before deciding whether to redirect to `/login`.

### 4.4 Refresh token rotation & theft detection

Every refresh **replaces** the refresh token (single-use):

```
- Verify the refresh JWT signature/expiry.
- Look it up in the database.
    · Not found but signature is valid → likely a STOLEN, already-used token.
      → Delete ALL of that user's sessions (nuke) and reject.
- Delete the old row and create a new one, atomically (rotation).
- Issue a new access token whose `sid` points at the new row.
```

So a stolen refresh token gets caught the moment the real user and the thief both try to use the same
one — the second use hits a row that's already gone, and every session for that user is revoked.

### 4.5 Logout (this device only)

```
1. Client calls POST /auth/logout (Bearer header + refresh cookie both sent automatically).
2. Server reads the `sid` from the access token and deletes THAT ONE session row.
   (Fallback: if there's no access token, it deletes by the refresh cookie's token.)
3. Server clears the refresh cookie.
4. Client clears the in-memory access token and redirects to /login.
```

Only this device's row is deleted, so other devices stay logged in. The device's own access token
stays technically valid until it expires (≤ 1 min), but it can no longer be refreshed, so the session
is dead within a minute.

### 4.6 Logout everywhere / password reset

On a password reset, the server (in one transaction) updates the password **and deletes every
`refresh_tokens` row for that user**. All devices lose the ability to refresh and fall out within one
access-token lifetime. The same `deleteMany WHERE userId` is how a future "log out all devices"
button would work.

---

## 5. Multiple devices

```
User logs in on laptop  → refresh_tokens row A  (sid A)  → access token A
User logs in on phone   → refresh_tokens row B  (sid B)  → access token B
```

- The rows are independent; logging in on the phone does **not** touch the laptop.
- Logout on the phone deletes row B only.
- Password reset deletes rows A **and** B (everything for that `userId`).

---

## 6. File map

**Frontend (`web/src/`)**

| Concern                                                                                  | File                         |
| ---------------------------------------------------------------------------------------- | ---------------------------- |
| In-memory access token, `setAccessToken`, Bearer request interceptor, 401 silent-refresh | `api/client.ts`              |
| login/signup/logout/refresh API calls, `restoreSession`                                  | `features/auth/auth.api.ts`  |
| Stores user, runs session-restore on load, `clearSession`                                | `providers/AuthProvider.tsx` |
| Waits for restore before redirecting                                                     | `routes/ProtectedRoute.tsx`  |

**Backend (`backend/src/`)**

| Concern                                                         | File                              |
| --------------------------------------------------------------- | --------------------------------- |
| Sign/verify access token, read `sid`, sign/verify refresh token | `lib/jwt.ts`                      |
| Set/clear the httpOnly refresh cookie                           | `lib/cookies.ts`                  |
| Read the Bearer header, populate `req.user`                     | `middlewares/authenticate.ts`     |
| login/signup/refresh/logout endpoints                           | `modules/auth/auth.controller.ts` |
| Issue tokens, rotation, theft detection, logout, password reset | `modules/auth/auth.service.ts`    |
| `refresh_tokens` table shape                                    | `prisma/schema/tenant.prisma`     |

---

## 7. Known gaps / future hardening

- **Refresh token is stored in plaintext.** The `refresh_tokens.token` column holds the raw token. It
  should be stored as a **SHA-256 hash** so a database leak can't be replayed. (Hash on write; hash
  the incoming token before lookup.)
- **No CSRF token on the cookie-authenticated endpoints.** `SameSite` covers the current same-origin
  setup, but a move to a cross-site frontend would need explicit CSRF protection on
  `/auth/refresh-token` and `/auth/logout`.
- **No instant global kill for access tokens.** Revoking sessions stops _refreshing_ immediately, but
  an already-issued access token stays valid until it expires (≤ 1 min). A `tokenVersion` claim on the
  user row would close even that window instantly if ever needed.

---

## 8. Glossary

| Term                | Plain meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------------ |
| **JWT**             | A signed string the server can verify on its own, no DB needed.                |
| **Access token**    | Short-lived pass shown on every request. Held in memory.                       |
| **Refresh token**   | Long-lived key used only to get new access tokens. Held in an httpOnly cookie. |
| **`sid`**           | Session id — the `refresh_tokens` row id, embedded in the access token.        |
| **Bearer token**    | A token sent in the `Authorization: Bearer <token>` header.                    |
| **httpOnly cookie** | A cookie JavaScript cannot read; protects against XSS theft.                   |
| **Rotation**        | Replacing the refresh token with a new one on every refresh (single-use).      |
| **SameSite**        | Cookie setting controlling whether it's sent on cross-site requests.           |
