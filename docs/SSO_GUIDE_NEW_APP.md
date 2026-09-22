# SSO guide 1 of 3 — connecting a NEW Octfis app to Octfis Accounts

**Who this is for:** the developers of a new Octfis app (backend + frontend).
**Other guides:** `SSO_GUIDE_WEBSITE.md` (the product page on www.octfis.com) ·
`SSO_GUIDE_ACCOUNTS.md` (running accounts.octfis.com and its database).
**Reference implementation:** jobwork — every rule here is already working there. File paths
below point at it; copy from them.

---

## 1. The whole idea in 30 seconds

- **accounts.octfis.com** knows _who a person is_ (email + password). Nothing else.
- **Your app** knows _what that person may do_ in your app (organizations, roles, data).
- Sign-in happens **once** at accounts. Your app gets a signed note ("this is Riya, email
  verified") and then runs **its own normal session**. After that your app never talks to
  accounts again until the next sign-in.
- If accounts is down, people already signed in keep working. Only new sign-ins fail.

```
Visitor ──► your app ──► accounts.octfis.com (password, once) ──► your app callback
                                                                   └─ creates YOUR session
```

The protocol is **OpenID Connect (OIDC)**, Authorization Code flow with **PKCE**. Use a library
(jobwork uses `openid-client`). Never hand-roll token checks.

**What you build, in one list** — this guide is enough on its own; the jobwork file named in each
section is there to copy from, not required reading:

| Where    | What                                                                                    | Section |
| -------- | --------------------------------------------------------------------------------------- | ------- |
| backend  | 5 SSO routes: config, login, callback, logout, back-channel logout                      | §5      |
| backend  | your own session: refresh cookie + short access token, `refresh-token`, `me`, `session` | §5.6    |
| database | 4 columns on your users / sessions tables                                               | §4      |
| frontend | `/login` redirector, `/no-access`, restore-on-load, logout button                       | §7      |
| accounts | one registration per environment, done by the accounts admin                            | §2      |

🔴 **Your web app and your API must be served from ONE origin** (e.g. `myapp.octfis.com` serving
both the pages and `/api/...`). Everything below relies on it: the frontend reaches
`/api/auth/sso/*` by relative URL, and the session lives in a cookie scoped to `/api/auth`. With
the API on a separate host the cookies are silently not sent and every sign-in "works" and then
shows you signed out. In development, proxy `/api` from your dev server to the API (§12).

---

## 2. What you get from the accounts admin (and what you give them)

| You GIVE the accounts admin    | Example (jobwork production)                                    |
| ------------------------------ | --------------------------------------------------------------- |
| App id                         | `myapp-production` (one per environment)                        |
| Display name                   | `MyApp`                                                         |
| Callback URL (exact)           | `https://myapp.octfis.com/api/auth/sso/callback`                |
| Sign-out return URL(s) (exact) | `https://www.octfis.com/my-app` and `https://myapp.octfis.com/` |
| Back-channel logout URL        | `https://myapp.octfis.com/api/auth/sso/backchannel-logout`      |

| You GET back               | Put it in                                |
| -------------------------- | ---------------------------------------- |
| Client id                  | `SSO_CLIENT_ID`                          |
| Client secret (shown ONCE) | `SSO_CLIENT_SECRET`                      |
| Issuer                     | `SSO_ISSUER=https://accounts.octfis.com` |

🔴 **URLs are matched character for character** — `https`, host, path and trailing slash all
count. `https://myapp.octfis.com/` and `https://myapp.octfis.com` are different URLs.

---

## 3. Environment variables (your backend)

| Variable                       | Example                                          | Meaning                                                                     |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `SSO_ENABLED`                  | `true`                                           | The switch. `false` = your old password login. Keep it as your rollback.    |
| `SSO_ISSUER`                   | `https://accounts.octfis.com`                    | Must equal the token's `iss` exactly. No trailing slash.                    |
| `SSO_CLIENT_ID`                | `myapp-production`                               | From the admin.                                                             |
| `SSO_CLIENT_SECRET`            | `…`                                              | From the admin. Never send to the browser.                                  |
| `SSO_REDIRECT_URI`             | `https://myapp.octfis.com/api/auth/sso/callback` | Exactly as registered.                                                      |
| `SSO_POST_LOGOUT_REDIRECT_URI` | `https://www.octfis.com/my-app`                  | Where people land after logout. Must be registered.                         |
| `SSO_WEBSITE_URL`              | `https://www.octfis.com/my-app`                  | Where a visitor signed in NOWHERE is sent. Unset = your own sign-in button. |
| `APP_URL`                      | `https://myapp.octfis.com`                       | Your app's own origin, no trailing slash.                                   |

🔴 `www` is required in `www.octfis.com` — the bare domain does not serve the website.

---

## 4. Database changes in YOUR app's database

Your app keeps its own `users` table. You add a link to the accounts identity. You do **not**
store passwords any more.

| Table                            | Column             | Type                             | Why                                                                                                         |
| -------------------------------- | ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `users`                          | `identity_user_id` | `uuid`, **unique**, nullable     | The accounts user id (`sub`). Set once at first sign-in, never changed.                                     |
| `users`                          | `password_hash`    | make it **nullable**             | SSO users have no password in your app.                                                                     |
| `refresh_tokens` (your sessions) | `idp_session_id`   | `varchar(64)`, nullable, indexed | The `sid` from the ID token. 🔴 **Not a uuid** — it is a 43-char random string; a `uuid` column rejects it. |
| `refresh_tokens`                 | `idp_subject`      | `uuid`, nullable, indexed        | The `sub`, for "log this person out everywhere".                                                            |
| `invitations`                    | (if you have orgs) | see §9                           | Pending invitations decide who may join an existing organization.                                           |

🔴 **Keep your own `users.id` as the foreign key everywhere.** Store the accounts id _beside_
it (`identity_user_id`), never instead of it.

Reference: `backend/prisma/schema/tenant.prisma` (`User`, `RefreshToken`),
`migrations/20260824064102_add_sso_identity_columns`.

---

## 5. Backend routes you must build

All live under `/api/auth/sso/`. Mount them **only when `SSO_ENABLED=true`**, and when SSO is on
**unmount** every route that sets or uses a local password (signup, login, forgot/reset
password — and any invite-accept that creates a password). Reference:
`backend/src/modules/auth/sso/sso.routes.ts`, `sso.controller.ts`.

Your OIDC library needs only the issuer: it reads everything else (the `/auth`, `/token`, `/jwks`,
`/session/end` URLs and the signing keys) from
`https://accounts.octfis.com/.well-known/openid-configuration`. Cache that result for the life of
the process — fetching it on every sign-in puts accounts on your critical path for nothing.

### 5.1 `GET /api/auth/config` — tell the frontend how to sign in

```jsonc
// 200
{ "statusCode": 200, "message": "Success", "data": { "ssoEnabled": true } }
```

Unauthenticated. Return **only** this flag — never the issuer URL or client id.

### 5.2 `GET /api/auth/sso/login` — start sign-in

**Two URLs appear in this section — you build only the first.** `/api/auth/sso/login` is your
route; the browser reaches it by full page navigation (never `fetch`). It returns **no JSON** —
only a `302` whose `Location` header is the `accounts.octfis.com/auth?...` URL in step 3, which
already exists on accounts. Your library builds that URL (`openid-client`'s
`buildAuthorizationUrl`); accounts later sends the browser back to your §5.3 callback.

| Query                    | Meaning                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `returnTo` (optional)    | A path inside your app to land on afterwards, e.g. `/invite/accept?token=…`. Must start with `/` and not `//` (else ignore it — open-redirect guard). |
| `email` (optional)       | Sent to accounts as `login_hint` to prefill the email box (used by invitations). A hint only.                                                         |
| `prompt=none` (optional) | **Silent** sign-in: no screen at all. See §7.                                                                                                         |

What it does:

0. **Loop guard (silent only).** If `prompt=none` and the `sso_silent` cookie is present → 302 to
   your own `/login?sso=manual` and stop. Otherwise, for a silent attempt, set `sso_silent=1`
   (`HttpOnly; SameSite=Lax; Path=/api/auth/sso; Max-Age=30`). Do **not** clear it on success —
   success that does not stick (a dropped cookie) is exactly what loops the browser between your
   app and accounts forever. This is backend work; the frontend cannot do it.
1. Makes 3 random values: `state`, `nonce`, `code_verifier`.
2. Saves them + `returnTo` (+ `silent: true` if `prompt=none`) in a cookie:
   `sso_flow` — `HttpOnly; SameSite=Lax; Secure; Path=/api/auth/sso; Max-Age=1800` (30 min).
   🔴 `Lax`, not `Strict` (Strict drops it on the way back and every login fails).
   🔴 30 min, not less — a new user may wait for an email code mid-sign-in.
3. Redirects (302) to accounts:

```
https://accounts.octfis.com/auth
  ?client_id=myapp-production
  &redirect_uri=https://myapp.octfis.com/api/auth/sso/callback
  &response_type=code
  &scope=openid email profile          ← never offline_access
  &state=<state>
  &nonce=<nonce>
  &code_challenge=<BASE64URL(SHA256(code_verifier))>
  &code_challenge_method=S256
  [&login_hint=<email>] [&prompt=none]
```

### 5.3 `GET /api/auth/sso/callback` — finish sign-in

Accounts sends the browser back here:

- success: `?code=…&state=…&iss=https://accounts.octfis.com`
- silent attempt found nobody: `?error=login_required&state=…` (also `consent_required`,
  `interaction_required`)

Steps (in this order):

1. Read and **delete** the `sso_flow` cookie. Missing → a failure (see the note after step 8).
2. If the flow was **silent** and `?error=` is present and `state` matches → **302 to
   `SSO_WEBSITE_URL`** (or your own `/login?sso=manual` if unset). Do not exchange.
3. Otherwise exchange the code — **server to server**:

```http
POST https://accounts.octfis.com/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<code>&redirect_uri=<SSO_REDIRECT_URI>&code_verifier=<verifier>
```

```jsonc
// 200
{ "access_token": "…", "id_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600 }
```

4. **Verify the ID token** (the library does it when you pass the expectations):
   signature via `https://accounts.octfis.com/jwks` (**RS256**), `iss`, `aud` = your client id,
   `exp`, `nonce` = the cookie's nonce, `state` = the cookie's state. 🔴 Omit an expectation and
   that check is silently skipped.
5. Read the claims:

```jsonc
{
  "sub": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab", // accounts user id (uuid) — the permanent key
  "email": "riya@example.com",
  "email_verified": true, // treat missing as FALSE
  "name": "Riya Shah",
  "picture": null,
  "sid": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM", // this sign-in, for YOUR app only
  "iss": "https://accounts.octfis.com",
  "aud": "myapp-production",
  "nonce": "…",
  "iat": 1787654400,
  "exp": 1787654700,
}
```

🔴 The token is **identity only** — no organizations, roles or permissions, ever. Your app
decides those on every request from its own database.

6. Find or create the local user (§6). Refused → **302 to `/no-access`**.
7. Create **your own** session (§5.6): a session row with `sid` → `idp_session_id`, `sub` →
   `idp_subject`, and the refresh cookie on this response.
8. 302 to `APP_URL + (returnTo ?? '/home')`. Do **not** put any token in the URL — not the query,
   not the `#fragment`. The page that loads calls `POST /api/auth/refresh-token` on start-up (§7,
   "App start") and gets its access token from the cookie you just set. That is the same path a
   page reload uses, so there is exactly one way to obtain an access token.

🔴 **The callback never answers with JSON** — it is a page load, so JSON is a raw error in the
address bar. Give the route its own error handler (jobwork: `redirectFailedSignIn`): a refusal
(403) → `/no-access`; **anything else** — missing/expired `sso_flow`, a `state` that no longer
matches because another tab started a sign-in, a failed or replayed code exchange → log it and
302 to `/login?sso=manual&error=signin_failed`, which shows a one-line message and the sign-in
button. Manual, never an automatic retry: if the failure repeats, a retry is a redirect loop.

### 5.4 `GET /api/auth/sso/logout` — sign out everywhere

1. Revoke your local session **first** (always, even if the next step fails). Clear cookies.
2. 302 to

```
https://accounts.octfis.com/session/end?client_id=<SSO_CLIENT_ID>&post_logout_redirect_uri=<SSO_POST_LOGOUT_REDIRECT_URI>
```

Accounts ends the central session (no confirmation click) and notifies every other app (§5.5).
The frontend must reach this with a **full page navigation**, never `fetch`.

### 5.5 `POST /api/auth/sso/backchannel-logout` — accounts tells you someone logged out

Called by accounts' server, never by a browser. Body is a form:

```http
POST /api/auth/sso/backchannel-logout
Content-Type: application/x-www-form-urlencoded

logout_token=eyJ…
```

Verify ALL of these, or anyone could log your users out
(reference: `backend/src/modules/auth/sso/logoutToken.ts`):

- signature via JWKS, `iss` = issuer, `aud` = your client id, `iat` within 2 minutes;
- `events` contains `http://schemas.openid.net/event/backchannel-logout`;
- **no** `nonce` claim (its presence means someone replayed an ID token);
- has `sid` or `sub`.

Then revoke: `sid` → sessions where `idp_session_id = sid`; only `sub` → all sessions where
`idp_subject = sub`. Always `WHERE revoked_at IS NULL`.

```http
200  {}          ← exactly this; Cache-Control: no-store. NOT your usual JSON envelope.
```

🔴 Cannot be tested against `localhost` — accounts refuses to POST to local addresses.

### 5.6 Your own session — build it if your app has none

After the callback your app **never talks to accounts again** until the next sign-in. It runs on
its own two-token session. Values below are jobwork's; the shape is what matters. Reference:
`backend/src/lib/cookies.ts`, `lib/jwt.ts`, `modules/auth/auth.service.ts` (`issueTokens`,
`refresh`), `middlewares/authenticate.ts`.

| Token             | Where it lives                                                                                                          | Lifetime                 | Carries                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| **Refresh token** | cookie `refreshToken`: `HttpOnly; Secure; Path=/api/auth; Expires=<session expiry>` — JavaScript can never read it      | 7 days, fixed at sign-in | a signed JWT: `sub` = your `users.id`, random `jti`      |
| **Access token**  | **memory only** in the SPA (never `localStorage`, never a cookie); sent as `Authorization: Bearer <token>` on API calls | 15 minutes               | JWT: `sub` = your `users.id`, `sid` = the session row id |

One **session row** per sign-in (jobwork: `refresh_tokens`): `id`, `user_id`, `token` (the refresh
token, looked up on each refresh), `expires_at`, `created_at`, `last_used_at`, `revoked_at`,
`revoked_reason`, `user_agent`, plus the two SSO columns from §4. 🔴 **Never delete a row to end a session — stamp `revoked_at`**, and every
live-session read filters `revoked_at IS NULL`. Back-channel logout (§5.5) depends on this.

`POST /api/auth/refresh-token` — no body; the cookie is the credential.

```jsonc
// 200 — the row exists, is NOT revoked, belongs to the token's user, is unexpired, and the user
// is active. Anything else → 401, and the SPA treats the visitor as signed out.
{
  "statusCode": 200,
  "message": "Session refreshed.",
  "data": {
    "user": { "id": "…", "email": "riya@example.com", "fullName": "Riya Shah" },
    "accessToken": "eyJ…",
  },
}
```

🔴 This endpoint is the **whole** enforcement point: a disabled user or a revoked session must be
refused here, because your per-request auth only verifies the access token's signature. So a
revocation (logout, back-channel logout, disabling the user) takes effect within the access
token's 15 minutes, at the next refresh. Do **not** rotate the refresh token on each call — an
interrupted refresh then leaves the browser holding a token the server already replaced, and the
user is logged out at random.

`GET /api/auth/me` (Bearer) → `{ "data": { "user": { … } } }`. `GET /api/auth/session` (Bearer,
optional) → `{ "data": { "active": false, "reason": "sso_logout" } }` — polled by an open tab so
it can say _"You were signed out from another app"_ instead of failing on the next click.
`reason` is one of `revoked | expired | account_disabled | sso_logout`.

---

## 6. Who is this person? (link or create the local user)

Reference: `linkOrCreateLocalUser` in `backend/src/modules/auth/sso/sso.service.ts`. In order:

| #   | Check                                                  | Result                                                                      |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | A user has `identity_user_id = sub`                    | Use it (refuse if disabled in your app).                                    |
| 2   | `email_verified` is true **and** a user has this email | Set `identity_user_id = sub` on it, once. (Migration of pre-SSO users.)     |
| 3   | Neither                                                | **Your entitlement rule** decides: create the user (no password) or refuse. |

🔴 Step 2 **requires** `email_verified === true`. Without it, anyone who registers someone
else's address at accounts takes over that person's account in your app.
🔴 Step 3 is a decision you make **explicitly**. Pick one:

- **Self-signup** (jobwork, the standard multi-tenant SaaS model): create a user for any
  **verified** identity. Safe only because that user has **no memberships** — it sees nothing
  until it creates its own organization or accepts an invitation. Your tenant checks (membership,
  RLS, permissions) are the security, not this step. Gate trials/plans at organization creation.
- **Invite-only**: create only if a pending, unexpired invitation exists for this verified
  email; else refuse with one message ("You don't have access to this app. Ask your
  administrator to invite you.") so it never reveals who is invited.

---

## 7. Frontend rules

| Page             | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App start        | Before rendering any route, call `POST /api/auth/refresh-token` once. 200 → keep `accessToken` in memory and the `user` in state: signed in. 401 → signed out. Do the same, once, whenever an API call returns 401, then retry that call. This is how the app gets its token after the §5.3 callback **and** after a reload.                                                                                                                               |
| `/login`         | With SSO on it is a **redirector**, not a form: home-type visit (`/`, `/home`) → silent sign-in `…/sso/login?prompt=none&returnTo=/home`; a deep link or `?email=` → normal sign-in `…/sso/login?returnTo=<link>&email=<email>`. Show a manual "Access MyApp" button only for `?sso=manual` or after the session was ended elsewhere. With `?error=signin_failed` also show one line above the button: _"That sign-in didn't complete. Please try again."_ |
| `/home`          | Your app's one "home" decision (jobwork: last organization used). Every entry point lands here.                                                                                                                                                                                                                                                                                                                                                            |
| `/no-access`     | Public page for refused sign-ins: short message + "Sign out and use another account" → `/api/auth/sso/logout`.                                                                                                                                                                                                                                                                                                                                             |
| Protected routes | No session → send to `/login` (which decides silent vs normal).                                                                                                                                                                                                                                                                                                                                                                                            |
| Logout button    | `window.location.assign('/api/auth/sso/logout')` — full navigation. 🔴 Do **not** clear the local session first: that re-renders into `/login`, whose own redirect cancels the sign-out, and the user is signed straight back in. The page unloads anyway; the server revokes the session.                                                                                                                                                                 |

🔴 **Always a full navigation** (`window.location.assign`) to `/api/auth/sso/*`, never `fetch`
and never a router `navigate()`. The browser itself must visit accounts so it can present its
cookie.
🔴 **Silent sign-in only for visitors with no destination.** A deep link (above all an
invitation) must use normal sign-in, or a failed silent attempt bounces to the website and the
link is lost.
🔴 **The loop guard is on the server** (§5.2 step 0). The frontend's only part is honouring
`?sso=manual`: show the button, never start another silent attempt.

Reference: `web/src/features/auth/LoginPage.tsx`, `useAuthConfig.ts`, `useLogout.ts`,
`NoAccessPage.tsx`, `web/src/api/client.ts` (refresh on start-up and on 401),
`web/src/app/router.tsx`.

---

## 8. What a visitor experiences

| Visitor                                          | Result                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Types `myapp.octfis.com`, signed in at accounts  | Straight into the app, no screen.                                           |
| Types `myapp.octfis.com`, not signed in anywhere | Sent to `www.octfis.com/my-app` (like `books.zoho.com` → `zoho.com/books`). |
| Clicks the website button, not signed in         | Accounts sign-in form → back into the app.                                  |
| Signed in at accounts, no account in your app    | Self-signup: a user is created → your "create organization" page.           |
| Account disabled in your app                     | `/no-access`.                                                               |
| Sign-in could not complete (stale tab, expired)  | Your sign-in page with a short message and the sign-in button.              |
| Logs out                                         | Signed out of every Octfis app; lands on the website page.                  |

---

## 9. Invitations (joining an existing organization)

**Your app sends the invitation; accounts knows nothing about it.**

1. Admin invites → your DB stores `invitations` row: org, email, role, `token_hash` (SHA-256 of a
   random 32-byte token), `expires_at` (e.g. 7 days), `status='pending'`. No user yet.
2. Email link: `https://myapp.octfis.com/invite/accept?token=<raw token>`.
3. Invite page, not signed in → `/login?email=<invited>&next=/invite/accept?token=…` → normal
   sign-in with `login_hint`.
4. At accounts:
   - **Has an account** → types password (or no screen if already signed in).
   - **No account** → "Create Account" (email prefilled) → name + password → 6-digit code by email
     → code accepted = **signed in**, straight back to your app. No second password.
5. Callback: rule 3 of §6 creates the user (no password). Under invite-only, this is where the
   pending invitation is checked; under self-signup it is not needed here.
6. Back on the invite page, signed in with the invited email → **accept automatically** →
   create the membership → mark invitation accepted → into the organization.

Edge cases your invite page must handle:

- Signed in as a **different** email → show "This invitation is for X; you're signed in as Y" +
  **Sign out**. 🔴 Never redirect to `/login` here — accounts returns the same identity and you
  loop forever.
- Accept endpoint called without a session while SSO is on → `401 SIGN_IN_REQUIRED`. Never create
  a password-holding user there.

Reference: `web/src/features/invitations/AcceptInvitePage.tsx`,
`backend/src/modules/settings/organization/invitations/`.

---

## 10. Security checklist (all required)

- [ ] PKCE S256 on every sign-in; `state` and `nonce` checked on callback.
- [ ] `sso_flow` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, path-scoped, 30 min, deleted on callback.
- [ ] ID token: signature, `iss`, `aud`, `exp`, `nonce` all checked.
- [ ] `email_verified === true` required before linking by email and before creating a user.
- [ ] Callback URL rebuilt from `SSO_REDIRECT_URI`, never from the request's Host.
- [ ] `returnTo` must start with `/` and not `//`.
- [ ] No `offline_access` scope. No tokens in URLs. Client secret never reaches the browser.
- [ ] Password routes unmounted when SSO is on (grep for every place a `password_hash` is written).
- [ ] Back-channel logout: signature, `iss`, `aud`, recent `iat`, `events`, no `nonce`.
- [ ] Entitlement rule chosen on purpose (§6); a new self-signup user has **no** memberships.
- [ ] Access token in memory only; refresh cookie `HttpOnly`; refresh refuses a revoked row or a disabled user.
- [ ] Callback failures redirect to a page (never JSON); loop guard in the login route.
- [ ] Your whole app sends `X-Robots-Tag: noindex, nofollow` (the website page should be the search result).

---

## 11. Go-live order and rollback

1. Accounts admin registers your client and **redeploys accounts** (the registry is read at boot).
2. Set your env vars → deploy your app with `SSO_ENABLED=true`.
3. Website developer publishes your product page; then set `SSO_WEBSITE_URL` and
   `SSO_POST_LOGOUT_REDIRECT_URI` to it and redeploy your app.

**Rollback:** `SSO_ENABLED=false` + redeploy. Password login returns. Users created by SSO have no
password and must use "Forgot password" once.

**Test before calling it done:** brand-new account (created at accounts) → create organization ·
new invitee (no account) · existing account · already signed in (silent) · disabled account →
`/no-access` · two sign-in tabs at once · logout ends every app (and does not sign straight back
in) · back-channel logout (real hostnames only).

---

## 12. Local development

Run accounts on your machine rather than pointing at `accounts.octfis.com` — production accounts
would need your `http://localhost` URLs in its registry, and those do not belong there.

1. **Start accounts locally** (`cd accounts && npm run dev` → `http://localhost:3100`; its env is in
   `SSO_GUIDE_ACCOUNTS.md` §5).
2. **Register a dev client** there, exactly like production but with localhost URLs
   (`SSO_GUIDE_ACCOUNTS.md` §6):
   `--id myapp --redirect http://localhost:3000/api/auth/sso/callback --post-logout http://localhost:5173/`
   (no `--backchannel` — see 5). Restart accounts: the registry is read at startup.
3. **Your backend `.env`** (jobwork's values):

   ```bash
   SSO_ENABLED=true
   SSO_ISSUER=http://localhost:3100
   SSO_CLIENT_ID=myapp
   SSO_CLIENT_SECRET=<printed once by step 2>
   SSO_REDIRECT_URI=http://localhost:3000/api/auth/sso/callback
   SSO_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/
   APP_URL=http://localhost:5173
   # SSO_WEBSITE_URL unset → a signed-out visitor gets your own sign-in button
   ```

4. **Plain HTTP is refused by `openid-client`** unless you opt in. Opt in only when the issuer is
   literally `localhost`/`127.0.0.1` **and** `NODE_ENV` is not production (jobwork:
   `client.allowInsecureRequests` in `sso.service.ts` `ssoConfig`), so it can never be switched on
   for a real hostname. Cookies are not `Secure` outside production for the same reason.
5. **Proxy `/api` from your dev server to the API** (Vite: `server.proxy['/api'] →
http://localhost:3000`) so the page and the API share an origin, as in production. Cookies
   ignore ports, so the callback on `:3000` and the page on `:5173` see the same cookies.
6. **What cannot be tested locally:** back-channel logout — accounts refuses to POST to a private
   address by design. Test it on real hostnames; locally, logout still ends your own session and
   the accounts session through §5.4.
