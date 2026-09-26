# SSO guide 3 of 3 — running accounts.octfis.com (the identity service) and its database

**Who this is for:** whoever operates Octfis Accounts — adding a new app, deploying, reading the
database. Code: `accounts/` in the jobwork repo.
**Other guides:** `SSO_GUIDE_NEW_APP.md` (an app connecting to it) · `SSO_GUIDE_WEBSITE.md`.
**Design and history:** `SSO_AND_IDENTITY.md`, `SSO_WALKTHROUGH.md`.

---

## 1. What accounts is (and is not)

| It owns                                                  | It does NOT own                              |
| -------------------------------------------------------- | -------------------------------------------- |
| Who a person is: email, password, email verified         | Organizations, roles, permissions (each app) |
| The central sign-in session (one cookie for all apps)    | Invitations (each app)                       |
| The list of apps allowed to use it (the client registry) | Any business data                            |

Built on **`oidc-provider`** (Node, OpenID Connect certified) inside Express, server-rendered HTML,
no frontend framework. Issuer: **`https://accounts.octfis.com`** — baked into every token; never
change it.

---

## 2. Every route

### 2.1 Protocol (provided by the library — apps call these)

| Method + path                           | Who calls                | Purpose                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/openid-configuration` | app server               | Lists every endpoint below.                                                                                                                                                                                                                                                                                                                                       |
| `GET /auth`                             | browser (sent by an app) | Start sign-in. Params: `client_id, redirect_uri, response_type=code, scope=openid email profile, state, nonce, code_challenge, code_challenge_method=S256`, optional `login_hint, prompt=none`. Answers with a 303 to the login form, or straight back to the app with `?code=` (already signed in) or `?error=login_required` (`prompt=none`, nobody signed in). |
| `GET /auth/:uid`                        | browser                  | Resumes a sign-in after the form. Internal hop.                                                                                                                                                                                                                                                                                                                   |
| `POST /token`                           | app server               | Code → tokens. Basic auth `client_id:client_secret`; body `grant_type=authorization_code, code, redirect_uri, code_verifier`. Returns `{ access_token, id_token, token_type, expires_in }`.                                                                                                                                                                       |
| `GET /jwks`                             | app server               | Public signing keys (RS256) to verify ID tokens.                                                                                                                                                                                                                                                                                                                  |
| `GET /me`                               | app server               | User info (apps rarely need it — the ID token already carries the claims).                                                                                                                                                                                                                                                                                        |
| `GET/POST /session/end`                 | browser                  | Central logout. Params: `client_id, post_logout_redirect_uri` (must be registered). Ends the session, back-channel-notifies every app, redirects.                                                                                                                                                                                                                 |
| `POST /token/revocation`                | app server               | Revoke a token (standard; unused today).                                                                                                                                                                                                                                                                                                                          |

Token lifetimes: authorization code **60 s**, ID token 5 min, access token 1 h, central session
**14 days**, consent grant 14 days, **sign-in in progress (interaction) 30 min**.

ID token claims: `sub, email, email_verified, name, picture, sid, iss, aud, nonce, iat, exp`.
Identity only — never organizations or roles.

### 2.2 Sign-in screens (inside a sign-in started by an app)

`:uid` = the sign-in in progress. The `_interaction` cookie (scoped to `/interaction/:uid`) proves
it is the same browser. When it is missing or the sign-in expired (30 min), every route below
answers "This sign-in has expired. Go back to the app and sign in again." (400).

🔴 **Never put a `path` in `cookies.short`** (`oidc/provider.ts`). The library spreads those
options _over_ the per-sign-in path, so a `path: '/'` there leaves the browser ONE `_interaction`
cookie, and the library picks the sign-in by that cookie, not by the `:uid` in the URL. Every
login form then finishes whichever sign-in started last: with two tabs, or an app starting a
sign-in while this form is open, the user is sent to the wrong app or told the sign-in expired.
Shipped that way until 2026-09-22; `portal.flow.test.ts` → "two sign-ins in one browser" guards it.

A new account made on these screens finishes the sign-in that started it — so it goes **back to
that app** (jobwork: straight to "Create organization"), and to `/account` only when the sign-in
began at accounts.octfis.com itself.

| Method + path                   | Form fields                                    | Result                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /interaction/:uid`         | —                                              | Login form (email prefilled from `login_hint`).                                                                                                                                       |
| `POST /interaction/:uid/login`  | `email, password`                              | Right + verified → signed in, back to the app. Right + **unverified** → code emailed, code form shown. Wrong → "That email and password do not match." (401, same for unknown email). |
| `GET /interaction/:uid/signup`  | —                                              | Create-account form, email prefilled from `login_hint`.                                                                                                                               |
| `POST /interaction/:uid/signup` | `firstName, lastName, email, password` (min 8) | Code emailed; code form shown. Same answer whether or not the email exists.                                                                                                           |
| `POST /interaction/:uid/verify` | `email, otp` (6 digits)                        | Right → **signed in**, back to the app (no second password). Wrong → "That code is invalid or expired." (400).                                                                        |

### 2.3 Standalone pages (someone opened accounts directly, no app)

| Method + path               | Form fields            | Result                                                        |
| --------------------------- | ---------------------- | ------------------------------------------------------------- |
| `GET/POST /signup`          | as above               | Code emailed → code form.                                     |
| `GET/POST /verify-email`    | `email, otp`           | "Your account is ready" + link to the website.                |
| `GET/POST /forgot-password` | `email`                | Code emailed (same answer for unknown emails).                |
| `GET/POST /reset-password`  | `email, otp, password` | Password set, email marked verified, **every session ended**. |

### 2.4 Other

| Method + path           | Purpose                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                 | The **My Account portal**, like accounts.zoho.com: signed in → 302 `/account`; signed out → 302 `/auth?client_id=accounts-portal…`, which opens the login form.       |
| `GET /account/callback` | Where the portal's sign-in lands; forwards to `/account`.                                                                                                             |
| `GET /account`          | The account page: name, email, link to the Octfis apps (`PRODUCT_SITE_URL`), Change password, Sign out. Signed out → 302 `/`.                                         |
| `GET /session/status`   | `{ "signedIn": boolean }` for the website's button label. The **only** route with CORS: exact origins from `SESSION_STATUS_ORIGINS`, credentials allowed, `no-store`. |
| `GET /health`           | Liveness, no database.                                                                                                                                                |
| `GET /health/ready`     | Readiness, checks the database.                                                                                                                                       |

Every response carries `X-Robots-Tag: noindex, nofollow`.

**Why the portal is a client of accounts itself:** the login form can only open inside a sign-in
started at `/auth`, so the "My Account" portal is registered **in code** (`oidc/portal.ts`, client
id `accounts-portal`, URLs derived from the issuer) — no `oidc_clients` row, correct in every
environment. It never redeems its code: finishing the form sets accounts' own session, which
`/account` reads directly.

---

## 3. Email codes — the rules that keep accounts safe

A 6-digit code, emailed, valid **10 minutes**. One live code per email per purpose.

| Rule                                                                                                             | Why                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **5 wrong guesses** delete the code                                                                              | Unlimited guesses would let someone "verify" an email they don't own in minutes. |
| A code only works in **the browser that asked for it** (HttpOnly `verify_binding` cookie; its SHA-256 is stored) | Stops a stranger's signup being confirmed by the real owner by mistake.          |
| The signup **password and name are stored on the code** and applied only when it is confirmed                    | Whoever registered an email first can no longer keep their password on it.       |
| Confirming a code that **replaces** a password ends every session                                                | Same as a password reset.                                                        |
| Signup/forgot give the **same answer** for known and unknown emails                                              | No way to test who has an account.                                               |

Code: `accounts/src/login/account.service.ts`, `binding.ts`.

---

## 4. Database (`accounts_*`, PostgreSQL, Prisma)

No tenants, no RLS, no `custom_fields` — every row is global.

| Table                 | What a row is                                   | Key columns                                                                                                                                                                        |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | One person                                      | `id` (uuid = the `sub`), `email` (citext, unique), `email_verified`, `password_hash` (argon2, null until first verification), `first_name`, `last_name`, `is_active`, `is_deleted` |
| `verification_tokens` | One live email code                             | `email`, `otp`, `purpose` (`email_verify`/`password_reset`), `expires_at`, `attempts`, `binding_hash`, `pending_password_hash`, `pending_first_name`, `pending_last_name`          |
| `oidc_clients`        | One registered app **per environment**          | `id` (client id), `name`, `secret_hash` (argon2), `redirect_uris[]`, `post_logout_redirect_uris[]`, `backchannel_logout_uri`, `is_active`                                          |
| `oidc_payloads`       | The library's live protocol state               | `(type, id)` key; `type` = `Session`, `Grant`, `AuthorizationCode`, `Interaction`, …; `payload` JSON, `expires_at`. Deleted at logout.                                             |
| `sso_sessions`        | Durable login history (one per browser session) | `id` (session uid, 43-char string — not uuid), `user_id`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`, `revoked_reason`                                               |
| `session_grants`      | Which apps a browser session signed in to       | `session_id`, `client_id`, `sid` (per app)                                                                                                                                         |
| `signing_keys`        | Token signing keys                              | `kid`, public/private JWK (private encrypted with `SIGNING_KEY_SECRET`), `retired_at`                                                                                              |

🔴 A live-session read must filter `revoked_at IS NULL` **and** `expires_at > now()`.
🔴 Schema changes only via `npm run db:draft` → edit → `db:promote` → `db:apply` (never `db push`).

---

## 5. Environment variables

| Variable                                | Production value / rule                                                    |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                          | The accounts database, non-owner role. Never an app's database.            |
| `MIGRATE_DATABASE_URL`                  | Owner role, Prisma CLI only.                                               |
| `OIDC_ISSUER`                           | `https://accounts.octfis.com` — no trailing slash, never change.           |
| `PRODUCT_SITE_URL`                      | `https://www.octfis.com` — the "your Octfis apps" link on account pages.   |
| `SESSION_STATUS_ORIGINS`                | `https://www.octfis.com` — exact origins, comma-separated, `www` included. |
| `SIGNING_KEY_SECRET`                    | 64 hex chars; encrypts private keys. Outside the database.                 |
| `COOKIE_SECRETS`                        | Comma-separated; first signs, rest still verify (rotate by prepending).    |
| `ZEPTO_TOKEN`, `ZEPTO_OTP_TEMPLATE_KEY` | Email sending. Unset = codes are logged, not sent (dev only).              |

---

## 6. Adding a new app (the checklist)

1. **Get from the app team:** client id per environment (`myapp-production`), name, callback URL,
   sign-out return URL(s), back-channel logout URL. All `https`, no query string.
2. **Register** (dry run first, then `--apply`), from `accounts/`:
   ```bash
   npm run register:client -- --id myapp-production --name MyApp \
     --redirect https://myapp.octfis.com/api/auth/sso/callback \
     --post-logout https://www.octfis.com/my-app \
     --post-logout https://myapp.octfis.com/ \
     --backchannel https://myapp.octfis.com/api/auth/sso/backchannel-logout
   # review the printout, then add --apply
   ```
   - New client → prints the **secret once**. Give it to the app team for `SSO_CLIENT_SECRET`.
   - Existing client → updates URLs, **secret unchanged** (`--rotate-secret` to replace it).
   - 🔴 The lists are **replaced**, not appended — repeat every URL you want to keep.
   - **Local development** uses a separate client (e.g. `myapp`) registered on the developer's
     own accounts at `http://localhost:3100`, with `http://localhost` URLs and no `--backchannel`
     (`SSO_GUIDE_NEW_APP.md` §12). Never add `localhost` URLs to a production client.
3. **Deploy accounts** (`npm run deploy:production:accounts`). 🔴 The registry and the CSP
   `form-action` list are read **only at startup** — skip this and sign-in dies at the form with a
   CSP error, or sign-out says the return URL is not allowed.
4. **Website:** if the product page is on `www.octfis.com`, `SESSION_STATUS_ORIGINS` already covers
   it. A different origin must be added there (and accounts redeployed).
5. The app team deploys with `SSO_ENABLED=true`.

---

## 7. Operating notes

- **Deploy order:** accounts first, then the app, whenever both change.
- **Deploys** go through `node scripts/deploy.mjs <target> <service>` only
  (`npm run deploy:production:accounts`; there is no bare `deploy:production`); it checks the Zoho
  login, keeps `.env` and `backups/` (database dumps) out of the upload.
- **`db:apply` writes a full dump** to `accounts/backups/` — gitignored and excluded from deploys;
  never commit one.
- **Localhost:** back-channel logout cannot reach `localhost` apps (the library blocks private
  addresses by design) — test it on real hostnames.
- **Shared database today:** every environment currently uses `accounts_dev`, so a staging row is
  visible to production after a restart. Give production its own database before real customers.
- **Adding a third-party (not Octfis-built) app:** consent is auto-approved for first-party apps in
  two places (`oidc/firstPartyGrant.ts`, the consent branch in `interaction/routes.ts`). Both must
  learn to show a real consent screen first.
