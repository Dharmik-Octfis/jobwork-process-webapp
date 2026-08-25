# SSO & Identity: one login across every app

> **Purpose.** One account, many applications — sign in once and you are signed in everywhere, the
> way `accounts.zoho.com` works for Zoho's apps. This document is the design: what moves out of this
> repo, what stays, the exact flows, the schema, and the order to build it in.
>
> Today's single-app model is `docs/AUTHENTICATION.md` — read that first if you have not. This
> document does not replace it. **Almost everything in it survives**, one layer down.

_Status: **built and working locally; not yet deployed anywhere.** As of 2026-08-24 a full sign-in
runs end to end between `accounts/` and `backend/` on a laptop — redirect, login, consent, code
exchange, session, logout, and back-channel logout. What is NOT done is everything that needs real
infrastructure: no accounts database exists beyond `accounts_dev`, no domain is mapped, and nothing
is deployed. Sections below are marked ✅ built / ⚠️ partly / ❌ design._

| Section                    | State                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| §2–§6 concepts, flows      | ✅ implemented as described                                                                 |
| §7 the accounts service    | ✅ built — `accounts/`, with §7.3's schema (see the `sid` correction on `SsoSession`)       |
| §8 client registry         | ⚠️ table and loader built; per-environment registration is an operational step, not code    |
| §9 what changes in jobwork | ✅ built. Signup, login, forgot- and reset-password are UNMOUNTED whenever SSO is on        |
| §10 revocation             | ✅ built, including retries the library does not do. 🔴 untestable on localhost — see §10.3 |
| §11 instant cross-tab      | ❌ design. Deferred out of phase 1 on purpose, and untestable until the domains are real    |
| §12 security checklist     | ✅ every line enforced, and pinned by tests                                                 |
| §13 migration plan         | steps 1, 3, 4, 7 ✅ · step 2 blocked on app 2 · steps 5–6 are post-cutover                  |
| §14 portability rules      | ✅ respected in code — but rule 1 is an ACTION still outstanding: we do not own the issuer  |
| §15 deployment             | ⚠️ deploy path ready; databases and domains are not                                         |

_Last updated: 2026-08-24 — the service, both logout directions, the frontend entry point, and the
tests that pin them._

---

## 1. The problem in one paragraph

We are building several applications. Today each one has its own database, its own `users` table,
and its own password. A customer who buys two of them holds two accounts, resets two passwords, and
gets deactivated twice — and we get two places for `isDeleted` to be checked in one place and not
the other. The fix is a single **identity provider** that owns "who is this human", with every app
asking it rather than storing passwords itself.

The technical name is **SSO (Single Sign-On)** over **OIDC (OpenID Connect)** — OAuth 2.0 with an
identity layer on top.

---

## 2. The one idea that makes it work

**Cookies belong to one host.** `jobwork.octfis.com` cannot read a cookie set by
`reports.octfis.com`, and it never will. SSO does not work by sharing a cookie. It works by sending
every app's browser to **the same third place**:

```
You already signed in to jobwork.
→ accounts.octfis.com holds a session cookie for you.

You open reports.octfis.com in a new tab.
→ reports:  "no session here"  → redirect to accounts.octfis.com/authorize
→ accounts: reads ITS OWN cookie → "yes, this is Dhiraj" → redirect straight back
→ reports:  signed in.

User interaction: none. Two redirects, ~200 ms.
```

That is the whole mechanism. One place holds the session; everyone else asks it.

🔴 **The tempting shortcut is to set one cookie on `.octfis.com` and share it.** Do not. It means the
cookie is sent to every host under `octfis.com` — marketing pages, staging boxes, anything anyone
spins up — and one subdomain takeover becomes total compromise. See §4.

---

## 3. Two token layers — the thing to understand first

After this change there are **two** independent token systems. Conflating them causes every design
mistake in this area.

```
┌─ Layer 2 — app ↔ accounts service ────────────── used ONCE, at login ────┐
│  OIDC authorization code → id_token                                      │
│  Answers exactly one question: who is this human?  → sub = 8f3a…         │
│  Never consulted again for this session.                                 │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓ login only
┌─ Layer 1 — browser ↔ jobwork ────────────────── used every 15 minutes ───┐
│  OUR access token + OUR refresh token                                    │
│  checked against jobwork's own `refresh_tokens` table                    │
│  ← exactly what docs/AUTHENTICATION.md describes today. UNCHANGED.       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Refreshing an access token hits jobwork's Postgres, not the accounts service.**
`auth.service.refresh` (`backend/src/modules/auth/auth.service.ts:309`) keeps all five of its steps —
signature, `revokedAt: null`, subject match, row expiry, `ACTIVE_USER`. The no-rotation decision of
2026-07-31 stands. The `revoked_reason` login report stands.

### Why not check with accounts on every refresh?

Because then the accounts service sits on the critical path for **every user of every app every 15
minutes**. One bad deploy there logs out the entire customer base across all products. It buys very
little: what it would catch (a centrally disabled account) is caught properly by back-channel logout
in §10, without the dependency.

**Consequence:** request `scope=openid profile email` and **not** `offline_access`. Accounts then
never issues us an OIDC refresh token at all — nothing extra to store, nothing extra to leak.

---

## 4. Domain and cookie topology

Everything lives under one registrable domain. This is not cosmetic — it is what makes §11 possible.

```
production   accounts.octfis.com           jobwork.octfis.com            DC in
staging      accounts-staging.octfis.com   jobwork-staging.octfis.com    DC com
local        accounts.octfis.localhost     jobwork.octfis.localhost      mkcert
                          └──── same site (octfis.com) in every environment ────┘
```

Browsers decide "same site" on the **registrable domain**, not the origin. So an
`accounts.octfis.com` iframe inside a `jobwork.octfis.com` page is same-site, not third-party — the
SSO cookie is sent and Chrome's storage partitioning does not split them apart. On two different
domains that would be dead in every modern browser, and §11 would be impossible.

### 🔴 The SSO cookie is host-only

```
Set-Cookie: __Host-sso=…; Secure; HttpOnly; SameSite=Lax; Path=/
```

The `__Host-` prefix is **enforced by the browser**: it rejects the cookie unless it is `Secure`,
`Path=/`, and carries **no `Domain` attribute**. That buys two permanent protections for free:

| Without it                                                                               | With `__Host-`                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `Domain=.octfis.com` sends the SSO cookie to every host under octfis.com                 | Sent to `accounts.octfis.com` only |
| Any subdomain can **set** a `.octfis.com` cookie that overwrites ours (_cookie tossing_) | The browser refuses the overwrite  |

**`SameSite=Lax`, not `Strict`, not `None`.** Lax is sent on top-level navigations, which is exactly
what the `/authorize` redirect is. Because the apps are same-site it is also sent inside the
check-session iframe. `Strict` would drop the cookie on arrival from another host and force a login
every single time — a subtle failure that looks like "SSO doesn't work".

### Subdomain hygiene is now a security control

One domain for everything means a **dangling CNAME is an attack path** — someone claims
`old-thing.octfis.com` and phishes on a domain our users trust. Keep an inventory of subdomains and
delete dead DNS records. `__Host-` blocks the cookie-tossing half of this; the phishing half is a DNS
job that nothing in this repo can do for you.

---

## 5. What goes central, what stays per app

Three layers. Centralising all three is the classic mistake.

| Layer             | Question                          | Where               | Why                                                                     |
| ----------------- | --------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| **Identity**      | Who are you?                      | 🟢 accounts service | email, password, MFA, email verification, the SSO session               |
| **Org directory** | Which companies do you belong to? | 🔴 **each app**     | see below                                                               |
| **Authorization** | What may you do _here_?           | 🔴 **each app**     | `permission_templates`, `roles`, `isOwner` are jobwork-specific, always |

### 🔴 Decision: organizations stay per app

Each app keeps its own `organizations` and `memberships`. "Acme Ltd" in jobwork and "Acme Ltd" in
another app are unrelated rows with unrelated ids.

**Why**, and this is the load-bearing reason: `tenantContext`
(`backend/src/middlewares/tenantContext.ts`) reads `memberships` **live on every request**, which is
what makes removing or deactivating a member take effect immediately on every device. If orgs moved
to the accounts service, that check becomes a cross-service HTTP call on every request — unacceptable
latency and a new single point of failure. Replicating a read-model back into each app would restore
the speed but adds eventual consistency and a reconciliation job, for a benefit no customer has asked
for yet.

**What we give up, consciously:** no cross-app view of a customer, no shared billing, and inviting
someone into an org in one app grants nothing in another. For two or three apps with mostly separate
customers that is the right trade.

**The door stays open.** If we later want the Zoho One experience — one company, all apps, one invite
— we add a central directory _alongside_ accounts and each app mirrors what it needs. That is
additive. Starting central and pulling apart is not. Per-app orgs is the low-regret choice.

### 🔴 The rule that keeps mixed tenancy easy

**Never put org or tenant information in the ID token.** The moment `orgId` or `orgs[]` becomes a
claim, the accounts service has to understand every app's tenancy model — and an app with no orgs at
all receives a claim it must remember to ignore.

The token stays identity-only:

```json
{ "sub": "…", "email": "…", "email_verified": true, "name": "…", "picture": "…", "sid": "…" }
```

With that rule, a multi-tenant app and an app with no tenancy read the identical token and simply do
different things after it. Mixed tenancy across the estate costs nothing.

---

## 6. The flows

### 6.1 Login (Authorization Code + PKCE — the only flow we use)

```
1. Browser → jobwork.octfis.com                          no local session
2. jobwork redirects browser → accounts.octfis.com/authorize
      ?client_id=jobwork
      &redirect_uri=https://jobwork.octfis.com/api/auth/callback
      &response_type=code
      &scope=openid profile email
      &state=<random>              ← CSRF: ties the callback to this browser
      &nonce=<random>              ← replay: ties the id_token to this request
      &code_challenge=<S256(verifier)>
      &code_challenge_method=S256
   …and stores {state, nonce, code_verifier, returnTo} in a short-lived httpOnly cookie.

3. accounts: is the __Host-sso cookie present and live?
      no  → render the login page, verify the password, set the SSO cookie
      yes → skip straight to 4                          ← THIS is "already signed in"

4. accounts redirects browser → jobwork.octfis.com/api/auth/callback?code=…&state=…

5. jobwork BACKEND (server-to-server, never the browser) calls accounts/token
      code + code_verifier + client_id + client_secret
   → { id_token, access_token }

6. jobwork verifies the id_token: signature via JWKS, then iss, aud, exp, nonce.

7. jobwork links/creates its local user by `sub`, creates its OWN session row,
   sets its OWN refresh cookie. Layer 1 takes over from here.
```

Step 5 is a back-channel call. **The client secret never reaches the browser.**

### 6.2 The second app

Identical, except step 3 finds the SSO cookie and returns instantly. No password, no form, no
perceptible pause. That is the entire user-visible feature.

### 6.3 Signup

Apps do not have a signup form any more. "Create an account" links to
`accounts.octfis.com/signup?client_id=jobwork&redirect_uri=…`. The user registers there, verifies
their email, and is handed back into 6.1 from step 3. `auth.routes.ts` loses `/signup`,
`/forgot-password`, `/reset-password`, and `/change-password` — those move to accounts.

### 6.4 Refresh

Unchanged. See §3. `POST /auth/refresh-token`, `refreshToken` httpOnly cookie scoped to `/api/auth`
(`backend/src/lib/cookies.ts:15`), row lookup in jobwork's `refresh_tokens`.

### 6.5 Logout — global by default

There are three logouts. **The plain "Log out" button does the global one.**

|                 | Kills                                                   | Where                                     |
| --------------- | ------------------------------------------------------- | ----------------------------------------- |
| **Local**       | this app's refresh token only                           | today's `logout()`, `auth.service.ts:413` |
| **Global**      | the SSO cookie **+ every app's** session for this `sid` | new — §10                                 |
| **All devices** | everything for this person, everywhere                  | accounts profile page                     |

🔴 **Why global is the default.** A local-only logout produces this:

```
Click "Log out"  →  land on the login page
Click "Sign in"  →  instantly back inside, no password typed
```

…because the SSO cookie is still alive. Users report that as a security bug, and they are not wrong
to. It is the single most common SSO complaint. It also matters more than usual here: these are
shop-floor terminals, and an operator walking away from a shared machine must be out of everything.

```
1. User clicks "Log out" in jobwork
2. jobwork revokes its own row (revoked_reason: 'logout') and clears its cookies
3. jobwork redirects browser → accounts/logout
     ?id_token_hint=<id_token>&post_logout_redirect_uri=https://jobwork.octfis.com/logged-out
4. accounts kills the __Host-sso cookie              ← no more silent re-login
5. accounts POSTs a signed logout token, server-to-server, to EVERY app
   holding a live session for that sid               ← §10, this is what makes it real
6. each app revokes its matching refresh_tokens rows
7. accounts redirects browser back → jobwork/logged-out
```

Skip step 5 and the SSO cookie is gone but the other apps' refresh tokens live on for seven days —
the user is not actually logged out of them at all.

---

## 7. The accounts service

> ✅ **Built.** `accounts/` — its own package, database (`accounts_dev`), Prisma schema, deploy
> entry and AppSail config. Boots, serves discovery and JWKS, and signs real tokens.
> 🔴 One correction to §7.3 below: `SsoSession.id` is the provider's session **uid**, not a `sid`,
> and neither is a uuid. See the note on the model.

### 7.1 Shape

A separate deployable: its own AppSail service, its own domain, its own Postgres database.

```
accounts/
  prisma/schema/     identity only — no tenants, no business data
  src/
    oidc/            node-oidc-provider + a Prisma adapter
    login/           login, signup, verify email, forgot/reset password
    logout/          RP-initiated logout + the back-channel sender
```

Built on **`node-oidc-provider`** (panva) — a certified OIDC provider that plugs into our own user
store. It supplies the protocol (`/authorize`, `/token`, `/jwks`, `/userinfo`, discovery, PKCE, code
handling, key rotation); we supply the Prisma adapter, the login screens, and the user store we have
already written in `auth.service.ts`.

The library is not compulsory — only speaking OIDC is. It was chosen because our existing auth code
is the asset: argon2 hashing, password reset, the invitations module, session revocation with
`revoked_reason` reporting, Zepto email templates. Every off-the-shelf product (Zitadel, Keycloak,
Logto, Auth0) makes us discard some of that and re-solve it their way. **Revisit that choice if we
need MFA, an admin console, or SAML for an enterprise customer** — Zitadel becomes the better buy at
that point, and switching is cheap as long as §14 is respected.

### 7.2 Why it must be its own service

| Reason                  | What breaks otherwise                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 **Its own domain**   | The design rests on the SSO cookie living on `accounts.octfis.com`. As a route inside the jobwork API the cookie belongs to jobwork's host, and nothing has been built. Decisive on its own. |
| **Independent deploys** | Shipping a jobwork bugfix must never risk logging every user out of every app.                                                                                                               |
| **Its own database**    | If identity sits in jobwork's DB, every other app needs a connection string to jobwork's DB — coupling two apps at the storage layer, the exact thing being escaped.                         |
| **Blast radius**        | It holds password hashes and signing keys and should hold nothing else — no vendors, no job orders, no batches.                                                                              |

**Same git repo — settled 2026-08-24, and no longer "for now."** A new top-level `accounts/` folder
beside `backend/` and `web/`. Separate database, separate code, separate deploy; shared repo.

The original note here said to split it out with `git filter-repo` "once a second app exists." The
second app now exists, and the answer went the other way on three counts:

- **Separation in-repo is nearly free.** Every per-folder command — `db:draft` / `db:promote` /
  `db:apply` / `db:check-drift`, `typecheck`, `lint`, `vitest` — lives in `backend/package.json` and
  runs relative to `backend/`. An `accounts/package.json` with its own copies and its own
  `prisma/schema` gets a genuinely separate database with **zero** shared-script surgery.
- **Same repo does not mean coupled deploy.** That was the real objection, and it was true of the
  script rather than the repo: `catalyst deploy --only appsail` pushes every entry in
  `catalyst.json`. Generating that file per deploy with one entry fixed it — §15. `deploy.mjs` now
  takes `<target> <service>` and neither is defaulted.
- **A separate repo would not have removed the cross-repo friction anyway.** App 2 lives in its own
  repo either way, so wiring it to accounts spans two repos regardless. The boundary between an app
  and accounts is **OIDC** — a versioned protocol, not an internal API — which is precisely the kind
  of contract that tolerates a repo boundary, and equally the kind that does not need one.

The cost of a separate repo was concrete: duplicating `deploy.mjs`, `lib/targets.mjs`,
`lib/cliLogin.mjs`, `build-app-config.mjs` and the db-sync scripts — ~600 lines of guardrail that
would drift. Splitting later is still cheap if this changes.

### 7.3 Schema

Conventions follow `prisma/schema/tenant.prisma`: `gen_random_uuid()` PKs, `@db.Timestamptz(6)`,
`@db.VarChar(n)` + comment instead of Prisma enums, `@@map("snake_case")`, `@db.Citext` for email.

**Two house rules from `CLAUDE.md` deliberately do NOT apply here**, and this is the reason so nobody
"fixes" it later:

- **No `custom_fields` column on anything.** Per-org dynamic fields are a tenant concept. The
  accounts database has no tenants.
- **No RLS policies.** RLS scopes rows to an `organizationId`. There is no organization to scope to;
  every row is global. `runAsTenant` does not exist in this service.

```prisma
/// The one identity. This row is what `sub` refers to in every ID token.
model User {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email         String    @unique @db.Citext
  emailVerified Boolean   @default(false) @map("email_verified")
  passwordHash  String?   @map("password_hash")
  firstName     String    @default("") @map("first_name") @db.VarChar(40)
  lastName      String    @default("") @map("last_name") @db.VarChar(40)
  avatarUrl     String?   @map("avatar_url")

  /// Same predicate as ACTIVE_USER in the app. Flipping either MUST revoke every
  /// SSO session in the same transaction and fire back-channel logout (§10) —
  /// otherwise deactivation takes effect only at each app's refresh boundary,
  /// which is up to seven days away.
  isActive      Boolean   @default(true) @map("is_active")
  isDeleted     Boolean   @default(false) @map("is_deleted")

  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  sessions      SsoSession[]

  @@map("users")
}

/// One row per browser that has an SSO cookie. `id` is the `sid` claim, and it is
/// the key every app stores and every back-channel logout names.
model SsoSession {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId        String    @map("user_id") @db.Uuid
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastUsedAt    DateTime? @map("last_used_at") @db.Timestamptz(6)

  /// Null = live. Set = ended, and the row stays — same rule as refresh_tokens.
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz(6)
  /// logout | expired | password_reset | account_disabled | admin_revoked
  revokedReason String?   @map("revoked_reason") @db.VarChar(32)
  userAgent     String?   @map("user_agent")

  /// Which clients this session actually signed in to. Without it, logout has to
  /// notify every registered app on every logout instead of only the ones with a
  /// live session — noisy, and it leaks which apps exist to any app that listens.
  grants        SessionGrant[]
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sso_sessions")
}

model SessionGrant {
  id         String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sessionId  String     @map("session_id") @db.Uuid
  clientId   String     @map("client_id") @db.VarChar(64)
  createdAt  DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)

  session    SsoSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, clientId])
  @@map("session_grants")
}

/// The client registry — every app allowed to use this IdP. §8.
model OidcClient {
  id                 String   @id @db.VarChar(64)          // 'jobwork', 'reports'
  name               String   @db.VarChar(80)
  secretHash         String   @map("secret_hash")           // argon2, never plaintext
  /// 🔴 EXACT match only. No wildcards, no prefixes. See §12.
  redirectUris       String[] @map("redirect_uris")
  postLogoutUris     String[] @map("post_logout_redirect_uris")
  backchannelLogoutUri String? @map("backchannel_logout_uri")
  isActive           Boolean  @default(true) @map("is_active")
  isDeleted          Boolean  @default(false) @map("is_deleted")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("oidc_clients")
}

/// Signing keys, in OUR database — not a cloud KMS. §14 rule 3: if the keys move
/// with us, every token issued before a host migration stays valid after it and
/// nobody is logged out by the move.
model SigningKey {
  kid        String    @id @db.VarChar(64)
  algorithm  String    @map("algorithm") @db.VarChar(16)    // EdDSA | RS256
  publicJwk  Json      @map("public_jwk")
  privateJwk Json      @map("private_jwk")                  // encrypted at rest
  /// Newest active key signs; older active keys stay published so tokens they
  /// signed still verify. Retire only after the longest token lifetime has passed.
  retiredAt  DateTime? @map("retired_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("signing_keys")
}
```

Authorization codes, device codes and other short-lived protocol grants are managed by
`node-oidc-provider` through its adapter interface — one `oidc_payloads` table with a TTL sweep.
They are ephemeral token storage and, like `refresh_tokens` in the app, carry no audit columns.

---

## 8. The client registry

> ⚠️ **Partly built.** The `oidc_clients` table and the loader exist, and secrets are argon2-hashed
> as described. Registering each app per environment is an operational step that has not happened —
> nothing is registered outside local development.

Each app is registered once:

| Field                  | jobwork                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `id`                   | `jobwork`                                                                   |
| `secretHash`           | argon2 of a 32-byte random secret, given to the app as `OIDC_CLIENT_SECRET` |
| `redirectUris`         | `https://jobwork.octfis.com/api/auth/callback`                              |
| `postLogoutUris`       | `https://jobwork.octfis.com/logged-out`                                     |
| `backchannelLogoutUri` | `https://jobwork.octfis.com/api/auth/backchannel-logout`                    |

Per environment — staging and production have different hostnames and therefore **different client
secrets and different registry rows**. Never share a secret across environments.

🔴 **`redirectUris` is matched by exact string equality.** Not prefix, not wildcard, not "same
origin". A sloppy match here is an open redirect, the attacker receives the authorization code, and
that is full account takeover. It is the single most common critical bug in home-made identity
providers. `node-oidc-provider` enforces exact matching by default — do not configure around it.

---

## 9. What changes in each app

> ✅ **Built** — `backend/src/modules/auth/sso/`, pinned by `sso.test.ts`.
> ⚠️ One row of §9.1 is deliberately NOT done: signup, forgot-password and reset still exist in the
> app. They now also exist in accounts, and removing the app's copies is §13 step 6, after every
> active user is linked. Two implementations run side by side on purpose, for one release.

### 9.1 jobwork

| File                                                                              | Change                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.service.ts` → `refresh`                                                     | **nothing**                                                                                                                                                                                                                  |
| `auth.service.ts` → `logout`                                                      | still revokes the local row, then the controller redirects to accounts                                                                                                                                                       |
| `auth.service.ts` → `login`                                                       | replaced by the callback handler below                                                                                                                                                                                       |
| `auth.service.ts` → `signup`, `forgotPassword`, `resetPassword`, `changePassword` | **deleted** — they live in accounts                                                                                                                                                                                          |
| `auth.routes.ts`                                                                  | drop `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/change-password`; add `/auth/login` (redirect initiator), `/auth/callback`, `/auth/backchannel-logout`. `/refresh-token`, `/me`, `/me/sessions` untouched |
| `middlewares/authenticate.ts`                                                     | **nothing**                                                                                                                                                                                                                  |
| `middlewares/tenantContext.ts`                                                    | **nothing**                                                                                                                                                                                                                  |
| `requirePermission`                                                               | **nothing**                                                                                                                                                                                                                  |
| `User` model                                                                      | `+ identityUserId`                                                                                                                                                                                                           |
| `RefreshToken` model                                                              | `+ idpSessionId`, `+ idpSubject`                                                                                                                                                                                             |
| `web/src/api/endpoints.ts`                                                        | auth paths follow the route changes                                                                                                                                                                                          |

The middleware layer — the genuinely security-critical part, the part already correct — does not move
at all. That is the point of Layer 1 surviving intact.

```prisma
model User {
  // …existing columns unchanged…

  /// The `sub` from the accounts service. Set ONCE, at first sign-in after the
  /// cutover, then never rewritten. 🔴 `id` remains the FK target for every
  /// membership, createdBy and updatedBy in this database — repointing those at
  /// the identity id would rewrite nine schema files for no benefit.
  identityUserId String? @unique @map("identity_user_id") @db.Uuid
}

model RefreshToken {
  // …existing columns unchanged…

  /// `sid` from the ID token — which SSO session created this app session.
  /// 🔴 NOT the same thing as the `sid` claim in our own access token, which is
  /// this row's `id`. Two different ids, one word; conflating them in the revoke
  /// path fails open. Never name this column `sid`.
  idpSessionId String? @map("idp_session_id") @db.Uuid
  /// `sub` — for "disable this account everywhere", which has no single sid.
  idpSubject   String? @map("idp_subject") @db.Uuid

  @@index([idpSessionId])
  @@index([idpSubject])
}
```

Add `sso_logout` and `account_disabled_central` to the `revokedReason` comment list.

### 9.2 The callback handler

```ts
// The ONLY place in the app where an IdP token is read.
export async function callback(req: Request, res: Response) {
  const flow = readAndClearFlowCookie(req, res); // { state, nonce, codeVerifier, returnTo }
  if (!flow || flow.state !== req.query['state']) {
    throw ApiError.badRequest('Sign-in expired. Please try again.');
  }

  const tokens = await oidc.exchangeCode(req.query['code'], flow.codeVerifier);
  const claims = await oidc.verifyIdToken(tokens.id_token, flow.nonce); // sig, iss, aud, exp, nonce

  const user = await linkOrCreateLocalUser(claims);
  const session = await createSession(user.id, {
    idpSessionId: claims.sid,
    idpSubject: claims.sub,
    userAgent: req.get('user-agent'),
  });

  setRefreshCookie(res, session.token);
  res.redirect(await landingPathFor(user, flow.returnTo));
}
```

```ts
async function linkOrCreateLocalUser(claims: IdTokenClaims) {
  const linked = await prisma.user.findUnique({ where: { identityUserId: claims.sub } });
  if (linked) {
    if (!isUsableAccount(linked)) throw new ApiError(403, 'This account has been disabled.');
    return linked;
  }

  // 🔴 One-time migration affordance ONLY: match a pre-existing row by email, once,
  // then stamp identityUserId and never look up by email again (people change
  // emails; `sub` is forever). `email_verified` is load-bearing — without it anyone
  // who registers at accounts with someone else's unverified address takes over
  // their jobwork account. Delete this branch once §13 step 6 is done.
  if (claims.email_verified) {
    const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { identityUserId: claims.sub },
      });
    }
  }

  return provisionOrRefuse(claims);
}
```

### 9.3 🔴 Per-app entitlement — the one genuinely new problem

Today, having an account in jobwork **means** you are a jobwork user. After SSO, everyone in the
identity system can reach every app's login and obtain a valid token. Each app must independently
decide whether this person gets in. `provisionOrRefuse` is where that decision lives, and every app
must make it **explicitly and fail closed** — an app with no entitlement check silently turns every
identity in the estate into one of its users. Same failure shape as a route with no
`requirePermission`.

| Policy          | Behaviour                                                                           | Fits                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**        | auto-provision anyone with an account                                               | internal tools                                                                                                                            |
| **Invite-only** | no local row → _"You don't have access to this app. Ask your admin to invite you."_ | 🟢 **jobwork** — `src/modules/invitations/` already does the other half; it stops creating passwords and starts stamping `identityUserId` |
| **Org-gated**   | in if any of your orgs has this app enabled                                         | needs the central directory we deliberately did not build (§5)                                                                            |

### 9.5 🔴 One way in, enforced by the router

Decided 2026-08-24, and it supersedes the earlier plan of showing the SSO button
_beside_ the password form.

When `SSO_ENABLED` is true, four routes are **not mounted at all**:

| Route                        | Why it is a way IN                                        |
| ---------------------------- | --------------------------------------------------------- |
| `POST /auth/signup`          | creates a local account with a local password             |
| `POST /auth/login`           | uses one                                                  |
| `POST /auth/forgot-password` | **SETS** one — easy to miss, and a full bypass on its own |
| `POST /auth/reset-password`  | the other half of that same bypass                        |

🔴 **Hiding the forms in the web app is not enforcement, it is a suggestion.** With
the routes still mounted, `POST /auth/signup` answered **201** to anything that
asked — verified against the running app before the guard went in, and it really did
create an account. Anyone with curl could keep minting local accounts that the
identity provider knows nothing about and cannot disable.

The two password-recovery routes are the ones most easily forgotten. A reset does
not merely _use_ a password, it **sets** one, so leaving them mounted leaves a way
to give any existing account a local credential and then sign in with it — SSO
entirely bypassed, without ever touching the login route.

Not mounted rather than answering 403: an absent route cannot be reached by a stale
client at all, and the 404 says plainly that this app no longer does this.

`POST /auth/change-password` is deliberately left mounted. It needs a live session
**and** the current password, so it is not a way in, and an account predating the
cutover may still have a local password it wants to change.

The rollback is unchanged: `SSO_ENABLED=false` restores all four routes and unmounts
the SSO ones. One way in at a time, chosen by one variable.

### 9.4 Landing: multi-tenant vs no-tenant

The only place tenancy appears in the login path. Two apps, same token, different function:

```ts
// jobwork — multi-tenant
async function landingPathFor(user: User, returnTo?: string) {
  const orgs = await prisma.membership.findMany({
    where: {
      userId: user.id,
      isDeleted: false,
      isActive: true,
      organization: { isDeleted: false },
    },
    select: { organizationId: true },
  });

  if (orgs.length === 0) return '/no-access'; // §9.3 — never auto-create an org here
  if (returnTo) return returnTo; // deep link the user originally wanted
  if (orgs.length === 1) return `/organizations/${orgs[0]!.organizationId}`;
  return '/organizations'; // the picker
}

// an app with no tenancy — the whole difference
async function landingPathFor(_user: User, returnTo?: string) {
  return returnTo ?? '/dashboard';
}
```

That is the entire cost of supporting mixed tenancy across the estate, and it is only possible
because of the §5 rule that orgs never appear in the token.

---

## 10. Revocation

> ✅ **Built.** The receiving endpoint verifies signature, `iss`, `aud`, a recent `iat`, the `events`
> claim and the absence of `nonce`; accounts retries delivery with backoff, which the library does
> not do on its own.
> 🔴 It cannot be exercised against `localhost` at all — see the SSRF note in §10.3.

### 10.1 The chain, after SSO

| What changes                                          | Takes effect                                        | Enforced by                                        |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Member removed / deactivated in an org                | **immediately, every device**                       | `tenantContext` reads memberships live — unchanged |
| Permission template edited                            | **immediately**                                     | same                                               |
| User logs out of jobwork                              | refresh dies now; the current access token ≤ 15 min | `markSessionRevoked` — unchanged                   |
| **Central account disabled, or "log out everywhere"** | ⚠️ **up to 7 days** without the next section        | 🔴 the new gap                                     |

### 10.2 Back-channel logout closes it

Accounts POSTs a signed logout token to each app that holds a live session. No polling, no
per-request dependency, no cross-service call on the hot path.

```ts
// POST /api/auth/backchannel-logout   — called by accounts, never by a browser
export async function backchannelLogout(req: Request, res: Response) {
  const claims = await verifyLogoutToken(req.body.logout_token); // sig via JWKS, iss, aud, events

  const where = claims.sid
    ? { idpSessionId: claims.sid, revokedAt: null } // one browser
    : { idpSubject: claims.sub, revokedAt: null }; // the whole account, everywhere

  await prisma.refreshToken.updateMany({
    where,
    data: { revokedAt: new Date(), revokedReason: 'sso_logout' },
  });

  // Deliberately NOT sendSuccess: the OIDC back-channel logout spec fixes this
  // response shape, and the caller is the accounts service, not `api/client.ts`.
  // The envelope rule in CLAUDE.md governs endpoints our own frontend reads.
  res.status(200).json({});
}
```

The revoke itself is code that already exists — `revokeUserSessions`
(`backend/src/lib/authGuards.ts:61`) is this same `updateMany`, filtered by `userId` instead.

### 10.3 Two honest limits

**Open tabs keep working for up to 15 minutes.** Back-channel logout kills refresh tokens instantly,
but an already-issued access token stays valid until it expires, because `authenticate` does no
database lookup — a deliberate 2026-07-24 decision. If that feels too loose for logout specifically,
shorten `JWT_ACCESS_TTL` to `5m`; it is cheap and cuts the window by two thirds. **Do not** close it
by adding a per-request session lookup — that is the exact thing the architecture rejected, and
`middlewares/authenticate.test.ts` pins the current behaviour.

🔴 **Back-channel logout cannot be tested against `localhost`.** Discovered 2026-08-24 while
building it. `oidc-provider` wraps its outgoing fetch in **SSRF protection** that refuses every
special-use IP range, `127.0.0.0/8` included — so a client registered with a
`http://localhost:3000/...` back-channel URI gets `fetch failed`, forever, with retries doing exactly
what they should and never succeeding. That is the library behaving correctly: a client registry is
attacker-influenced input, and without the guard registering a client would be a way to make the IdP
POST to anything inside the network.

The consequence is practical, not theoretical: **this one flow only works end to end against real
hostnames**, which is another reason §15's staging domains matter. Locally, the two halves have to be
tested separately — the receiver by posting a genuinely signed logout token at it, which is what was
done here. Do not "fix" it by disabling the SSRF protection.

**Delivery can fail.** If an app is mid-deploy when the logout fires, it misses the notification and
its refresh token survives. Accounts must **retry with backoff and log failures** — treat it as a
webhook, not a function call. Without retries "log out everywhere" is best-effort in a way nobody
notices until it matters.

---

## 11. Instant cross-tab sign-in and sign-out

> ❌ **Not built, on purpose.** Deferred out of phase 1 by this document, and untestable until the
> real domains exist — it is the one feature that genuinely depends on the same-site relationship.

The redirects in §6 give "signed in on the next navigation". The instant behaviour — every tab
reacting within seconds, no refresh — is a **separate layer on top**, and it is what people actually
notice about Zoho.

### How it works

An app cannot read the accounts cookie. But an iframe **from** `accounts.octfis.com`, embedded in the
jobwork page, can — inside that iframe the cookie is first-party, and because §4 put both hosts on
one registrable domain the browser treats it as same-site rather than blocking it.

```
┌─ jobwork.octfis.com (the page) ──────────────────────────┐
│   app JS ──postMessage("still signed in?")──┐            │
│                                             ▼            │
│   ┌─ hidden iframe: accounts.octfis.com/checksession ─┐   │
│   │   can read __Host-sso  ✓                          │   │
│   │   replies "unchanged" / "changed"                 │   │
│   └───────────────────────────────────────────────────┘   │
│         │ "changed"                                       │
│         ▼                                                 │
│   silent re-check in a second hidden iframe:              │
│      /authorize?prompt=none                               │
│        → signed in  → new tokens, page updates            │
│        → signed out → clear session, redirect to login    │
└───────────────────────────────────────────────────────────┘
```

This is **OpenID Connect Session Management 1.0**. The ping is a `postMessage` — no network request,
no server load. It delivers both directions: sign out anywhere and every tab follows within seconds;
sign in anywhere and every tab signs itself in without a refresh.

### Build order

**Do not build this in phase 1.** Ship §6 and §10 first — they are the security boundary. This layer
is UX polish and can be swapped or dropped. A tab that syncs in ten seconds instead of one is a minor
annoyance; a refresh token that survives logout is an incident.

| Approach                              | Instant?     | Cross-domain?     | Cost                                                                                                                                                    |
| ------------------------------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poll our own `/api/auth/session`      | ~5–30 s      | ✅                | one request per tab per interval; ~10 lines. **Start here.**                                                                                            |
| Iframe + `prompt=none` (the Zoho way) | ✅           | ❌ same-site only | spec-defined, no server load                                                                                                                            |
| Iframe + `BroadcastChannel` relay     | ✅ true push | ❌ same-site only | every app embeds an accounts-origin iframe; those iframes share one origin and broadcast to each other, each relaying to its parent. No polling at all. |
| SSE / WebSocket from our own backend  | ✅ true push | ✅                | fed by §10. ⚠️ verify AppSail's idle-connection timeout — load balancers cut long-lived connections                                                     |

`BroadcastChannel` alone is same-**origin**, so it syncs tabs of one app but never reaches another
app. The iframe relay is what bridges it. Logged-out tabs must poll too — that is what makes the
_sign-in_ direction instant.

---

## 12. Security checklist — non-negotiables

> ✅ **Every line enforced**, and the ones that fail silently are pinned by tests:
> `backend/.../sso.test.ts` and `accounts/src/oidc/crypto.test.ts`.

| Rule                                                                                                             | What breaks without it                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Exact `redirect_uri` allowlist.** No wildcards, no prefixes, no "same origin"                                  | Open redirect → the attacker receives the code → full account takeover. **The #1 hole in hand-rolled IdPs.** |
| **PKCE (S256) on every client**, confidential ones included                                                      | A stolen authorization code is replayable                                                                    |
| **`state` and `nonce`** — random, single-use, held in a short-lived httpOnly cookie, compared on callback        | Login CSRF; ID-token replay                                                                                  |
| **Authorization codes single-use, ≤ 60 s TTL**, bound to `client_id` + PKCE. Second use → revoke the whole grant | Replay                                                                                                       |
| **Sign with EdDSA or RS256, publish JWKS, rotate with `kid`.** Apps only ever verify                             | A shared symmetric secret lets any app mint tokens for any other app                                         |
| **Audience-scope every token (`aud`)**                                                                           | App B replays App A's token                                                                                  |
| **`__Host-` prefix on the SSO cookie; tokens in httpOnly cookies, never localStorage**                           | Cookie tossing; any XSS in any app steals the session                                                        |
| **`email_verified` checked before linking an existing account by email**                                         | Anyone registering with someone else's address inherits their account                                        |
| **argon2id, rate limiting, lockout, MFA — at accounts only**                                                     | Implemented four times, wrong three times                                                                    |
| **Read the user _before_ checking the password** (`isUsableAccount`)                                             | A disabled account is distinguishable from a wrong password                                                  |

---

## 13. Migration plan

Order matters. Each step is independently deployable and reversible.

1. ✅ **Stand up `accounts.octfis.com`** with its own database. Nothing points at it yet. Register the
   `jobwork` client per environment.
   **Done as code 2026-08-24** — the service runs, on its own `accounts_dev` database, with the
   protocol endpoints, login/consent screens, signup, email verification and password reset. ⚠️ NOT
   done as infrastructure: no staging or production database, no mapped domain, nothing deployed.
2. **Seed identities** — the union of every app's users, deduped by email (`@db.Citext` already, so
   case is handled). Where one email has different password hashes in two apps, keep the most
   recently used and tell those users at cutover. Do not guess silently.
3. ✅ **Add `identityUserId` to each app's `users`**, plus `idpSessionId` / `idpSubject` on
   `refresh_tokens`, all nullable. `npm run db:draft` → edit → `db:promote` → `db:apply`. Nullable
   columns on existing tables, no backfill, no destructive SQL.
   **Done in jobwork 2026-08-24** — `20260824064102_add_sso_identity_columns`. Every row is null,
   nothing reads or writes them, and no code path changed; `identity_user_id` carries a UNIQUE index,
   which is safe on an all-NULL column because Postgres treats NULLs as distinct. Still to do in the
   second app. Note this step was deliberately taken **out of order**, ahead of step 1 — it is
   independently deployable and reversible, so it de-risks the cutover without waiting on accounts.
4. ✅ **Cut jobwork over** behind a feature flag, keeping local password login as the rollback path for
   one release. Existing users link on first SSO sign-in via the email branch in §9.2.
   **Built 2026-08-24.** `SSO_ENABLED` gates it, and with the flag off the routes are not mounted at
   all rather than merely disabled. The web app reads the flag at RUNTIME from `GET /auth/config`,
   because a flag compiled into the bundle would need a frontend redeploy to roll back — at exactly
   the moment nobody can sign in. The password form stays visible beneath the SSO button for the
   same reason. Not yet switched on anywhere.
5. **Watch the link rate.** When effectively every active user has a non-null `identityUserId`, the
   flag comes out.
6. **Delete the email-matching branch**, then **drop `password_hash` from every app database.** A
   password stored in two places is a password that goes stale in one of them.
7. ✅ **Add back-channel logout** (§10), then the instant sync (§11).
   Back-channel logout is **built** — receiver, full token validation, and delivery retries the
   library does not provide. RP-initiated logout is built too: jobwork's logout revokes locally and
   then hands the browser to accounts, without which "log out" leaves the SSO cookie alive and the
   next sign-in completes silently. §11 is **not** built — see the note on that section.

Do not reorder 6 before 5. Until every active user is linked, the email branch is the only thing
letting them in.

---

## 14. Portability rules

We deploy to Catalyst AppSail today. The whole point of choosing a protocol rather than a product is
that this stays true on AWS, a VPS, or anywhere else. Five rules protect that:

🔴 **Rule 1 is the one thing on this page that is still an ACTION, not a rule to respect.** The
code is written to it — the issuer is config, never derived from a host — but no `octfis.com` name
points at accounts yet, so every token so far has been signed by `http://localhost:3100`. Nothing is
lost while that is true (those tokens are local dev only). It stops being free the moment a real user
signs in, because the issuer is baked into every token already issued.

1. **Own the domain, not the host.** `https://accounts.octfis.com` is the contract; apps must never
   see a `*.catalystserverless.com` URL. 🔴 Set this up on day one — the issuer URL is baked into
   every token, and changing it later invalidates all of them at once.
2. **All state in our Postgres** — users, clients, codes, sessions, keys. Not in a host's managed
   store. Then "moving" is repointing `DATABASE_URL`.
3. **Own the signing keys** (§7.3). If the keys travel with us, every token issued before a migration
   is still valid after it and nobody is logged out by the move.
4. **Ship a plain container.** No host SDK anywhere in the auth path — not Catalyst's, not Cognito's,
   no function-only handler shapes. If it runs under `docker run`, it runs anywhere.
5. **Apps verify statelessly via JWKS.** Never "call the IdP to check this token." This is what lets
   the IdP be moved behind a DNS change instead of a maintenance window.

Following these, the migration off Catalyst is: deploy the same container elsewhere, repoint DNS,
done. No app changes, no config changes, no logouts.

### Why not Catalyst's native Authentication

It is built to be a **relying party**, not an identity provider for other apps: its "third-party
authentication" feature has an external service authenticate the user and then mints a _Catalyst_
token. There is no `/authorize` + `/token` + `/jwks` surface for another app to redirect into — which
is precisely the product we need. It is also configured per application (a second app is a second
user pool, the problem we are solving), our staging and production live under different Zoho accounts
in different data centres, `created_by` FKs cannot point at a Catalyst user, and password hashes are
not exportable — so there is no way back out.

---

## 15. Deployment

Catalyst allows **up to 5 mapped domains per application**, with group SSL certificates provisioned
free, and the domain must already be hosted live. Two are needed.

**The deploy path is ready for this, and accounts is already registered** (2026-08-24, before the
service exists). `catalyst.json` is no longer committed: `scripts/deploy.mjs` generates it per deploy
with only the service being deployed, because `catalyst deploy --only appsail` is resource targeting
and would otherwise push every entry in that array. What is committed today:

```jsonc
// deploy/services.json — what each service IS
"accounts": {
  "source": "accounts",
  "appsail": "octfis-accounts",        // default; overridden per target
  "appConfigBase": "accounts/app-config.base.json",
  "appConfigOut": "accounts/app-config.json",
  "localEnv": "accounts/.env",
  "build": ["build:accounts"],
  "requiredEnv": ["DATABASE_URL", "OIDC_ISSUER"]
}

// deploy/targets.json — WHERE it lands, per target
"staging":    { "accounts": { "envFile": "accounts/.env.staging",
                              "appsail": "octfis-accounts-staging" } }
"production": { "accounts": { "envFile": "accounts/.env.production" } }  // default name
```

- ⚠️ **Registered but not yet deployable.** `accounts/`, its `app-config.base.json` and the
  `build:accounts` script do not exist, so a deploy of it fails on the missing env file — clearly,
  and before writing anything. Deploying `api` is unaffected.
- 🔴 **Not named `jobwork-accounts`.** Accounts is estate-wide shared infrastructure with its own
  domain (§14), and jobwork is only its first client; naming it after one client would bake that
  inversion into the console and the URLs.
- 🔴 **Accounts is a different AppSail in each target.** Staging and production are different Zoho
  accounts in different data centres, so staging overrides the name and production takes the default.
  The `api` service keeps one name for both; only accounts diverges. The banner printed by
  `node scripts/deploy.mjs <target> accounts` is the authority on which name a create-flow prompt
  wants.
- `requiredEnv` is the minimum the design already fixes — `DATABASE_URL` because all state lives in
  our Postgres (§14 rule 2), `OIDC_ISSUER` because the issuer is baked into every token and cannot
  change later (§14 rule 1). Signing keys are **not** env vars: §7.3 keeps them in `signing_keys`.
  Grow the list as the service is built.
- 🔴 **`accounts/.env` is parked out of the upload** like `backend/.env`. `build_path` is `.` relative
  to each source folder, so anything left there is zipped — `deploy.mjs` parks the deployed service's
  local env to `.env.deploy-backup-<service>`.
- A service entry may also override `catalystrc`. That is the escape hatch for the next item without
  reshaping anything.
- **Verify once in the console:** that two mapped domains in one project can point at two _different_
  AppSail services. If mapping turns out to be project-wide, put accounts in its own Catalyst project
  — no design change, just another `catalystrc` and a per-service override pointing at it.
- **Staging must mirror the domain topology** — but not for the reason first written here.

  _Corrected 2026-08-24._ The original claim was that the default Catalyst hostnames "would not be
  same-site (that domain is very likely on the Public Suffix List)". A check of
  `publicsuffix.org/list/public_suffix_list.dat` found **no entry** for `catalyst*`, `zoho` or
  `appsail`. Treat that as probable, not certain — the list is ~250KB and the fetch may have been
  summarised — but do not plan around the PSL claim as written.

  The conclusion survives the correction, because both branches are bad:

  | If `catalystappsail.com` is… | Then staging…                                                                                                                                                                                                                      |
  | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **not** on the PSL (likely)  | is same-site — and so is **every other Zoho customer's app**, because they share the registrable domain. `SameSite=Lax` stops treating other Catalyst tenants as cross-site. Production under `octfis.com` has no such neighbours. |
  | on the PSL                   | is cross-site, §11 fails there while working in production, and it looks like the design is broken when it is not.                                                                                                                 |

  Either way staging exercises a topology production does not have, which is the whole point of
  having a staging environment for this.

  🔴 **Be accurate about what a Catalyst hostname actually breaks**, or this reads as scaremongering
  and gets ignored. The phase-1 login flow **works** cross-site: Authorization Code + PKCE is
  top-level redirects, `SameSite=Lax` sends the cookie on a top-level GET navigation, `__Host-` works
  on any HTTPS host, and back-channel logout is server-to-server. What you lose is (a) §11's silent
  `prompt=none` iframe, which is third-party cookie territory and is deferred out of phase 1 — so it
  bites later, in production; (b) an issuer on a host we do not own, which §14 rule 1 says is baked
  into every token; and (c) any rehearsal of the thing that actually misbehaves when domains are wrong.

  **Also practical:** a default AppSail hostname is `<app>-<zaid>.<env>.catalystappsail.com`, so
  `accounts-staging.catalystappsail.com` is not a name that can simply be chosen — getting a clean
  hostname means mapping a domain, at which point map one we own. ⚠️ Note that
  `backend/.env.staging` currently has `APP_URL=https://jobwork.development.catalystappsail.com`,
  which has no ZAID and does not match that pattern — either something is already mapped there or
  that value is stale. Confirm before planning around it.

  **The recommendation:** map `accounts-staging.octfis.com` **and** `jobwork-staging.octfis.com`.
  We already own `octfis.com`, group SSL is free, and the limit is 5 mapped domains per app — two
  DNS records against the cost of finding cookie problems in production. Production already has
  `jobwork.octfis.com`, so only `accounts.octfis.com` is outstanding there.

- Domain mapping targets the **production** URL of a project, so the Development environment and
  localhost have no mapped domain. Local development needs `mkcert` and hosts entries to reproduce
  the same-site relationship — do this early, because the cookie and iframe behaviour is exactly what
  misbehaves when the domains are wrong.

---

## 16. Open questions

Decisions not yet made. None blocks starting.

- **`node-oidc-provider` vs Zitadel.** Settled for now on the library (§7.1). Revisit the moment MFA,
  an admin console, or SAML is needed — §14 is what keeps that switch cheap.
- **The `refreshToken` cookie is `SameSite=None` in production** (`backend/src/lib/cookies.ts:20`),
  which is what `docs/AUTHENTICATION.md` §7 warns about — `SameSite` alone is not CSRF protection in
  a cross-site setup. Once web and API are same-site under `octfis.com`, this should become `Lax`.
  Worth doing as part of this work; not caused by it.
- **Retention.** Neither `refresh_tokens` nor `sso_sessions` purges anything. Two tables that only
  grow. Decide a rule before either matters.
- **MFA** has no home yet. It belongs at accounts, and only at accounts.
- **Profile ownership.** Name and avatar exist centrally _and_ per membership (`Membership.firstName`
  already overrides per org). Central as the default, membership as the override, is the intended
  reading — confirm before building the profile screen.

---

## 17. Glossary

| Term                    | Plain meaning                                                              |
| ----------------------- | -------------------------------------------------------------------------- |
| **IdP / OP**            | Identity provider — the accounts service. "OpenID Provider" in the spec    |
| **RP / client**         | An app that asks the IdP who you are. jobwork is one                       |
| **OIDC**                | OpenID Connect — OAuth 2.0 plus an identity layer                          |
| **`sub`**               | The permanent id of a human at the IdP. The join key, forever              |
| **`sid`**               | The IdP session id — one browser. Stored per app as `idpSessionId`         |
| **ID token**            | A signed JWT saying who the user is. Read once, at login                   |
| **PKCE**                | Proves the app that redeems the code is the one that started the flow      |
| **`state`**             | Random value tying the callback to the browser that began it. CSRF defence |
| **`nonce`**             | Random value tying the ID token to one request. Replay defence             |
| **JWKS**                | The IdP's published public keys, so apps verify signatures offline         |
| **Back-channel logout** | Server-to-server logout notification from IdP to each app                  |
| **Same-site**           | Same registrable domain (`octfis.com`) — not the same origin. §4           |
| **JIT provisioning**    | Creating the local user row on first sign-in                               |
