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
| `invitations`                    | (if invite-only)   | see §9                           | Pending invitations decide who may create a user.                                                           |

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

1. Read and **delete** the `sso_flow` cookie. Missing → 400 "Sign-in expired. Please try again."
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

6. Find or create the local user (§6). Refused → **302 to `/no-access`** (not a JSON 403 — this
   is a page load).
7. Create **your own** session (refresh cookie + access token) and store `sid` →
   `idp_session_id`, `sub` → `idp_subject`.
8. 302 to `APP_URL + (returnTo ?? '/home')`. Do **not** put any token in the URL.

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

### 5.6 Your own session routes (unchanged by SSO)

`POST /api/auth/refresh-token` (refresh cookie → new access token), `GET /api/auth/me`, and
optionally `GET /api/auth/session` → `{ "active": true, "reason": null }` for a tab to notice it
was signed out. Refresh never calls accounts.

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
🔴 Step 3 must **fail closed**. Pick one:

- **Invite-only** (jobwork): create only if a pending, unexpired invitation exists for this
  verified email. Else refuse.
- **Open**: create for anyone signed in (internal tools only).

Every refusal uses **one** message ("You don't have access to this app. Ask your administrator
to invite you.") so it never reveals who is invited.

---

## 7. Frontend rules

| Page             | Behaviour                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`         | With SSO on it is a **redirector**, not a form: home-type visit (`/`, `/home`) → silent sign-in `…/sso/login?prompt=none&returnTo=/home`; a deep link or `?email=` → normal sign-in `…/sso/login?returnTo=<link>&email=<email>`. Show a manual "Access MyApp" button only for `?sso=manual` or after the session was ended elsewhere. |
| `/home`          | Your app's one "home" decision (jobwork: last organization used). Every entry point lands here.                                                                                                                                                                                                                                       |
| `/no-access`     | Public page for refused sign-ins: short message + "Sign out and use another account" → `/api/auth/sso/logout`.                                                                                                                                                                                                                        |
| Protected routes | No session → send to `/login` (which decides silent vs normal).                                                                                                                                                                                                                                                                       |
| Logout button    | `window.location.assign('/api/auth/sso/logout')` — full navigation. 🔴 Do **not** clear the local session first: that re-renders into `/login`, whose own redirect cancels the sign-out, and the user is signed straight back in. The page unloads anyway; the server revokes the session.                                            |

🔴 **Always a full navigation** (`window.location.assign`) to `/api/auth/sso/*`, never `fetch`
and never a router `navigate()`. The browser itself must visit accounts so it can present its
cookie.
🔴 **Silent sign-in only for visitors with no destination.** A deep link (above all an
invitation) must use normal sign-in, or a failed silent attempt bounces to the website and the
link is lost.
🔴 **Loop guard:** each silent attempt sets a 30-second `sso_silent` cookie; a second silent
attempt inside it goes to `/login?sso=manual` instead (stops an app ↔ accounts bounce).

Reference: `web/src/features/auth/LoginPage.tsx`, `useAuthConfig.ts`, `NoAccessPage.tsx`,
`web/src/app/router.tsx`.

---

## 8. What a visitor experiences

| Visitor                                          | Result                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Types `myapp.octfis.com`, signed in at accounts  | Straight into the app, no screen.                                           |
| Types `myapp.octfis.com`, not signed in anywhere | Sent to `www.octfis.com/my-app` (like `books.zoho.com` → `zoho.com/books`). |
| Clicks the website button, not signed in         | Accounts sign-in form → back into the app.                                  |
| Signed in at accounts but not entitled           | `/no-access`.                                                               |
| Logs out                                         | Signed out of every Octfis app; lands on the website page.                  |

---

## 9. Invitations (invite-only apps)

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
5. Callback: rule 3 of §6 finds the pending invitation → creates the user (no password).
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
- [ ] `email_verified === true` required before linking by email and before invitation lookup.
- [ ] Callback URL rebuilt from `SSO_REDIRECT_URI`, never from the request's Host.
- [ ] `returnTo` must start with `/` and not `//`.
- [ ] No `offline_access` scope. No tokens in URLs. Client secret never reaches the browser.
- [ ] Password routes unmounted when SSO is on (grep for every place a `password_hash` is written).
- [ ] Back-channel logout: signature, `iss`, `aud`, recent `iat`, `events`, no `nonce`.
- [ ] Entitlement fails closed; one refusal message.
- [ ] Your whole app sends `X-Robots-Tag: noindex, nofollow` (the website page should be the search result).

---

## 11. Go-live order and rollback

1. Accounts admin registers your client and **redeploys accounts** (the registry is read at boot).
2. Set your env vars → deploy your app with `SSO_ENABLED=true`.
3. Website developer publishes your product page; then set `SSO_WEBSITE_URL` and
   `SSO_POST_LOGOUT_REDIRECT_URI` to it and redeploy your app.

**Rollback:** `SSO_ENABLED=false` + redeploy. Password login returns. Users created by SSO have no
password and must use "Forgot password" once.

**Test before calling it done:** new invitee (no account) · existing account · already signed in
(silent) · wrong email → `/no-access` · logout ends every app · back-channel logout (real
hostnames only).
