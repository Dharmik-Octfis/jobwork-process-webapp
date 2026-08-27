# SSO, end to end — how signing in actually works

**Start here.** This is the worked example: one person, one sign-in, every request, every
redirect, every row written, with real payloads. If you want the design reasoning and the
rejected alternatives, that is `SSO_AND_IDENTITY.md`. If you want to know what happens when
someone clicks **Sign in**, you are in the right file.

> **Status:** built and running locally. `SSO_ENABLED` is **off** in every deployed
> environment, so password login is still the only way in today. Everything below is what
> happens when the flag is on — which it is on a developer machine.

---

## 1. The problem, in one paragraph

Before SSO, jobwork checked your password itself. That works fine until there are two apps,
because then there are two passwords, two signup forms, two "forgot password" flows, and
disabling a leaver means remembering every app they had. SSO moves **who you are** into one
service that every app asks. jobwork stops storing passwords and starts trusting a signed
answer from that service.

**The one-sentence version:** you log in at `accounts`, `accounts` hands jobwork a signed
note saying "this is James, and I checked", and jobwork then runs its own normal session
exactly as before.

---

## 2. The cast

Three servers. On a developer machine they are three terminals.

| Name                        | Local URL               | Folder      | What it is                              |
| --------------------------- | ----------------------- | ----------- | --------------------------------------- |
| **web**, a.k.a. **the SPA** | `http://localhost:5173` | `web/`      | The React app. Vite dev server.         |
| **jobwork API**             | `http://localhost:3000` | `backend/`  | The app you already know.               |
| **accounts**                | `http://localhost:3100` | `accounts/` | The identity provider (the "IdP"). New. |

**"SPA" below always means `web/`, never accounts.** It is worth being precise about, because
the two front ends are built in completely different ways and the flow depends on the
difference:

|             | Built how                                                                                                                                | Consequence for sign-in                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `web/`      | React in the browser; talks to the API by `fetch`                                                                                        | Navigating away **unloads it** — it loses any access token held in memory      |
| `accounts/` | Express + `oidc-provider`, **plain server-rendered HTML** (`src/interaction/views.ts`, `src/login/account.views.ts`) — no React, no Vite | Its login form is an ordinary page, so steps 3–6 are page loads, not API calls |

In production `web` and `jobwork API` are the **same origin** — Vite builds into the API's
`public/` folder — so there is no `:5173` hop. `accounts` stays a separate host.

**Two databases, and they never share a connection.**

| Database    | Owned by    | Holds                                                             |
| ----------- | ----------- | ----------------------------------------------------------------- |
| jobwork DB  | `backend/`  | organizations, memberships, vendors, items, jobwork — and `users` |
| accounts DB | `accounts/` | identities, passwords, SSO sessions, OIDC protocol rows           |

Yes, **`users` exists in both**, and that is deliberate. See §7.

---

## 3. The golden rule: two layers, and accounts is only in one of them

This is the single most important idea in the whole design, and it explains most of the
"why is it done that way" questions below.

```
LAYER 2 — used ONCE, at sign-in                LAYER 1 — used every 15 minutes, forever
browser ─── accounts ─── jobwork API           browser ─────────────── jobwork API
        (OIDC, this document)                          (jobwork's own refresh_tokens)
```

After the sign-in redirect finishes, **jobwork never contacts accounts again**. Not on the
next request, not at refresh, not ever — until the next sign-in. If accounts is down, people
already signed in keep working normally; only new sign-ins fail.

That is why jobwork still has `refresh_tokens`, still issues its own access tokens, and why
`authenticate` / `tenantContext` / `requirePermission` are completely unchanged by SSO.

---

## 4. The worked example

**James Walker** works at OCTFIS TECHNO LLP. They have an identity at accounts and a jobwork
account. They open jobwork and click **Sign in**.

Identifiers used throughout (all fake, but the right _shape_):

```
accounts users.id  (the "sub")   8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab   uuid
jobwork  users.id                3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5   uuid  ← different!
organization id                  b41f7a90-2c3d-4e58-8a71-9f0b6d2e4c13   uuid
interaction uid                  YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS   43-char nanoid
SSO session uid                  aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD   43-char nanoid
SSO session jti  (_session)      Hn4KpQ2rTvXz7B9cLmS3dF6gJ8kW1yA5eR0uZoI-tNb   43-char nanoid  ← same session, rotates
sid, for jobwork                 btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM   43-char nanoid  ← per app
authorization code               TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi   43-char nanoid
```

> 🔴 **`sub` and `users.id` are two different values.** The identity's id lives in the
> accounts DB; jobwork's own `users.id` is what every `membership`, `created_by` and
> `updated_by` in the jobwork DB points at. jobwork records the identity id **beside** its
> own, in `users.identity_user_id`. It never substitutes one for the other.

---

### Step 0 — The login screen asks one question

James opens `http://localhost:5173/login`. Before rendering anything, the SPA asks the API
whether SSO is on.

```http
GET http://localhost:5173/api/auth/config      → proxied to :3000
```

```jsonc
{
  "statusCode": 200,
  "message": "Success",
  "data": { "ssoEnabled": true },
}
```

**Reads:** nothing — it is an environment flag.

```ts
sendSuccess(res, { ssoEnabled: env.sso.enabled }); // auth.controller.ts — the entire handler
```

#### Why ask at runtime instead of baking it into the bundle

This flag is the **rollback switch**. If SSO breaks, an operator flips it and restarts the
API. If it were compiled into the JavaScript, rolling back would need a rebuild and redeploy
of the web app **at the exact moment nobody can sign in** — the worst possible time to need a
build to succeed.

#### One boolean, and deliberately nothing else

This endpoint is **unauthenticated** — it has to be, since it runs before anyone can log in.
So what it declines to say matters as much as what it says:

| Returned           | Never returned                             |
| ------------------ | ------------------------------------------ |
| `ssoEnabled: true` | the issuer URL — where accounts even lives |
|                    | the client id                              |
|                    | which other apps exist in the estate       |

An anonymous caller learns _"this app uses SSO"_ and stops there. The browser is told where
accounts is **one hop at a time**, by redirect (steps 2 and §6.2), never by a discoverable
list. Same reasoning as the signup redirect: the estate's shape is not public.

`ssoEnabled: true` → the page shows a single **Sign in** button and _no password fields_.

---

### Step 1 — Clicking "Sign in" unloads the React app

```js
window.location.assign('http://localhost:5173/api/auth/sso/login?returnTo=/organizations');
```

**That URL is still `:5173`, and that is not a contradiction** — an _origin_ is not an
_application_. In dev the Vite server answers two unrelated things on one port:

| URL on `:5173`               | Answered by                          | React involved? |
| ---------------------------- | ------------------------------------ | --------------- |
| `/login`, `/organizations/…` | the React bundle — **the SPA**       | yes             |
| `/api/…`                     | proxied straight to `:3000`, Express | **no**          |

So the browser keeps the address and leaves the program. In production the question does not
arise: Vite builds into `backend/public`, so web and API genuinely **are** one origin (§2) —
which is why the code says `window.location.origin` and needs no per-environment config.

🔴 **What actually leaves is the `assign`, not the port.** This is a full page navigation, not
a `fetch` — and not `navigate()` either:

- `navigate('/api/auth/sso/login')` → React Router handles it **in-page**. No request leaves,
  and nothing happens.
- `window.location.assign(…)` → the page is **torn down**. React unmounts, every variable in
  memory is gone (this is why step 11 must re-fetch a token), and the browser makes a real
  request.

The whole mechanism depends on the browser visiting accounts _as a browser_, so it can
present the SSO cookie it may already hold there. An XHR cannot do that. If you ever "fix"
this by making it a fetch, SSO stops working and the reason will not be obvious.

`returnTo` is optional and carries a deep link across the round trip.

---

### Step 2 — `GET /api/auth/sso/login` — jobwork prepares the handshake

**File:** `backend/src/modules/auth/sso/sso.controller.ts` → `startLogin`

#### What this step is for

jobwork is about to send the browser somewhere it cannot follow. In a moment a browser will
come back claiming to have signed in — and steps 3–6 all happen at a **different origin**,
where jobwork has no session, no cookie and no visibility. So the entire job of step 2 is to
**write down enough to recognise its own login when it returns.** That note is the `sso_flow`
cookie, and step 7 is where it is read back.

#### First, `ssoConfig()` — discovery, done once

```ts
const config = await ssoConfig(); // memoized in a module variable
```

It fetches accounts' `/.well-known/openid-configuration` — the URLs for `/auth`, `/token`,
`/jwks` — so none of them are hardcoded here. The result is cached for the life of the
process: the first sign-in after a restart pays one extra round trip, every later one pays
nothing.

> 🔴 **`openid-client` refuses plain HTTP, and that default must survive to production.** Over
> HTTP the authorization code, the client secret and the ID token all cross the network in
> clear — and the flow **still works**, which is exactly what makes it dangerous. The escape
> hatch is narrowed twice: only when `NODE_ENV` is not production **and** the issuer hostname
> is literally `localhost`/`127.0.0.1`. A staging issuer on a real hostname cannot slip
> through by having a flag left on, and production cannot enable it at all.

#### Three random values, each stopping a different attack

| Value           | Example       | Stops                                                    |
| --------------- | ------------- | -------------------------------------------------------- |
| `state`         | `xQ8vN2mK...` | Someone feeding you _their_ login result (CSRF)          |
| `nonce`         | `pL4tR9wZ...` | Replaying an older ID token                              |
| `code_verifier` | `mB7cX3qW...` | Someone who steals the code from the URL using it (PKCE) |

All three go into **one cookie**, so the callback can check what this browser actually started:

```http
Set-Cookie: sso_flow={"state":"xQ8vN2mK...","nonce":"pL4tR9wZ...",
                      "codeVerifier":"mB7cX3qW...","returnTo":"/organizations"};
            HttpOnly; SameSite=Lax; Path=/api/auth/sso; Max-Age=600
```

Every attribute on that cookie is doing a job:

| Attribute            | Job                                                                          | If you get it wrong                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpOnly`           | JavaScript cannot read the verifier                                          | an XSS anywhere in the app can steal it                                                                                                      |
| `Secure` (prod only) | HTTPS only                                                                   | the verifier crosses the network in clear                                                                                                    |
| `SameSite=Lax`       | accounts sends the browser back with a **top-level GET**, which `Lax` allows | 🔴 **`Strict` drops it and _every_ login fails** with "sign-in expired" — and it reads as the design being broken, not as a cookie attribute |
| `Path=/api/auth/sso` | sent only to the two SSO endpoints                                           | it rides along on every API request for no reason                                                                                            |
| `Max-Age=600`        | 10 min — long enough to type a password                                      | an abandoned tab leaves a usable verifier lying around                                                                                       |

#### Where each value goes — this split _is_ PKCE

| Value           | Into the cookie | Into the URL to accounts                                         |
| --------------- | --------------- | ---------------------------------------------------------------- |
| `state`         | ✅              | ✅ the same value                                                |
| `nonce`         | ✅              | ✅ the same value                                                |
| `code_verifier` | ✅              | 🔴 **never** — only `SHA256(verifier)`, as `code_challenge`      |
| `returnTo`      | ✅              | ❌ accounts never learns where jobwork will send them afterwards |

Two of them travel in the open and come back; **the verifier never leaves the browser.**
accounts holds only the hash, so it can _check_ the verifier at step 7a but could never
produce one — and neither can anyone who reads the code out of a URL, a log or a `Referer`.

Then a redirect:

```http
302 Found
Location: http://localhost:3100/auth
            ?client_id=jobwork
            &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fsso%2Fcallback
            &response_type=code
            &scope=openid+email+profile
            &state=xQ8vN2mK...
            &nonce=pL4tR9wZ...
            &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
            &code_challenge_method=S256
```

#### What is deliberately _not_ asked for

```ts
scope: 'openid email profile',    // and NOT offline_access
```

🔴 **No `offline_access`.** Asking for it would make accounts issue jobwork a refresh token —
which jobwork would then have to store, rotate and revoke, and would have to call accounts to
use. That is the exact opposite of §3: jobwork refreshes against its **own** database and
never contacts accounts again after this exchange. One scope keyword would quietly convert a
one-time handshake into a permanent dependency.

**Writes:** nothing, in either database. The only state this step creates is the cookie — and
it lives in the browser, which is precisely why step 7 can trust it as proof that _this_
browser is the one that started _this_ login.

---

### Step 3 — accounts receives `/auth` and finds no session

**Library:** `oidc-provider`, mounted at `accounts/src/app.ts`.

accounts validates the request — is `jobwork` a registered client, is that `redirect_uri` an
**exact** match?

**Reads:** `oidc_clients` (loaded once at boot).

```sql
-- accounts DB, oidc_clients
id       | name    | redirect_uris                                        | post_logout_redirect_uris
---------+---------+------------------------------------------------------+---------------------------
jobwork  | Jobwork | {http://localhost:3000/api/auth/sso/callback}         | {http://localhost:5173/}
```

> 🔴 `redirect_uris` is matched as an **exact string**. No wildcards, no prefixes. A loose
> `redirect_uri` is the number one hole in hand-rolled identity providers: it lets an
> attacker have the authorization code delivered to a host they control.

James has no SSO cookie yet, so accounts parks the request and asks for a login.

**Writes:** `oidc_payloads`, one row.

```sql
-- accounts DB, oidc_payloads
type        | id                                          | expires_at
------------+---------------------------------------------+---------------------
Interaction | YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS | 2026-08-25 10:41:00
```

**"An Interaction row" is not a special structure** — it is one row of `oidc_payloads` (§9)
whose `type` column reads `Interaction`. The same table holds the `Session`, `Grant` and
`AuthorizationCode` rows too; `type` is what tells them apart.

> 🔴 **`type` is a label, not a status. It is set when the row is created and never changes.**
> A row does not "become" a Session — an Interaction row is _deleted_, and a Session row is a
> _different row_ that was created separately. The four kinds exist side by side, not in
> sequence: while you are reading this step, only an `Interaction` row exists; by the end of
> step 6 there is a `Session`, a `Grant` and an `AuthorizationCode` as well, and the
> Interaction is gone. §9 has the full timeline.
>
> **And `type` appears twice, in two places, with the same value.** The JSON below opens with
> `"kind": "Interaction"` — that is the _same word_ as the `type` column above it:
>
> |        | Where                      | Written by                      | Used for                                                                   |
> | ------ | -------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
> | `type` | a **column**               | our adapter (`adapter.ts`)      | half the primary key — how the row is _found_                              |
> | `kind` | a key **inside `payload`** | the library, serializing itself | a self-check — on load it throws `kind mismatch` if the two ever disagreed |
>
> Neither side reads the other's copy. The column exists because you cannot cheaply build a
> primary key out of a JSON field; the `kind` exists because the library wants its object to
> round-trip self-describing. `kind` also names the events — `snakeCase('Session') + '.saved'`
> is the **`session.saved`** that step 6(c)'s listener waits for.

Its `payload` column holds the whole pending request, so it can be resumed after login:

```jsonc
{
  "kind": "Interaction",
  "jti": "YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS",

  // the original /auth query, exactly as it arrived — snake_case, on-the-wire names
  "params": {
    "client_id": "jobwork",
    "scope": "openid email profile",
    "redirect_uri": "http://localhost:3000/api/auth/sso/callback",
    "nonce": "pL4tR9wZ…",
    "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    "code_challenge_method": "S256",
  },

  "prompt": { "name": "login", "reasons": ["no_session"] }, // ← the QUESTION
  "returnTo": "http://localhost:3100/auth/YtRfX4ht…", // ← where to resume once answered

  // ← and NO "result" key. That absence is the whole point: this row is
  //   a question with an empty answer slot. Step 5 fills it in.
}
```

Two fields do real work later. `prompt.name` is what step 4 branches on to decide whether to
render a login form or auto-approve consent (`routes.ts:55`). `returnTo` is how step 5 knows
where to send the browser — the row carries its own resume URL.

🔴 **This row is the memory of the whole login, and it is the answer to "how does step 6 know
who they are".** `/auth` cannot finish — nobody has typed a password yet — so rather than hold
the HTTP request open, `oidc-provider` **parks it in this row and replays it later**. Three
things now carry the login forward, and they do different jobs:

| Carrier                      | Says                                                           | Lives                                        |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| the `uid`                    | **which** login attempt                                        | in the URL, every hop                        |
| this row                     | **who**, once step 5 answers                                   | accounts DB                                  |
| `_interaction` cookie        | **same browser** started it, at the form (`/interaction/:uid`) | set here, alongside the redirect             |
| `_interaction_resume` cookie | the same, on the **resume** hop (`/auth/:uid`)                 | set here too — step 5's redirect lands there |

Without those cookies, anyone who learned a uid could resume someone else's half-finished login.
There are two because each is `Path`-scoped to exactly one of the two URLs the uid appears in, so
neither rides along anywhere it is not needed.

```http
302 Found
Location: /interaction/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
Set-Cookie: _interaction=…;        HttpOnly; SameSite=Lax; Path=/interaction/YtRfX4ht…
Set-Cookie: _interaction_resume=…; HttpOnly; SameSite=Lax; Path=/auth/YtRfX4ht…
```

---

### Step 4 — `GET /interaction/:uid` — the login form

**File:** `accounts/src/interaction/routes.ts`

**Reads:** `oidc_payloads` (the Interaction) and `oidc_clients` (to show a real app name).

Renders server-side HTML — no framework, no bundler, no external fonts or scripts.

> 🔴 This is the **only screen in the estate that sees a plaintext password**. Every extra
> origin it loads from is another party that could read that field. The plain HTML is not
> laziness; it is the security property. The one script it loads is the show/hide password
> toggle, same-origin, ~60 lines.

The address bar now reads `localhost:3100`. **This is the moment users notice SSO** — they
are on a different site than the one they started on.

**Writes:** nothing.

---

### Step 5 — `POST /interaction/:uid/login` — the password check

```http
POST http://localhost:3100/interaction/YtRfX4ht.../login
Content-Type: application/x-www-form-urlencoded

email=james.walker%40example.com&password=correct-horse-battery
```

**Reads:** `users`, in the **accounts** DB — the only place a password hash lives now.

```sql
-- accounts DB, users
id                                   | email                     | password_hash    | email_verified | is_active
-------------------------------------+---------------------------+------------------+----------------+----------
8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab | james.walker@example.com  | $argon2id$v=19$… | t              | t
```

Two behaviours worth knowing:

1. **A wrong email and a wrong password give the same answer, and take the same time.** If
   the user does not exist, the code still runs an argon2 verify against a dummy hash. Skip
   that and response timing tells an attacker which addresses are registered.
2. The error text is always _"That email and password do not match."_ — never "no such
   account", which would be an account-enumeration tool.

On success the interaction is completed and accounts redirects **back to its own `/auth`**:

```ts
// accounts/src/interaction/routes.ts
await provider.interactionFinished(
  req,
  res,
  { login: { accountId: user.id } },
  { mergeWithLastSubmission: false },
);
```

**That call is not just a redirect.** It does two things, and the first is the only reason
step 6 knows anything:

1. **`UPDATE` the Interaction row** — the _same_ row step 3 created, found by the uid in the
   URL. One key is added to its `payload` JSON: `result`.
2. Redirect the browser to that row's own `returnTo`, which is `/auth/:uid`.

```sql
-- accounts DB. One row, one column changed. Nothing else moves.
UPDATE oidc_payloads SET payload = <payload + result>
 WHERE type = 'Interaction' AND id = 'YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS';
```

```jsonc
{ "kind": "Interaction", "jti": "YtRfX4ht…",
  "params": { "client_id": "jobwork", … },              // unchanged since step 3
  "prompt": { "name": "login", "reasons": ["no_session"] },
  "returnTo": "http://localhost:3100/auth/YtRfX4ht…",

  "result": { "login": { "accountId": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab" } }
  // ↑ THE ANSWER. This key did not exist a moment ago. Its presence is what
  //   "the interaction is finished" means, and what step 6 reads.
}
```

`mergeWithLastSubmission: false` because this is a fresh sign-in — nothing from a previous
attempt at this interaction may survive into the session.

**Writes:** `oidc_payloads` (the Interaction row, updated in place). Still **no session
cookie** — that does not exist until step 6.

```http
303 See Other
Location: /auth/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
```

> 🔴 **Nothing rides on that URL but the uid.** Not the `accountId` — the answer stays in the
> row, and step 6 reads it from the database. Not `client_id`, `scope`, `redirect_uri`,
> `nonce` or `code_challenge` either: step 3 parked them, and step 6 replays them from the row
> (`resume.js` → `new Params(storedParams)`). This second `/auth` looks nothing like the one
> step 2 built, and resumes it exactly.
>
> The proof that this is the same browser is the `_interaction_resume` cookie — the _second_
> cookie step 3 set, scoped `Path=/auth/:uid` (`_interaction` is scoped to `/interaction/:uid`
> and never arrives here). accounts looks the row up by **the cookie's** uid and rejects the
> request if it disagrees with the path's, so a uid copied out of someone's URL bar resolves to
> nothing.

---

### Step 6 — `GET /auth/:uid` — accounts resumes the request, now knowing who they are

**In plain terms.** The browser arrives carrying nothing but a uid in the URL. accounts finds the
row it parked at step 3, reads who just logged in, gives the browser its SSO cookie, records that
jobwork is allowed to see this person, and hands out a one-time code. Then it sends the browser
back to jobwork.

**How does it know who they are? Not from a cookie — there isn't one yet.** It reads
`result.login.accountId`, the key step 5 wrote into the parked row. The identity comes out of the
database, not off the wire.

All three steps are the **same row** of `oidc_payloads`, `type='Interaction'`, found by the
uid in the URL:

```
step 3  INSERT           step 5  UPDATE                        step 6  SELECT
   no "result" key   ─────►  "result": { login: { accountId } }  ─────►  read accountId
                                                                              ↓
                                                                    now create the session
```

Note the direction: `_session` is an **output** of this step, not an input to it. accounts
creates it _because_ it has just learned who this is. (Every later sign-in reverses this — the
cookie arrives at step 3, there is no Interaction, no form, and steps 4–5 never happen. That
is the "single" in single sign-on: **§6.1 _Signing in again_** — section 6, not step 6.)

#### The first login goes round twice

`/auth/:uid` asks two questions **in order, and stops at the first one it cannot answer** — because
the only way to get an answer is to send the browser somewhere. One redirect out = one question
answered, so two unanswered questions means the route runs twice:

```
step 3    /auth               ← no uid. no session → park row #1
step 4-5  /interaction/uid1     the password form
─────────────────────────────────────────────────────────────────────────────
step 6 ①  /auth/uid1   Q1 who is this?          ✔  (accountId, from the parked row)
                       Q2 may jobwork see them? ✘  no Grant → park row #2, redirect
          /interaction/uid2    auto-approve → save a Grant row → redirect back
step 6 ②  /auth/uid2   Q1 who is this?          ✔
                       Q2 may jobwork see them? ✔  → issue the code
```

Pass ① did not _fail_. Each pass answers one more question than the one before it.

**Why Q2 is ✘ the first time.** A Grant is a per **(user + app)** row that lives 14 days
(`provider.ts:158`) — "James has allowed jobwork to see his profile." On a first-ever login that
pair has never existed, so there is nothing to find. Once written, every later sign-in answers Q2 on
pass ① and finishes in **one** pass. That is why (b) below says "first time only".

Every uid above is a **different** parked row, and step 3's `/auth` has no uid at all — it is the one
request that starts everything and never runs again in this login. So `/auth` and `/auth/:uid` are
never the same request, and neither are the two `/auth/:uid` passes: each consumes its own row and is
deleted with it.

#### The four things it writes

🔴 **(a), (b) and (d) are three rows of ONE table.** `oidc_payloads` is generic storage for
everything the library persists; the `type` column is the only thing telling a Session from a Grant
from an AuthorizationCode — and from the Interaction rows of steps 3 and 5. Three SQL blocks below,
one table. **Only (c) writes tables of our own**, and only (c) is written by our code.

_(The same word also sits inside the JSON as `payload.kind`. The column is how a row is **found**;
the `kind` is the library's own self-check — see the note under step 3's timeline. Query on `type`.)_

|        | Row written                                      | Table                            | Which request writes it                                       | Written by                        |
| ------ | ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| **a)** | `type='Session'` + `_session` cookie             | `oidc_payloads`                  | `/auth/:uid` — **both** passes                                | the library, via `adapter.ts:39`  |
| **b)** | `type='Grant'`                                   | `oidc_payloads`                  | the `/interaction/:uid` consent hop — **not** this route      | `interaction/routes.ts:163`       |
| **c)** | one `sso_sessions` row, one `session_grants` row | `sso_sessions`, `session_grants` | **no route** — a listener, inside whichever request wrote (a) | `sessionMirror.ts:66,81`          |
| **d)** | `type='AuthorizationCode'`                       | `oidc_payloads`                  | `/auth/:uid` — the **last** pass only                         | the library, via the same adapter |

> `/auth` and `/auth/:uid` are **not our routes** — `app.ts:154` mounts `provider.callback()` at
> `/`, so the library owns them, along with `/token` and `/jwks`. The only routes written here are
> `/interaction/:uid` and `/interaction/:uid/login` (`app.ts:140`). That is why (b) happens on a
> different URL from the step it belongs to.

**a) The SSO session** — the cookie that makes it _single_ sign-on. Next time any app sends
them here, this cookie means no password screen at all.

```sql
-- accounts DB, oidc_payloads
type    | id                                          | uid                                         | expires_at
--------+---------------------------------------------+---------------------------------------------+---------------------
Session | Hn4KpQ2rTvXz7B9cLmS3dF6gJ8kW1yA5eR0uZoI-tNb | aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD | 2026-09-08 10:31:00
```

```http
Set-Cookie: _session=Hn4KpQ2r…; HttpOnly; SameSite=Lax; Path=/
```

> 🔴 **One session, two ids — do not mix them up.** The `id` (the **jti**) is what the cookie
> carries, and it **changes**: any per-app logout rotates it. The `uid` never changes for the life
> of the browser session. So everything we keep ourselves — (c) below — is keyed on the **uid**.
> Key it on the jti instead and each per-app logout starts a _second_ row, splitting one person's
> login history into several.

**b) The consent step.** First time only. Every client here is first-party — apps we build
and operate — so consent is **auto-approved** rather than shown as a screen. A consent screen
exists to protect a user from an app the operator does not vouch for, and there is no such
app in this registry. _If a third-party client is ever registered, this must become a real
screen._

```sql
type  | id                                          | expires_at
------+---------------------------------------------+---------------------
Grant | RO-ngC5Vr-s1M2yzPrzzMzecjD5_0UY1ispAQzD8_GT | 2026-09-08 10:31:00
```

**c) The durable session record.** Nobody calls this. Saving the session fires an event, and a
listener (`oidc/sessionMirror.ts`) copies it into our own tables — because `oidc_payloads` rows are
**deleted** at logout, and the login history would go with them. If the copy fails the sign-in
still succeeds; it is a report, not part of logging in.

```sql
-- accounts DB, sso_sessions
id                                          | user_id                              | revoked_at | user_agent
--------------------------------------------+--------------------------------------+------------+------------
aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD | 8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab | NULL       | Chrome/…

-- accounts DB, session_grants
session_id                                  | client_id | sid
--------------------------------------------+-----------+---------------------------------------------
aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD | jobwork   | btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM
```

Note the id: `sso_sessions.id` and `session_grants.session_id` both hold the session's **uid**,
not the jti the cookie carries.

> 🔴 **`sid` is not short for `session_id`.** They sit in the same row, look alike, and mean
> different things:
>
> | Column       | Holds                                  | Scope                                                        |
> | ------------ | -------------------------------------- | ------------------------------------------------------------ |
> | `session_id` | the session **uid**                    | the browser — one value, shared by every app                 |
> | `sid`        | `session.authorizations[clientId].sid` | **one app** — this is the `sid` claim in that app's ID token |
>
> **One session, many `sid`s.** If James later signs into a second app from the same browser,
> that is a _second_ `session_grants` row with a _different_ `sid`, under the same `session_id`.
> This is deliberate in OIDC: a shared `sid` would let two apps work out they are looking at the
> same person. It is also why jobwork's own column is named `idp_session_id` and stores the
> **sid** — jobwork never learns the `session_id` at all.
>
> Both `uid` and `sid` are **43-character nanoids, not UUIDs**. Postgres rejects them as
> `uuid` outright — we shipped that bug and had to migrate the column.

**d) The authorization code** — a one-time ticket, valid for 60 seconds.

```sql
type              | id                                          | expires_at
------------------+---------------------------------------------+---------------------
AuthorizationCode | TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi | 2026-08-25 10:32:00
```

Back to jobwork:

```http
302 Found
Location: http://localhost:3000/api/auth/sso/callback
            ?code=TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi
            &state=xQ8vN2mK...
            &iss=http%3A%2F%2Flocalhost%3A3100
```

> ⚠️ **The redirect chain leaves the accounts origin here**, and that has a consequence most
> people meet the hard way — see §10, "the `form-action` trap".

#### Under the hood — skip unless you are changing this code

**`/auth` and `/auth/:uid` are two separate routes**, registered by the same factory with a
different endpoint name (`initialize_app.js`). The resume route runs a _shorter_ stack: it has no
param-parsing middleware at all — `getResume` fills the params in from the parked row instead — so
the request checks from step 3 (`checkRedirectUri`, `checkPKCE`, `checkScope`, …) do not re-run.
They already passed. What _does_ re-run is `checkClient`: the client is the one thing that could
have changed while the user was typing a password.

That is also why step 5's redirect carries no params. Anything appended to `/auth/:uid` is not
rejected — it is simply never read.

**The order things actually happen**, per pass:

|                    |                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| on the way **in**  | find the parked row → **delete** it → restore the params → note who logged in _(in memory)_ → look for a Grant                                  |
| the decision       | Grant missing → park a new row, redirect to consent · Grant found → **write the AuthorizationCode**, redirect to jobwork                        |
| on the way **out** | stage the `_session` cookie → **write the Session row** → the listener writes `sso_sessions`, and `session_grants` **only once a `sid` exists** |

🔴 **Nothing here writes an `INSERT` or an `UPDATE`.** Every write above is a Prisma **`upsert`** —
`oidcPayload.upsert` in `adapter.ts`, `ssoSession.upsert` and `sessionGrant.upsert` in
`sessionMirror.ts`. Which branch takes effect depends only on whether the key already exists, so
reading the code for a verb tells you nothing about what the row does:

| Row              | Pass ①                                                                      | Pass ②                                                                                                   |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Session`        | `create` — new jti                                                          | **`DELETE` the old jti, then `create` again.** Not an update: the id changed, so it is a different key   |
| `sso_sessions`   | `create`                                                                    | `update` — and only `expires_at` + `last_used_at`. `created_at` is left alone: it is the real login time |
| `session_grants` | **no query at all** — the loop over `authorizations` has nothing to iterate | `create`                                                                                                 |

That middle row is the only genuine `update` in the whole step.

Three consequences of that ordering:

- **The `sid` is minted when the Grant is found, not when the password is checked.** So pass ①
  leaves an `sso_sessions` row with no `session_grants` row beside it; pass ② adds it. A `sid`
  marks _an app being granted access_, which is exactly why there is one per app.
- **The session's jti rotates on pass ②** (it is no longer a new session), so the Session row is
  deleted and rewritten under a new id — while `sso_sessions` keeps one row, because it keys on the
  uid. The warning in (a) is visible in the very first login anyone performs.
- **The cookie is staged before the row is written, but sent after.** The response is not flushed
  until the middleware chain finishes, and it cannot finish until the `save()` completes. So a crash
  leaves an orphan row nobody holds a cookie for — harmless, it expires — never a cookie pointing at
  a row that does not exist.

---

### Step 7 — `GET /api/auth/sso/callback` — jobwork redeems the code

**In plain terms.** The browser is back at jobwork, carrying a code. jobwork opens the note it
left itself at step 2 — the `sso_flow` cookie — and checks this really is the login it started.
Then it calls accounts **directly**, with no browser involved, and swaps the code for a signed
statement of who this person is.

**File:** `sso.controller.ts` → `callback`. This is the **only** place in jobwork that ever
reads a token from an identity provider.

**Read this step as the mirror of step 2.** Everything step 2 wrote down, step 7 checks. A
browser has just turned up claiming to have signed in — the entire job here is deciding
whether to believe it.

> **Why `:3000` here when step 1 left through `:5173`?** Step 1 was the browser hitting Vite,
> which proxies `/api` to Express. This callback skips Vite: `:3000` is the exact `redirect_uri`
> registered at accounts (step 3), and accounts only ever redirects to that exact string. Same
> app, different door — and in production the question disappears, because web and API are one
> origin (§2).

#### a) The `sso_flow` cookie is jobwork's Interaction row

accounts parked its memory of this login in a **database row** keyed by the uid (step 3).
jobwork parked _its_ memory in an **HttpOnly cookie** at step 2. Different storage, identical
purpose: _is this the login I started?_ Neither service can answer that from the request
alone, because a request is only what the client chose to send.

```ts
const raw = req.cookies?.[FLOW_COOKIE];
res.clearCookie(FLOW_COOKIE, …);          // BEFORE the existence check — line order matters
if (!raw) throw ApiError.badRequest('Sign-in expired. Please try again.');
```

The clear is **unconditional and comes first**, so even a failed attempt destroys the
verifier. It is single-use; a leftover one is a second chance for whoever caused the failure.
No cookie → _"Sign-in expired."_

#### b) Three values were minted at step 2. Each is now matched against a different thing

This table is the security of the whole flow in one place:

| Minted at step 2 | Where it travelled                                              | Matched at step 7 against                                     | Catches                                           |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `state`          | out in the URL, back in the URL                                 | `?state=` on this callback                                    | someone feeding you **their** login result (CSRF) |
| `nonce`          | out in the URL; accounts **bakes it into the ID token**         | the `nonce` claim _inside_ the token                          | a replayed older ID token                         |
| `code_verifier`  | 🔴 **never left the cookie** — only `SHA256(verifier)` was sent | accounts compares our verifier to the stored `code_challenge` | someone who stole the code out of the URL (PKCE)  |

The third row is the asymmetry worth understanding: accounts has only the _hash_. A thief who
reads the code out of a URL, a log or a referrer header still cannot redeem it, because
producing the verifier requires the cookie — which is `HttpOnly` and on a different origin.

#### c) The URL is rebuilt from config, not from the request

```ts
const currentUrl = new URL(env.sso.redirectUri!);              // ← the CONFIGURED value
for (const [key, value] of Object.entries(req.query)) …        // ← only the query is copied
```

The library needs the full callback URL to validate. Taking the host from `req` would let a
forged `Host` or a misconfigured proxy influence validation; taking it from `SSO_REDIRECT_URI`
means it is the same exact string accounts matched at step 3.

#### d) Then a server-to-server call

Not a redirect — the browser is not involved and never sees the client secret. **jobwork does not
write this request by hand**; it is what the one library call in (e) sends. It is shown here
because you will see it in the logs:

```http
POST http://localhost:3100/token
Authorization: Basic am9id29yazpzM2NyM3Q…          ← client_id : client_secret
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi
&redirect_uri=http://localhost:3000/api/auth/sso/callback
&code_verifier=mB7cX3qW...                          ← proves same browser (PKCE)
```

accounts checks `SHA256(code_verifier) == code_challenge`, **deletes the code row** so it can
never be used twice, and answers:

```jsonc
{
  "access_token": "eyJhbGciOiJFZERTQSIsImtpZCI6…",
  "id_token": "eyJhbGciOiJFZERTQSIsImtpZCI6…",
  "token_type": "Bearer",
  "expires_in": 3600,
}
```

The **ID token** is the signed note. Decoded, its payload is:

```jsonc
{
  "sub": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab",
  "email": "james.walker@example.com",
  "email_verified": true,
  "name": "James Walker",
  "picture": null,
  "sid": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM",
  "iss": "http://localhost:3100",
  "aud": "jobwork",
  "nonce": "pL4tR9wZ...",
  "exp": 1787654700,
  "iat": 1787654400,
}
```

> 🔴 **Identity only. No organizations, no roles, no permissions — ever.** A token is a
> _snapshot_. If it carried memberships, removing someone from an organization would leave
> their token still saying they belong until it expired. jobwork resolves those on **every
> request** instead (`tenantContext`, `requirePermission`), which is what makes removal
> instant on every device.

#### e) One call does the exchange _and_ every check

**One line does all of it.** The `POST /token` above, the `GET /jwks` below, and every check in
this step are that single call — which is why it is easy to under-configure:

```ts
const tokens = await client.authorizationCodeGrant(config, currentUrl, {
  pkceCodeVerifier: flow.codeVerifier, // → PKCE
  expectedState: flow.state, // → CSRF
  expectedNonce: flow.nonce, // → replay
  idTokenExpected: true,
});
```

```http
GET http://localhost:3100/jwks       → reads accounts DB, signing_keys (public half only)
```

🔴 **Every expectation is checked _because it is passed in_.** `iss`, `aud`, `exp` and the
signature come from `config`; `state`, `nonce` and the verifier come from the cookie. Omit any
one of those three options and the library **silently skips that check** — no error, no
warning, a sign-in that still works and a defence that is simply gone. This is the one line in
the file where deleting an argument weakens security invisibly.

#### f) The claims are copied out deliberately, not trusted wholesale

```ts
emailVerified: idClaims['email_verified'] === true,   // absent ⇒ NOT verified
```

Strict equality, and the default is the safe one. Step 8's email-matching branch turns on this
being `true`, so defaulting the other way would let an **unverified** address claim an existing
jobwork account — the difference between rows 3 and 4 of §8.

**Reads (accounts DB):** `oidc_payloads`, `signing_keys`.
**Writes (accounts DB):** deletes the AuthorizationCode row — it is single-use, so a replay of
this exact callback URL now fails at accounts rather than anywhere in jobwork.

**Writes (jobwork DB):** nothing yet. That is step 9.

---

### Step 8 — Which local user is this? (`linkOrCreateLocalUser`)

**File:** `sso.service.ts`.

#### What this step is actually for

Steps 3–7 proved _who this is_ — and the answer is a **`sub`**, a value that means nothing in
the jobwork database. Every `membership`, `created_by` and `updated_by` in this app points at
a jobwork `users.id`, which is a **different value** (§4). So step 8 is a **translation**:

```
8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab   →   3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5
        the sub, from accounts                  jobwork users.id, what FKs point at
```

**This is also the first moment the sign-in touches the jobwork database at all.** Everything
before it happened at accounts, or in a cookie.

#### One column holds the whole mapping

`users.identity_user_id` — nullable, **unique**. The three branches below are not three
unrelated cases; they are the three possible states of that one column:

| State of `identity_user_id`                     | Branch | What happens                   | Writes?          |
| ----------------------------------------------- | ------ | ------------------------------ | ---------------- |
| a row already holds this `sub`                  | **1**  | use that row                   | no               |
| no row holds it, but a row holds this **email** | **2**  | **create the mapping**, once   | `UPDATE`         |
| no row either way                               | **3**  | may we create a person at all? | `INSERT`, or 403 |

Tried in order, first match wins.

#### Branch 1 — already linked

The normal case, every sign-in after the first.

```sql
SELECT * FROM users WHERE identity_user_id = '8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab';
```

Found → `isUsableAccount(row)` → done, no write. That check is the shared `ACTIVE_USER`
predicate, never the two flags spelled out inline.

```ts
if (!isUsableAccount(linked)) throw new ApiError(403, 'This account has been disabled.');
```

An account can be disabled **in jobwork** while the identity is perfectly fine — one app
revoking access must not require touching the central account. Note the direction: accounts
happily issued a valid ID token, and jobwork refused it anyway. Authentication succeeded;
authorisation did not.

#### Branch 2 — match by email, exactly once

The migration path for people who had a jobwork login before SSO existed. **The branch is
gated before it runs:**

```ts
if (claims.emailVerified && claims.email) {          // ← the gate, not a formality
  const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
```

```sql
SELECT * FROM users WHERE email = 'james.walker@example.com';
-- found, and usable → stamp the mapping, once and forever:
UPDATE users SET identity_user_id = '8f2b1c04-…' WHERE id = '3c9d5e21-…';
```

A disabled row is refused here too, before any stamping — the same `isUsableAccount` check as
branch 1.

```sql
-- jobwork DB, users — before and after
id           | email                    | identity_user_id | password_hash
-------------+--------------------------+------------------+---------------
3c9d5e21-…   | james.walker@example.com | NULL             | $argon2id$…      ← before
3c9d5e21-…   | james.walker@example.com | 8f2b1c04-…       | $argon2id$…      ← after
```

> 🔴 **`email_verified` is load-bearing here, not a formality.** Without it, anyone who
> registers at accounts using someone else's unverified address takes over that person's
> jobwork account. After this one link, jobwork **never looks a user up by email again** —
> people change addresses, `sub` is forever. This whole branch gets deleted once every
> active user is linked.

#### Branch 3 — no local user at all: invitation, or refusal (`provisionOrRefuse`)

Before SSO, _having a jobwork account_ meant _being a jobwork user_. Now everyone in the
company can reach jobwork's login and get a perfectly valid token — so jobwork must decide
for itself. **jobwork's policy is invite-only.**

`email_verified` is checked **again** here, independently of branch 2's gate:

```ts
if (!claims.emailVerified || !claims.email) return refuse();
```

Two separate checks of the same claim, in two functions, on purpose: branch 2 protects
_existing_ accounts from takeover, branch 3 protects the _invitation_ lookup from being
answered for an address the caller has not proven they own.

```sql
SELECT id FROM invitations
 WHERE email = 'james.walker@example.com'
   AND status = 'pending' AND accepted_at IS NULL AND declined_at IS NULL
   AND is_deleted = false AND expires_at > now()
   -- an invitation into a deleted organization is not an invitation
   AND organization_id IN (SELECT id FROM organizations WHERE is_deleted = false);
```

Every clause is doing work: an invitation that was accepted, declined, withdrawn, expired, or
issued by an org that has since been deleted is **not** an entitlement.

No pending invitation → **403**, and no account is created:

```jsonc
{
  "statusCode": 403,
  "message": "You don't have access to this app. Ask your administrator to invite you.",
  "data": null,
}
```

> 🔴 **Both refusals return that identical message** — unverified email and no-invitation are
> indistinguishable from outside. `refuse()` is one function called from two places precisely
> so they cannot drift apart. Two different messages would turn this endpoint into a way to
> ask _"does this address have a pending invitation at this company?"_ and get a straight
> answer, without any credential at all.

With an invitation → a **password-less** user row is created:

```sql
INSERT INTO users (email, identity_user_id, first_name, last_name, full_name, password_hash)
VALUES ('james.walker@example.com', '8f2b1c04-…', 'James', 'Walker', 'James Walker', NULL);
```

The name is split out of the ID token's `name` claim — first word to `first_name`, the rest to
`last_name`. `password_hash` stays **NULL** deliberately: this account exists only through the
identity provider, and giving it a local password would quietly reopen the very login the
cutover closes (§6.2).

> Note what this deliberately does **not** do: it does not accept the invitation or create a
> membership. Joining an organization stays in `invitations.service.ts`, which owns the role
> and permission template. Duplicating that here would be a second implementation of the one
> thing that grants access.

**Reads (jobwork DB):** `users`, and `invitations` + `organizations` on branch 3 only.
**Writes (jobwork DB):** branch 1 nothing · branch 2 one `UPDATE` · branch 3 one `INSERT`.
**Returns:** the jobwork `users` row — from here on, the `sub` is not used again except to be
recorded on the session at step 9.

> **Three ways to be refused, all 403, all at this step.** Worth seeing together, because they
> fail for completely different reasons:
>
> |                           | Refused because                                                                                          | Fix                       |
> | ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
> | branch 1 or 2             | the local account is disabled                                                                            | re-enable in jobwork      |
> | fell past 2, refused by 3 | email not verified at accounts — so branch 2's gate never opened, and branch 3 refused on the same claim | verify the address        |
> | branch 3                  | no pending invitation                                                                                    | have an admin invite them |
>
> And a fourth outcome that is **not** a refusal: signing in works, but there is no membership,
> so step 10 lands them on `/no-access`. Authenticated, entitled to the app, in no organization.

---

### Step 9 — From here it is an ordinary jobwork login

**In plain terms.** jobwork now knows who this is, so it gives them a normal jobwork session —
the same one a password login would have got. It writes one row and hands back two tokens.
accounts is finished and is never contacted again.

```ts
issueTokens(user, { userAgent, idpSessionId: claims.sid, idpSubject: claims.sub });
```

#### This is where layer 2 ends and layer 1 begins

§3's two layers meet on this line. Everything before it was OIDC, used **once**. Everything
after it is jobwork's own session, used **every 15 minutes, forever** — and accounts is never
contacted again.

`issueTokens` is the **one place** in the codebase a `refresh_tokens` row is created. A
password login calls the same function with the same arguments minus two. That is the whole
reason refresh, logout, the session report and `authenticate` needed no changes for SSO: they
were never given a different shape to handle.

#### The order matters — row first, then token

```ts
const session = await prisma.refreshToken.create({ … });   // 1. the row
const accessToken = signAccessToken(user.id, session.id);  // 2. sid = the row's id
```

It cannot be the other way round: **the access token's `sid` claim _is_ this row's primary
key**, so the row must exist before the token can be signed. That is what lets logout find and
end this exact session by primary key.

🔴 And it is why `refresh_tokens` has two id-ish columns that both get called "sid":

```
id             = 9a1b2c3d-…            ← the sid in OUR access token
idp_session_id = btpdNjTMMI97F3YH…     ← the sid accounts issued (from the ID token)
```

Unrelated values. Confusing them in the revoke path fails **open** — the column list is in
§9 _Cheat sheets_, "The jobwork tables, column by column". (That is section 9, not this step.)

#### Two tokens leave this step, and they are not alike

|                    | refresh token                      | access token                         |
| ------------------ | ---------------------------------- | ------------------------------------ |
| Where it lives     | `HttpOnly` cookie                  | the SPA's **memory only**            |
| Lifetime           | 7 days (`JWT_REFRESH_TTL`)         | 15 minutes                           |
| Has a database row | **yes — the row _is_ the session** | **no**                               |
| Can be revoked     | yes: stamp `revoked_at`            | 🔴 **no.** It works until it expires |
| Carries            | the user id                        | the user id **+ `sid`** = the row id |

That third row is the entire revocation model. You can destroy a session by stamping a column;
you cannot recall an access token that has already been issued. Hence the 15-minute window
`authenticate` deliberately accepts (§6.5).

Because the token is **not rotated**, `expires_at` is fixed here and never moves: a session
ends exactly seven days after _login_, however active the user is.

```sql
-- jobwork DB, refresh_tokens
id             | user_id     | expires_at | revoked_at | idp_session_id      | idp_subject
---------------+-------------+------------+------------+---------------------+-------------
9a1b2c3d-…     | 3c9d5e21-…  | 2026-09-01 | NULL       | btpdNjTMMI97F3YH…   | 8f2b1c04-…
```

```http
Set-Cookie: refreshToken=eyJhbGciOiJIUzI1NiIs…; HttpOnly; SameSite=Lax; Path=/
```

#### The only two columns that remember SSO happened

`idp_session_id` = **this browser**. `idp_subject` = **this person, everywhere**. Both indexed,
because back-channel logout (§6.4) arrives naming one or the other and must find every affected
session without scanning. Strip those two columns and this row is indistinguishable from a
password login's.

#### What is deliberately not written

- **No membership, no organization** — step 9 grants nothing. Entitlement is `invitations`.
- **Nothing in the accounts DB.** accounts finished at step 6 and never learns whether jobwork
  went on to create a session.

> That last point has a visible consequence: if step 8 had thrown 403, the `session_grants` row
> written at step 6 would still say this browser signed into jobwork. A later back-channel
> logout then fires at jobwork for a session that never existed — the `UPDATE` matches zero
> rows and nothing breaks, but the two databases genuinely disagree about what happened, and
> the accounts side is the optimistic one.

---

### Step 10 — Where to land

**In plain terms.** The person is signed in. The last thing jobwork does before letting go of the
browser is pick which page to send them to — and that depends on how many organizations they
belong to. If they belong to none, they get a "no access" page instead.

**File:** `sso.service.ts` → `landingPathFor`.

#### The last decision made while jobwork still holds the browser

Steps 7–9 answered _who_ and _may they_. This step answers _where_, and it is the **only place
tenancy appears anywhere in the login path**. After the 302 leaves, jobwork does not control
the browser again — the SPA does.

Its two inputs come from opposite ends of the flow:

```ts
landingPathFor(user.id, flow.returnTo);
//             ↑ from step 8      ↑ from the cookie written at step 2
```

**Reads (jobwork DB):** `memberships`, filtered `isDeleted: false` **and**
`organization.isDeleted: false` — membership of a deleted org is not membership.

#### The ladder, in the order the code actually tests it

```ts
if (memberships.length === 0) return '/no-access';                       // 1
if (returnTo)                 return returnTo;                           // 2
if (memberships.length === 1) return `/organizations/${…}`;              // 3
return '/organizations';                                                 // 4
```

| #   | Situation                | Lands on                      |
| --- | ------------------------ | ----------------------------- |
| 1   | **No membership at all** | `/no-access`                  |
| 2   | `returnTo` was given     | that path                     |
| 3   | Exactly one organization | `/organizations/b41f7a90-…`   |
| 4   | Several organizations    | `/organizations` (the picker) |

The order is the point: **`/no-access` is tested first**, so a deep link cannot talk its way
past having no membership. Reverse rules 1 and 2 and a `returnTo` would drop an unentitled
user straight into an org page, where every request then 403s and the app looks broken rather
than closed.

#### Why this step looks like it trusts `returnTo` — it was checked at step 2

```ts
returnTo: safeReturnTo(req.query['returnTo']),   // ← sso.controller.ts:63, at STEP 2
```

🔴 `returnTo` starts life as a query parameter, which is to say **whatever the link said**. An
absolute URL there is an open redirect: sign-in succeeds and then hands the browser to
whatever host the attacker named — the classic way a phishing page borrows a real login.
`safeReturnTo` requires a leading `/` and rejects `//evil.test`, since protocol-relative
counts as absolute. It runs **on the way in**, so what step 10 reads out of the cookie was
already validated once and cannot have been touched since (`HttpOnly`).

> 🔴 An organization is **never** auto-created here. A user with no membership has proven who
> they are but is not entitled to anything yet. Inventing a tenant to give them somewhere to
> land would hand every new identity its own empty company.

The path is made absolute against `env.appUrl` — the configured front-end origin, not
anything from the request:

```http
302 Found
Location: http://localhost:5173/organizations/b41f7a90-2c3d-4e58-8a71-9f0b6d2e4c13
```

---

### Step 11 — The SPA picks up a session it did not start

#### The React app starts from zero and does not know any of this happened

Step 1 tore the page down. What loads now is a **fresh** React app: no state, no access token,
no memory of a sign-in. It cannot be told what happened either — the 302 carried no payload.

**The cookie is the only evidence**, and the SPA never reads it (it is `HttpOnly`). It simply
does what it does on _every_ load:

```ts
// providers/AuthProvider.tsx — a useEffect on mount, nothing SSO-specific
useEffect(() => { restoreSession() … }, []);
```

```http
POST /api/auth/refresh-token      (the refreshToken cookie rides along automatically)
```

```jsonc
{
  "statusCode": 200,
  "message": "Success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "user": { "id": "3c9d5e21-…", "email": "james.walker@example.com", "fullName": "James Walker" },
  },
}
```

🔴 **This is the same call a plain F5 makes**, and that is the design. A password login lands
here identically. It is why the entire front end contains no SSO logic beyond one button and
one config check — the session-restore path already existed, and SSO was made to end where
that path begins. James is in. **Total elapsed: about a second.**

#### Two functions call this endpoint, and mixing them up is a real bug

|                  | `restoreSession()`                              | `refreshAccessToken()`                                                          |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Where            | `features/auth/auth.api.ts`                     | `api/client.ts`                                                                 |
| When             | **on app load** — this step                     | on a 401 **mid-session**                                                        |
| Client           | `apiClient` — interceptors on                   | 🔴 **raw `axios`** — must skip interceptors, or a 401 here recurses into itself |
| Reads            | `data.accessToken` (envelope already unwrapped) | 🔴 `res.data.data` — **it must unwrap the envelope itself**                     |
| Returns the user | yes                                             | no, just the token                                                              |
| On failure       | `null` — a logged-out visitor is a normal state | hard navigate to `/login`                                                       |

> 🔴 **The envelope trap.** Because `refreshAccessToken` bypasses the interceptor, nothing
> unwraps `{ statusCode, message, data }` for it. Read `res.data` instead of `res.data.data`
> and the access token comes back `undefined` — **silently**. Every background refresh then
> fails and users appear to be logged out at random, with no error anywhere.

Both take the same `navigator.locks` lock, `'auth_refresh'` — but the lock is **not** what
collapses a burst of 401s. There are two guards doing two different jobs:

|                   | What it stops                                                                 | Lives in                               |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| `refreshInFlight` | two refreshes **in one tab** — concurrent callers get the _same_ promise back | `client.ts`, `refreshAccessToken` only |
| `navigator.locks` | two refreshes **across tabs**, and the two functions racing each other        | both                                   |

🔴 **A lock queues, it does not deduplicate.** Five concurrent 401s would each take the lock in
turn and run five refreshes, one after another. `refreshInFlight` is the thing that makes them
one. Remove it because "the lock already covers that" and the burst comes straight back — slower
now, because they are serialized. `restoreSession` needs no equivalent: it is called once, on
mount.

#### Why the access token was not simply handed over in the redirect

> 🔴 **The access token is never put in the URL** — not in the query string, and not in the
> fragment either. A fragment is better (it never reaches the server, so it stays out of
> access logs and the `Referer` header) but it is still a bearer token sitting in the address
> bar: it lands in browser history, in anything the user copies, and in every extension that
> can read a URL.
>
> It is also unnecessary. The cookie was set at step 9 and this exchange was going to happen
> on load anyway — so the URL-passing version costs a real security property and saves
> nothing, while adding a second way to start a session that would have to be maintained
> forever.

---

## 5. The whole trip on one page

```
BROWSER                    web :5173        jobwork API :3000       accounts :3100
   │
   │ open /login
   ├──────────────────────────►│
   │                           │ GET /api/auth/config ──────►│
   │◄── { ssoEnabled: true } ──┤◄───────────────────────────┤
   │
   │ click "Sign in"
   ├─── GET /api/auth/sso/login ────────────────────────────►│
   │                                              Set-Cookie: sso_flow
   │◄─── 302 to :3100/auth?client_id=jobwork&… ──────────────┤
   │
   ├─── GET /auth ──────────────────────────────────────────────────────────►│
   │                                                    writes oidc_payloads(Interaction)
   │◄─── 302 /interaction/YtRfX4ht… ─────────────────────────────────────────┤
   ├─── GET /interaction/YtRfX4ht… ─────────────────────────────────────────►│
   │◄─── 200  the login form  (address bar now :3100) ───────────────────────┤
   │
   ├─── POST /interaction/YtRfX4ht…/login  email+password ──────────────────►│
   │                                                    reads users, argon2 verify
   │◄─── 303 /auth/YtRfX4ht… ────────────────────────────────────────────────┤
   ├─── GET /auth/YtRfX4ht… ────────────────────────────────────────────────►│
   │                                          writes Session, Grant, AuthorizationCode
   │                                          writes sso_sessions, session_grants
   │                                                    Set-Cookie: _session
   │◄─── 302 :3000/api/auth/sso/callback?code=TX7vFJ… ───────────────────────┤
   │
   ├─── GET /api/auth/sso/callback ─────────────────────────►│
   │                                                         │ POST /token  ─────►│  ← server
   │                                                         │◄── id_token ───────┤    to server
   │                                                         │ GET /jwks    ─────►│
   │                                             reads users / invitations
   │                                             writes refresh_tokens
   │                                             Set-Cookie: refreshToken
   │◄─── 302 :5173/organizations/b41f7a90-… ─────────────────┤
   │
   ├──────────────────────────►│ POST /api/auth/refresh-token ►│
   │◄── accessToken + user ────┤◄────────────────────────────┤
   │
   ▼  signed in
```

---

## 6. The other flows

### 6.1 Signing in again — what makes it _single_

§4 traced a **first** sign-in, and it is the long one. Every sign-in after it — coming back
tomorrow, or opening a second app — is shorter, and that shortcut _is_ SSO. Nothing else in
the design earns the name.

Steps 0, 1, 2 are byte-for-byte identical: the SPA asks for config, James clicks, jobwork
mints a fresh `state` / `nonce` / `code_verifier` and redirects to accounts. The difference
lands at step 3, where the browser now presents the `_session` cookie it got last time:

```
first sign-in   3 ─► 4 ─► 5 ─► 6     no cookie → interaction → form → password → session
returning       3 ──────────► 6     cookie → straight to the code
```

- **No Interaction row is written** — there is nothing to ask, so nothing to park.
- **Steps 4 and 5 never happen.** No login form is rendered. No password is checked. The
  accounts `users` table is not read at all.
- accounts loads the `Session` payload, takes `accountId` straight from it, and goes directly
  to minting the authorization code.

To James the browser flickers through `:3100` and comes back signed in, usually under a
second, with no screen. That is the whole user-visible feature.

**What still happens on every single sign-in — this is not a cached login:**

| Every time                                                            | Why                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `oidc_clients` checked — client id **and** exact `redirect_uri`       | An existing session must never let a stale or hostile client ride along                   |
| A **new** `AuthorizationCode` row                                     | Single-use, 60 seconds. Codes are never reused.                                           |
| A **new** `session_grants` row — _if this app is new to this session_ | Each app gets its own `sid` (§9). This is the row that later tells logout whom to notify. |
| jobwork steps 7–11, unchanged                                         | Fresh `state`/`nonce`/PKCE, fresh `refresh_tokens` row, fresh local session               |

> 🔴 **What is _not_ rechecked: the account.** `is_active` and `is_deleted` are read at
> **step 5** — and step 5 does not run. A disabled account keeps completing silent sign-ins
> for as long as its SSO session lives. This is precisely why disabling a user must revoke
> every SSO session **in the same transaction** (§9, `users`) and fire back-channel logout
> (§6.4). Writing the flag alone is not deactivation; it just feels like it.

**The second-app case** adds exactly one row and nothing else:

```
browser already holds _session at :3100
  → reports app redirects to /auth?client_id=reports
  → accounts: SAME sso_sessions row, NEW session_grants row (client_id='reports', its own sid)
  → code → reports' own callback
```

One `sso_sessions` row, **N `session_grants` rows — one per app**. That shape is what turns
"log out everywhere" into a fan-out over the grants (§6.4) instead of a guess about which
apps a person ever opened.

> **Not to be confused with §6.5.** This section is **layer 2**: re-entering through accounts,
> which mints a new local session. §6.5 is **layer 1**: jobwork renewing a session it already
> has, every 15 minutes, without accounts being involved at all (§3).

### 6.2 Creating an account

There is **no signup form in jobwork** once SSO is on. "Create an account" is a redirect:

```
click  →  GET :3000/api/auth/sso/signup  →  302  →  :3100/signup
```

#### Why a server redirect and not a link the SPA builds

For the SPA to link straight to `:3100/signup`, it would have to _know_ `:3100` — which means
step 0 would have to publish the issuer URL to an unauthenticated caller. The redirect keeps
that server-side: the browser is **told** where to go, one hop at a time, and never handed a
map of the estate.

```ts
const url = new URL('/signup', config.serverMetadata().issuer); // composed, not discovered
```

Note the difference from every other URL in this document. `/auth`, `/token` and `/jwks` are
**discovered** — they come out of accounts' `/.well-known/openid-configuration`, because they
are OIDC endpoints and the spec says where to find them. `/signup` is **not** an OIDC
endpoint; it is our own page, at a path we chose. So the issuer is discovered and the path is
composed onto it.

#### The one flow that does not come back

Every other flow here is a round trip. This one ends at accounts and stops — there is no
callback, no code, nothing written in the jobwork DB. Creating an identity and being allowed
into jobwork are two separate things, and this does only the first.

> 🔴 **Hiding the form was not enough, and this was a real bug.** With the UI showing only an
> SSO button, `POST /api/auth/signup` still answered **201 and created a real account**. The
> form was gone; the door was not. Under SSO the four password routes — `signup`, `login`,
> `forgot-password`, `reset-password` — are now **never mounted**. The enforcement is the
> router, not the markup.

Signing up at accounts creates an identity, nothing more. It does **not** grant jobwork
access — that still needs an invitation (§8, step 8 branch 3).

### 6.3 Signing out

Logging out of jobwork alone is **not a logout**. The local session ends, the browser bounces
to the login screen, and the SSO cookie at accounts is still live — so the next sign-in
completes silently and instantly. It looks like the button did nothing, and on a shared
machine the previous person is one click from being signed back in.

```
GET /api/auth/sso/logout
   1. revoke the local session      → jobwork DB: refresh_tokens.revoked_at = now()
   2. clear the cookies
   3. 302 → :3100/session/end?client_id=jobwork&post_logout_redirect_uri=…
   4. accounts renders a page that submits itself   ← no click, on screen for milliseconds
   5. POST /session/end/confirm            (logout=yes, so the WHOLE session ends)
      → accounts DB: deletes the Session payload
      → accounts DB: sso_sessions.revoked_at = now(), revoked_reason = 'logout'
      → fires back-channel logout to every app with a live grant   (§6.4)
   6. 302 → http://localhost:5173/
```

#### Step 1 is first, unconditional, and allowed to fail silently

```ts
try {
  if (accessToken) await logoutLocalSession(readSessionId(accessToken));
  else if (refreshToken) await logoutLocalSessionByToken(refreshToken);
} catch {
  // nothing to revoke. Still clear the cookie, still go to the IdP.
}
clearTokenCookies(res);
```

Two ways in, because a logout can arrive either way: with an `Authorization: Bearer` header
(the SPA's normal case — `readSessionId` pulls the `sid`, which is the row's primary key), or
with only the `refreshToken` cookie (a plain navigation, no JS). Whichever is present wins.

🔴 **This is one of the very few legitimate `catch` blocks in the codebase** (CLAUDE.md
forbids them in controllers). It qualifies because it _changes behaviour and writes no
response_: a missing or forged token means there is nothing to revoke, and that must not stop
the browser reaching accounts — the SSO session is the whole point of the round trip.

And if the local revoke fails for a real reason, the cookie is cleared anyway. Whatever
happens after this line, **this browser no longer holds a usable jobwork session.**

#### Degrading when the IdP cannot be logged out of

```ts
if (!endSession) {
  res.redirect(`${env.appUrl}/login`);
  return;
}
```

An IdP that publishes no `end_session_endpoint` cannot be logged out of remotely. Local logout
has already happened, so this degrades to _"you are out of jobwork"_ rather than erroring —
failing the whole request here would leave the user staring at a 500 having actually been
logged out.

#### Why there is a page here at all, and why it does not ask

```ts
url.searchParams.set('client_id', env.sso.clientId!); // NOT id_token_hint
```

jobwork does not keep the ID token (§3 — read once at step 7, discarded), so it cannot send an
`id_token_hint`. That costs nothing: `oidc-provider` calls `logoutSource` **whenever a session
exists**, hint or no hint (`lib/actions/end_session.js` → `renderLogout`), so the page is
rendered either way and storing the token would skip nothing.

So the page exists because the library insists on it. It does not ask, because **a logout that
ends only one app is not a logout** — the SSO cookie would survive, the user would land on the
login screen, and the next sign-in would complete silently. `signingOutPage` therefore carries
`logout=yes` as a hidden input and submits itself from `/js/logout-submit.js`.

🔴 **`logout=yes` is the entire difference.** With it, the library destroys the Session and
fans out back-channel logout to every app. Without it, the same request succeeds but only
detaches the one client that asked.

> The script is a **file**, not inline: helmet's `script-src 'self'` blocks inline script on
> every page this service serves. A `<noscript>` button submits the identical form by hand, so
> a blocked or disabled script costs one click rather than making sign-out impossible.

> ⚠️ **What the confirmation was protecting.** Without an `id_token_hint` the provider cannot
> tell that the request genuinely came from the user, so any site can now link to
> `/session/end?client_id=jobwork` and sign the visitor out of every app. Nothing is disclosed
> and nothing is authorised — it is a nuisance, and the same one Google and Zoho accept, where
> sign-out is a plain link. Restoring the click means putting a submit button back in place of
> the hidden input in `signingOutPage`.

> ⚠️ Landing on this URL **twice** (the Back button, a re-used link) gives a 400. That is
> correct — the link is single-use and the first pass already worked. `explain()` in
> `systemViews.ts` turns it into a sentence rather than the library's placeholder.

### 6.4 Back-channel logout — the important one

This is what makes "disable this person everywhere" actually mean _everywhere_.

Without it, jobwork only checks anything at its **refresh boundary**, and it trusts its own
row — so a centrally disabled account keeps working here for up to seven days.

accounts calls each app **directly, server to server**. No browser involved:

```http
POST http://localhost:3000/api/auth/sso/backchannel-logout
Content-Type: application/x-www-form-urlencoded

logout_token=eyJhbGciOiJFZERTQSIs…
```

Decoded, the token says either "this one browser" or "this person, everywhere":

```jsonc
{
  "iss": "http://localhost:3100",
  "aud": "jobwork",
  "sub": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab",
  "sid": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM",
  "events": { "http://schemas.openid.net/event/backchannel-logout": {} },
}
```

#### 🔴 This endpoint ends sessions on the say-so of an unauthenticated POST

There is no cookie, no bearer token, no API key — anyone on the network can call it. **The
token's own validity is the only authentication there is**, so every check in
`logoutToken.ts` is load-bearing and none is a formality. They come from the OIDC
Back-Channel Logout spec §2.6, not from us:

| Check                              | Without it                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature, against accounts' JWKS  | anyone mints their own token and logs out anyone                                                                                              |
| `iss`                              | a token from a _different_ identity provider is accepted                                                                                      |
| `aud` == our `client_id`           | 🔴 a token accounts **legitimately minted for another app** is replayable against this one                                                    |
| `maxTokenAge: 2 minutes`           | a captured token stays usable indefinitely                                                                                                    |
| `events` contains the logout event | 🔴 an ordinary **ID token** works here — and _any_ client gets one just by signing in, so anyone could log their own account out of every app |
| `nonce` must be **absent**         | second guard on the same confusion; the spec forbids it precisely because its presence is the tell that this is an ID token                   |
| `sid` **or** `sub` must be present | 🔴 the filter below is built from them — with neither, `updateMany` runs with an undefined `where` and **revokes every session in the table** |

Every failure returns the same `Invalid logout token.` The caller is a machine, and naming
which check failed only helps whoever is probing their forgery.

```sql
-- jobwork DB — sid ends ONE browser, sub ends the whole account
UPDATE refresh_tokens
   SET revoked_at = now(), revoked_reason = 'sso_logout'
 WHERE idp_session_id = 'btpdNjTMMI97F3YH…' AND revoked_at IS NULL;
```

`sid` is preferred when present; `sub` is the fallback and is what "disable this account
everywhere" uses, because that has no single session to name.

Both filters include `revoked_at IS NULL` so an already-ended session is not re-stamped with
a later time and a wrong reason — the login report would then misreport how it ended.

The revoked count is logged, not returned: the spec fixes the response body, and a count would
tell the caller how many sessions this person had.

The response is deliberately **not** the usual `{ statusCode, message, data }` envelope. The
spec fixes this shape, and the caller is accounts, not our own frontend. Wrapping it would
make a conformant IdP treat every successful logout as a malformed response.

```http
200 OK
Cache-Control: no-store

{}
```

#### How the open tab finds out — `GET /api/auth/session`

The revoke above lands in the database. **Nothing tells the running SPA**, and `authenticate`
never reads the database, so an open tab keeps working normally until its access token lapses —
up to 15 minutes on a screen the user believes they signed out of.

So the tab asks. `useSessionWatch` (mounted once, on `ProtectedRoute`) polls every **15 seconds
while the tab is visible**, and immediately when it regains focus:

```
GET /api/auth/session          →  { "active": true,  "reason": null }
   …back-channel logout lands…
GET /api/auth/session          →  { "active": false, "reason": "sso_logout" }
   → clear the session, clear the query cache, toast, navigate to /login
```

`auth.service.getSessionStatus` resolves the token's `sid` against `refresh_tokens` and checks
`isUsableAccount` on the owner. It answers **200 either way** — never 401 for an ended session,
because the web client's interceptor would catch a 401 and turn it into a silent refresh, which
is the machinery this is trying to get ahead of.

> 🔴 **This is not the per-request lookup CLAUDE.md forbids.** That rule is about
> `authenticate`, which runs on every route. This is one endpoint a client opts into, so the cost
> is bounded by open tabs rather than by request volume — the "cache the lookup on `sid`" escape
> hatch the rule names, taken one step further.

> ⚠️ **Only the sign-out direction.** A tab that is already logged out cannot notice a sign-in
> elsewhere by polling us — only the accounts origin can see its own cookie. That half needs the
> iframe in `SSO_AND_IDENTITY.md` §11, which is still unbuilt.

> ⚠️ **Locally the feed does not fire.** §10.3 of the design doc: `oidc-provider` refuses to POST
> a logout token to `127.0.0.0/8`, so on localhost the back-channel leg never delivers and this
> poll has nothing to react to. The poll itself works; what wakes it needs real hostnames.

### 6.5 Staying signed in

Every 15 minutes the SPA calls `POST /api/auth/refresh-token`. **accounts is not involved** —
this is layer 1 (§3), and it would work identically if accounts were switched off.

#### Six checks, in order, and what each one is actually for

`auth.service.ts` → `refresh`:

| #   | Check                                | Fails how                                             | Why it is separate                                                                                                                                                                                   |
| --- | ------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | JWT signature + `exp`                | 401, and the row is stamped `expired`                 | Done **before touching the database** — a forged token must not cost a query. A genuine aged-out token still has a row, and that row is this login's record, so it is _marked ended_, never deleted. |
| 2   | Row exists **and `revokedAt: null`** | 401                                                   | 🔴 The load-bearing one. It is what makes logout, password reset and deactivation take effect at all, now that rows survive them instead of being deleted.                                           |
| 3   | `session.userId === payload.sub`     | 401, this one session revoked                         | Cannot happen through any code path — `token` is unique and written beside its user. If it ever does, the row is not trustworthy.                                                                    |
| 4   | `session.expiresAt` in the future    | 401, stamped `expired`                                | Belt and braces: checked on the **row** as well as the JWT, because only the row can be shortened by an admin.                                                                                       |
| 5   | `isUsableAccount(user)`              | 403, and **every** session for that user is revoked   | The same predicate as `login`. This and `login` are the whole enforcement surface for account standing.                                                                                              |
| 6   | —                                    | stamp `lastUsedAt`, return the **same** refresh token | No rotation. `sid` still names this row, so logout-by-`sid` and the session report keep pointing at the login this session actually started from.                                                    |

> 🔴 **Check 2 failing revokes nothing, on purpose.** Without rotation there is no legitimate
> way for a live session's token to go missing — so there is no honest user to protect, and
> nobody to punish. The blanket `deleteMany WHERE userId` this replaced is exactly what logged
> people out of every device on one dropped response.

> 🔴 **This is jobwork's entire revocation surface.** `authenticate` does no database lookup at
> all, so a disabled account keeps working for up to 15 minutes and then stops. That is a
> deliberate throughput trade — and it is why back-channel logout (§6.4) matters: it stamps
> `revoked_at`, and check 2 turns that into a locked-out user at the next refresh.

#### What this step does _not_ do

- **No call to accounts.** Not to check the session, not to check the account.
- **No membership or permission check.** Those are re-read on every request by
  `tenantContext` / `requirePermission`, which is why removal from an org is instant while a
  disabled account takes up to 15 minutes.
- **No new refresh token, and no extension.** `expiresAt` was fixed at step 9; a session ends
  seven days after **login**, however active the user is.

---

## 7. Why `users` exists in both databases

The most common question, and the answer is short: **they hold different things.**

| accounts `users`                   | jobwork `users`                                              |
| ---------------------------------- | ------------------------------------------------------------ |
| The identity. Who you are.         | The app's record of you.                                     |
| Password hash lives here           | `password_hash` is `NULL` for SSO users                      |
| Email, verified flag, name, avatar | Memberships, permissions, audit trail                        |
| `id` = the `sub` claim             | `id` = the FK target for every `created_by` in the tenant DB |
| One row per person in the company  | One row per person **who uses jobwork**                      |

They are joined by `jobwork.users.identity_user_id` → `accounts.users.id`. Nothing else.

If you merged them you would have to give the identity service knowledge of organizations,
memberships and permissions — which is exactly the coupling the whole design exists to avoid.

---

## 8. Who is allowed in

| Situation                                              | Result                                                 |
| ------------------------------------------------------ | ------------------------------------------------------ |
| Linked identity, active local user                     | ✅ in                                                  |
| Linked identity, local user disabled                   | ❌ 403 _"This account has been disabled."_             |
| No link, verified email matches an existing user       | ✅ in, and linked from now on                          |
| No link, **unverified** email matches an existing user | ❌ 403                                                 |
| No link, no match, pending invitation                  | ✅ in — user created, still needs to accept the invite |
| No link, no match, no invitation                       | ❌ 403 _"Ask your administrator to invite you."_       |
| Valid identity, no membership anywhere                 | ✅ signed in, lands on `/no-access`                    |

---

## 9. Cheat sheets

### The sign-in, hop by hop — who calls whom, and why

**Read this first, or the table underneath is just a list of URLs.**

Sign-in is a **relay race with one baton**. Exactly one of the three parties is holding it at
any moment, and each hop hands it to the next:

```
        holds the baton →   web SPA     browser      accounts      jobwork API
step                          0            1–2         3–6            7–10          11
```

Three facts explain the whole shape:

1. **jobwork and accounts never talk to each other during steps 2–6.** They cannot: they are
   different origins with no shared session. **The browser is the courier** — it carries the
   request out to accounts and the result back, one redirect at a time. That is why so many
   rows below say _browser_: nobody is making an API call, the browser is simply being sent
   somewhere and following.
2. **The password is only ever typed into accounts.** From step 4 the address bar reads
   `:3100`. jobwork never sees it, at any point, ever.
3. **The two servers speak directly exactly twice** — steps 7a and 7b, after the browser is
   already home. Those two carry the client secret, so they must not pass through a browser.

| Step | What is called                 | From → To                         | Why this hop exists                                                                                                                                                                                       | Hands off to             |
| ---- | ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0    | `GET /api/auth/config`         | web SPA → jobwork                 | The login page must know **which** page to draw — password fields, or one Sign in button.                                                                                                                 | the SPA renders          |
| 1    | _(no request)_                 | James → browser                   | Clicking **Sign in** is `window.location.assign` — a whole-page navigation, not a `fetch`. The SPA is now out of the picture.                                                                             | step 2                   |
| 2    | `GET /api/auth/sso/login`      | browser → jobwork                 | jobwork mints `state` / `nonce` / `code_verifier` and parks them in the `sso_flow` cookie, so that when a browser turns up later claiming to have signed in, it can prove **it started this one**.        | `302` → accounts         |
| 3    | `GET /auth`                    | browser → accounts                | First accounts hears of this login. Is `jobwork` a registered client, is the `redirect_uri` an exact match? No SSO cookie yet ⇒ nobody is signed in here ⇒ open an interaction.                           | `302` → step 4           |
| 4    | `GET /interaction/:uid`        | browser → accounts                | Draw the login form. **The address bar is now `:3100`** — see fact 2.                                                                                                                                     | James types              |
| 5    | `POST /interaction/:uid/login` | browser (form) → accounts         | The one and only password check in the estate: argon2 verify against the accounts `users` row.                                                                                                            | `303` → step 6           |
| 6    | `GET /auth/:uid`               | browser → accounts                | accounts now knows who this is, so it finishes the request it parked at step 3: starts the SSO session (`_session` cookie), records the grant for jobwork, and mints a **single-use** authorization code. | `302` → step 7, `?code=` |
| 7    | `GET /api/auth/sso/callback`   | browser → jobwork                 | The baton comes home. jobwork reopens its `sso_flow` cookie and checks `state` matches — proof this is the login **it** started, not one someone else handed this browser.                                | steps 7a, 7b             |
| 7a   | `POST /token`                  | jobwork → accounts _(no browser)_ | Trade the code for the ID token, presenting the client secret and the original `code_verifier`. Server-to-server precisely so the secret never reaches a browser.                                         | 7b                       |
| 7b   | `GET /jwks`                    | jobwork → accounts _(no browser)_ | Fetch accounts' public keys to verify the ID token's signature. Cached, so this is not usually a live call.                                                                                               | step 8                   |
| 8    | _(no request — jobwork DB)_    | jobwork → its own DB              | **Who is this locally?** Link by identity id → else by verified email → else create from a pending invitation → else 403. §8 has the full table.                                                          | step 9                   |
| 9    | _(no request — jobwork DB)_    | jobwork → its own DB              | From here it is an ordinary jobwork login: write `refresh_tokens`, set the `refreshToken` cookie. OIDC is finished and never runs again.                                                                  | step 10                  |
| 10   | _(no request)_                 | jobwork → browser                 | Decide where to land — the `returnTo` deep link, an org, or `/no-access`.                                                                                                                                 | `302` → `:5173`          |
| 11   | `POST /api/auth/refresh-token` | web SPA → jobwork                 | The page just hard-reloaded from a redirect, so the SPA holds **no access token in memory**. It does what it does after any reload.                                                                       | signed in                |

Steps 8–10 make no HTTP call at all — that is why the URL list has a gap there, not because
something is missing.

### The other flows (§6), same reading

| Flow                | What is called                          | From → To                         | Why                                                                                                                      |
| ------------------- | --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| §6.1 returning user | _same steps 0–2, then_ `GET /auth`      | browser → accounts                | The `_session` cookie is presented, so steps 4–5 are skipped entirely. No form, no password.                             |
| §6.2 signup         | `GET /api/auth/sso/signup`              | browser → jobwork                 | One-hop redirect out, so the issuer URL is never published to an unauthenticated caller.                                 |
| §6.3 logout         | `GET /api/auth/sso/logout`              | browser → jobwork                 | Kill the local session **first**, then send the browser to accounts to end the SSO session too.                          |
| §6.4 back-channel   | `POST /api/auth/sso/backchannel-logout` | accounts → jobwork _(no browser)_ | The reverse direction, and the only one: accounts phones each app to say "that session is over". No user is present.     |
| §6.4 the poll       | `GET /api/auth/session`                 | web SPA → jobwork, every 15 s     | The revoke above only reaches the database. This is how the open tab finds out, instead of waiting out its access token. |

### Which table, when

_Step numbers are §4's steps, as in the table above._

| Table                 | DB       | Read                   | Written                                |
| --------------------- | -------- | ---------------------- | -------------------------------------- |
| `oidc_clients`        | accounts | step 3, at boot        | never at runtime                       |
| `oidc_payloads`       | accounts | steps 4, 6, 7          | steps 3, 6 — **deleted** on use/logout |
| `users`               | accounts | step 5                 | signup, password reset                 |
| `sso_sessions`        | accounts | reporting              | step 6; `revoked_at` on logout         |
| `session_grants`      | accounts | logout fan-out         | step 6, one row **per app**            |
| `signing_keys`        | accounts | step 7 (`/jwks`)       | key rotation only                      |
| `verification_tokens` | accounts | signup / reset         | signup / reset — deleted on use        |
| `users`               | jobwork  | step 8                 | step 8 (link or create)                |
| `invitations`         | jobwork  | step 8                 | accepting an invite                    |
| `refresh_tokens`      | jobwork  | every refresh          | step 9; `revoked_at` on logout         |
| `memberships`         | jobwork  | step 10, every request | inviting / removing                    |

### The accounts tables, column by column

Source of truth: `accounts/prisma/schema/identity.prisma`. Example values are James's, from
§4 — so a row here is literally what that walkthrough writes.

#### `users` — the identity itself

One row per person. **This row's `id` is the `sub`**, and it is the only thing that may be
used as a join key: people change emails, they never change this.

| Column                    | Type           | What it is for                                                                                                                          |
| ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid           | The `sub`. Permanent. jobwork stores it as `users.identity_user_id`.                                                                    |
| `email`                   | citext         | Login handle. **Citext**, so `James@…` and `james@…` are one account.                                                                   |
| `email_verified`          | bool           | Gate, not decoration — an **unverified** address may not auto-link to an existing jobwork user (§8, row 4).                             |
| `password_hash`           | text?          | argon2, cost parameters embedded. **Nullable** — a social-only identity would have none.                                                |
| `first_name` `last_name`  | varchar(40)    | Display name. Sent in the ID token as `name`.                                                                                           |
| `avatar_url`              | text?          | Optional.                                                                                                                               |
| `is_active` `is_deleted`  | bool           | Together = the same `ACTIVE_USER` predicate the app uses. 🔴 Flipping either must revoke every SSO session **in the same transaction**. |
| `created_at` `updated_at` | timestamptz(6) | —                                                                                                                                       |

```jsonc
{
  "id": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab", // ← the sub
  "email": "james.walker@example.com",
  "email_verified": true,
  "password_hash": "$argon2id$v=19$m=65536,t=3,p=4$…",
  "first_name": "James",
  "last_name": "Walker",
  "avatar_url": null,
  "is_active": true,
  "is_deleted": false,
}
```

**Read at step 5** (argon2 verify). Written at signup and password reset — never during a
sign-in.

#### `sso_sessions` — one row per browser

The "you are signed in at accounts" cookie, made durable. This is what makes the _second_
app's sign-in silent.

| Column                      | Type         | What it is for                                                                                                              |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | varchar(64)  | 🔴 The provider's **session uid** — a 43-char nanoid, **not a uuid and not a `sid`**. Postgres rejects it as uuid outright. |
| `user_id`                   | uuid         | → `users.id`. `onDelete: Cascade`.                                                                                          |
| `expires_at`                | timestamptz  | When the SSO cookie dies.                                                                                                   |
| `created_at` `last_used_at` | timestamptz  | The login report — real login time, last activity.                                                                          |
| `revoked_at`                | timestamptz? | **null = live.** Row is kept, never deleted, so every live-session read must filter `revokedAt: null`.                      |
| `revoked_reason`            | varchar(32)  | `logout` · `expired` · `password_reset` · `account_disabled` · `admin_revoked`                                              |
| `user_agent`                | text?        | Which browser, for the report.                                                                                              |

```jsonc
{
  "id": "aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD",
  "user_id": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab",
  "expires_at": "2026-09-08T11:02:44Z",
  "created_at": "2026-08-25T11:02:44Z",
  "last_used_at": null,
  "revoked_at": null,
  "revoked_reason": null,
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) …",
}
```

**Written at step 6**, stamped `revoked_at` at logout.

#### `session_grants` — one row per (browser, app)

| Column       | Type                   | What it is for                                                                                                                                                                                      |
| ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | uuid                   | —                                                                                                                                                                                                   |
| `session_id` | varchar(64)            | → `sso_sessions.id`.                                                                                                                                                                                |
| `client_id`  | varchar(64)            | Which app. `'jobwork'`.                                                                                                                                                                             |
| `sid`        | varchar(64) **unique** | 🔴 **The `sid` claim, and it is per app.** Two apps get two different `sid`s for one browser — deliberate, so apps cannot correlate the same user. That is why `sid` cannot be `sso_sessions`' key. |
| `created_at` | timestamptz            | —                                                                                                                                                                                                   |

`@@unique([session_id, client_id])` — one grant per app per session.

```jsonc
{
  "id": "d7c1e4a0-…",
  "session_id": "aTaxLss67-iMsRqY6R53M5vYifeSwOGLVyE39F6IopD",
  "client_id": "jobwork",
  "sid": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM", // ← jobwork stores this as idp_session_id
  "created_at": "2026-08-25T11:02:44Z",
}
```

This table answers logout's two questions: _which apps must I notify_ (read by `session_id`)
and _which session is this logout token about_ (read by `sid`).

#### `oidc_clients` — the registry of apps allowed to use this IdP

| Column                      | Type        | What it is for                                                                                                                                                                                      |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | varchar(64) | The `client_id` an app sends. `'jobwork'`.                                                                                                                                                          |
| `name`                      | varchar(80) | Shown on the consent/logout page.                                                                                                                                                                   |
| `secret_hash`               | text        | argon2 — **never plaintext**. Checked at step 7a.                                                                                                                                                   |
| `redirect_uris`             | text[]      | 🔴 **Exact string match. No wildcards, no prefixes.** A loose entry turns the authorization code into something deliverable to an attacker's host. Also the source for the `form-action` CSP (§10). |
| `post_logout_redirect_uris` | text[]      | Where an app may send you after logout — same exactness.                                                                                                                                            |
| `backchannel_logout_uri`    | text?       | Where accounts phones this app (§6.4). Null = app does not support it.                                                                                                                              |
| `is_active` `is_deleted`    | bool        | Retire an app without deleting its history.                                                                                                                                                         |

```jsonc
{
  "id": "jobwork",
  "name": "Jobwork",
  "secret_hash": "$argon2id$…",
  "redirect_uris": ["http://localhost:3000/api/auth/sso/callback"],
  "post_logout_redirect_uris": ["http://localhost:5173/"],
  "backchannel_logout_uri": "http://localhost:3000/api/auth/sso/backchannel-logout",
  "is_active": true,
  "is_deleted": false,
}
```

**Read at step 3**, loaded once at boot — add a client and accounts must restart.

#### `signing_keys` — what makes an ID token trustworthy

| Column        | Type         | What it is for                                                                                                                       |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `kid`         | varchar(64)  | Key id. Travels in the **ID token header** so a verifier knows which key to use.                                                     |
| `algorithm`   | varchar(16)  | `EdDSA` \| `RS256`.                                                                                                                  |
| `public_jwk`  | json         | Published at `/jwks` — this is the whole of step 7b.                                                                                 |
| `private_jwk` | json         | 🔴 Encrypted at rest with a key **not in this database**. A dump otherwise mints tokens for anyone, for any app, forever.            |
| `retired_at`  | timestamptz? | Newest active key signs; retired keys **stay published** until the longest token lifetime has passed, or you invalidate live tokens. |

```jsonc
{
  "kid": "2026-08-a",
  "algorithm": "EdDSA",
  "public_jwk": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  },
  "private_jwk": "<encrypted>",
  "retired_at": null,
}
```

#### `verification_tokens` — proving control of an inbox

Not part of sign-in. Signup and password reset only.

| Column       | Type        | What it is for                                                                                                                                   |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | uuid        | —                                                                                                                                                |
| `email`      | citext      | 🔴 **Keyed by email, not user id** — reset must not reveal whether an address has an account, so the lookup happens before any user is resolved. |
| `otp`        | varchar(6)  | 6-digit, because a human retypes it. The 10-minute expiry and single-use delete are what make that safe, not length.                             |
| `purpose`    | varchar(20) | `password_reset` \| `email_verify`. One table, not two — identical lifecycle, so one place to get the expiry check right.                        |
| `expires_at` | timestamptz | 10 minutes.                                                                                                                                      |

```jsonc
{
  "id": "9a3f…",
  "email": "james.walker@example.com",
  "otp": "418320",
  "purpose": "password_reset",
  "expires_at": "2026-08-25T11:12:44Z",
}
```

Deleted on use. A spent credential kept around is only a liability.

#### `oidc_payloads` — everything the library persists

One table for every object `oidc-provider` stores, keyed by **(type, id)** — the same id can
exist under two model names, so neither column is unique alone.

| Column       | Type          | What it is for                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`       | varchar(40)   | The library's model name — `Interaction`, `Session`, `Grant`, `AuthorizationCode`. 🔴 **A label, never a status:** set at creation, never updated. Nothing "becomes" a Session. Also duplicated inside the blob as `payload.kind` — see the note below the timeline.                                                                                                            |
| `id`         | varchar(255)  | That object's id. **PK is `(type, id)`.**                                                                                                                                                                                                                                                                                                                                       |
| `payload`    | json          | The library's own blob. Opaque to us — do not read it in app code.                                                                                                                                                                                                                                                                                                              |
| `grant_id`   | varchar(255)? | Ties tokens to a grant; `revokeByGrantId` walks this on consent revocation.                                                                                                                                                                                                                                                                                                     |
| `uid`        | varchar(255)? | Lets a row be found by **its own uid** instead of its id — `findByUid`. Written from `payload.uid`, which only `Session` and `Interaction` carry, so it is null on every token row. 🔴 It does **not** link an Interaction to its Session: those are two different uids. That link is `payload.session.uid` inside the Interaction, and a token's link is `payload.sessionUid`. |
| `user_code`  | varchar(64)?  | Device flow. Unused here.                                                                                                                                                                                                                                                                                                                                                       |
| `expires_at` | timestamptz   | Swept every 15 minutes by `sweeper.ts` (started in `server.ts:29`). Expiry is _also_ enforced on read, so the sweep is growth control, not what makes expiry safe. ⚠️ In-process timer, so a spun-down instance simply misses a pass.                                                                                                                                           |

Four kinds of row take part in one sign-in:

| `type`              | `id`                                                                       | Written | Gone when                                        |
| ------------------- | -------------------------------------------------------------------------- | ------- | ------------------------------------------------ |
| `Interaction`       | `YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS`                              | step 3  | step 6 consumes it                               |
| `Session`           | `Hn4KpQ2rTvXz7B9cLmS3dF6gJ8kW1yA5eR0uZoI-tNb` (jti; `uid` = `aTaxLss67-…`) | step 6  | logout, or expiry                                |
| `Grant`             | uuid                                                                       | step 6  | consent revoked                                  |
| `AuthorizationCode` | `TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi`                              | step 6  | **expiry (60 s), then the sweep** — _not_ step 7 |

#### 🔴 They coexist — they are not stages of one row

The commonest misreading of this table is that a row starts as `Interaction` and its `type`
advances to `Session`, then `Grant`. It does not. **`type` is never updated.** Each kind is a
separate row, created and deleted on its own schedule — read _across_ a line below and you will
see several kinds alive at the same moment:

| Moment                    | `Interaction`                      | `Session`                          | `Grant`     | `AuthorizationCode`                              |
| ------------------------- | ---------------------------------- | ---------------------------------- | ----------- | ------------------------------------------------ |
| after step 3              | **uid1 created**                   | —                                  | —           | —                                                |
| step 5, password accepted | uid1 — _payload_ gains `result`    | —                                  | —           | —                                                |
| step 6, pass ①            | uid1 **deleted**, **uid2 created** | **jti1 created**                   | —           | —                                                |
| step 6, the consent hop   | uid2 — _payload_ gains `result`    | jti1                               | **created** | —                                                |
| step 6, pass ②            | uid2 **deleted**                   | jti1 **deleted**, **jti2 created** | ✔           | **created**                                      |
| step 7, token exchange    | —                                  | jti2                               | ✔           | ✔ _payload_ gains `consumed` — **the row stays** |
| ~60 s later, next sweep   | —                                  | jti2                               | ✔           | **deleted**, by expiry                           |

🔴 **Single-use does not mean deleted.** `adapter.consume()` stamps `consumed` in the payload and
leaves the row (`adapter.ts:75`). It has to: the library's reuse check is
`if (source.consumed) → revoke the whole grant` (`grant_common.js:29`), so a deleted row would read
as "code not found" instead of as theft, and the response to a replayed code would be a plain error
rather than tearing down every token under that `grantId`. The row is the evidence. It goes when it
expires — 60 s — and `sweeper.ts` clears it on the next 15-minute pass.
| once signed in | _(none)_ | jti2 | ✔ | _(none)_ |

What _does_ change after creation is the `payload` JSON, and only on the Interaction: step 5 adds
one `result` key to it (step 3 shows the before, step 5 the after). The other three kinds are only
ever created or deleted — even the Session's jti rotation is a delete plus a create, never an edit.

> **`type` the column vs `kind` inside the payload — same value, two owners.** Our adapter writes
> the `type` **column** from the model name it was built with; the library writes `"kind"` **inside
> `payload`** when it serializes the object, and on load throws `kind mismatch` if the two ever
> disagreed. Neither side reads the other's copy: the column is how the row is _found_, the `kind`
> is how the object proves it is _what was asked for_. `kind` also names the library's events —
> `snakeCase('Session') + '.saved'` is the `session.saved` that step 6(c)'s listener waits on.

```jsonc
{
  "type": "AuthorizationCode",
  "id": "TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi",
  "payload": {
    "accountId": "8f2b1c04-…",
    "clientId": "jobwork",
    "redirectUri": "http://localhost:3000/api/auth/sso/callback",
    "codeChallenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    "codeChallengeMethod": "S256",
    "nonce": "pL4tR9wZ…",
    "scope": "openid email profile",
    "sessionUid": "aTaxLss67-…",
  }, // ← the session uid lives INSIDE the payload…
  "grant_id": "…",
  "uid": null, // …the column stays null; only Session and
  "expires_at": "2026-08-25T11:03:44Z",
} //    Interaction rows populate it. 60 seconds
```

> **`sso_sessions` vs `oidc_payloads(Session)` — why both.** They are written at the same
> moment, but they do **not** share an id: the payload row is keyed by the **jti**, and
> `sso_sessions.id` holds the **uid** (step 6a — the jti rotates, the uid does not). The
> payload row is the **library's**: opaque, ephemeral, its shape the library's business.
> `sso_sessions` is **ours**: queryable columns for the login report and for "end every session
> for this user", which is not something to express by parsing someone else's JSON blob.

### The jobwork tables, column by column

Source of truth: `backend/prisma/schema/tenant.prisma`. These tables long predate SSO and are
used by the whole application — **only the columns SSO touches are listed here.** `users` in
particular has ~40 more scalar columns (address, phone, avatar) and ~60 relations that have
nothing to do with signing in.

#### `users` — the local account, and the bridge between the two databases

| Column                               | Type             | What it is for                                                                                                                                                                              |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | uuid             | 🔴 **Stays the FK target for everything** — every `membership`, `created_by`, `updated_by` in this database points here. It is _not_ the `sub`.                                             |
| `identity_user_id`                   | uuid? **unique** | **The bridge.** The accounts `sub`. Written **once**, at first SSO sign-in, then never rewritten — emails change, `sub` does not. `unique` so one identity cannot claim two local accounts. |
| `email`                              | citext           | How an unlinked user is matched to an identity at step 8 — and _only_ if accounts says the address is verified.                                                                             |
| `password_hash`                      | text?            | Under SSO this is **never read**. Nullable because an SSO-created user never had one.                                                                                                       |
| `first_name` `last_name` `full_name` | varchar          | Populated from the ID token's claims when the user is created at step 8.                                                                                                                    |
| `is_active` `is_deleted`             | bool             | `ACTIVE_USER`. Checked at step 8 (403 if failed) and at every refresh — **not** on ordinary requests.                                                                                       |
| `user_agent` `ip_address`            | text?            | Overwritten on **every** login, so they describe the latest device only. Per-session detail lives on `refresh_tokens`.                                                                      |

```jsonc
{
  "id": "3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5", // ← FKs point here
  "identity_user_id": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab", // ← the sub, set once
  "email": "james.walker@example.com",
  "password_hash": null,
  "first_name": "James",
  "last_name": "Walker",
  "full_name": "James Walker",
  "is_active": true,
  "is_deleted": false,
}
```

**Read and written at step 8** — link, or create. §7 explains why this table exists at all
when accounts has one too.

#### `refresh_tokens` — the local session, and the whole revocation surface

| Column           | Type             | What it is for                                                                                                                                                                                                                            |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid             | 🔴 **This is the `sid` claim in _our_ access token.** Not the IdP's. See the trap below.                                                                                                                                                  |
| `token`          | text **unique**  | The cookie value. **Not rotated** — `refresh` returns the same token and mints only a new access token. Reintroducing rotation logs users out at random.                                                                                  |
| `user_id`        | uuid             | → `users.id`, `onDelete: Cascade` (hard deletes only — this codebase soft-deletes).                                                                                                                                                       |
| `expires_at`     | timestamptz      | 7 days.                                                                                                                                                                                                                                   |
| `last_used_at`   | timestamptz?     | With `created_at`, session length. Null = never came back after login.                                                                                                                                                                    |
| `revoked_at`     | timestamptz?     | **null = live.** Rows are never deleted, so every live-session read must filter this or a logged-out session keeps working.                                                                                                               |
| `revoked_reason` | varchar(32)      | `logout` \| `expired` \| `password_reset` \| `account_disabled` \| `superseded` \| **`sso_logout`**. The last one is written by back-channel logout — kept distinct so the report can tell _signed out here_ from _signed out centrally_. |
| `idp_session_id` | **varchar(64)?** | The `sid` from the ID token. Indexed, because back-channel logout arrives naming one.                                                                                                                                                     |
| `idp_subject`    | uuid?            | The `sub`. Indexed, because "disable this account everywhere" has no single `sid`.                                                                                                                                                        |
| `user_agent`     | text?            | Captured at login, so a report can say _which_ device — `users.user_agent` is overwritten every login and cannot answer that.                                                                                                             |

```jsonc
{
  "id": "e2a6b8c1-…", // ← our own sid
  "token": "…",
  "user_id": "3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5",
  "idp_session_id": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM", // ← the IdP's sid
  "idp_subject": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab",
  "revoked_at": null,
  "revoked_reason": null,
  "expires_at": "2026-09-01T11:02:44Z",
}
```

> 🔴 **Two different ids, one word.** `id` is the `sid` in the access token _we_ issue.
> `idp_session_id` is the `sid` _accounts_ issued. They are unrelated values, and confusing
> them in the revoke path **fails open** — a logout token would match nothing and silently
> revoke nothing. Never rename `idp_session_id` to `sid`.

> 🔴 **`varchar(64)`, not `uuid`** — corrected 2026-08-24. The IdP's `sid` is a 43-char
> `nanoid`; Postgres rejects one as `invalid input syntax for type uuid`. The original spec
> said `@db.Uuid`, which would have failed on the very first SSO login.

**Written at step 9**, read at every refresh, stamped `revoked_at` by logout (§6.3) and by
back-channel logout (§6.4).

#### `invitations` — the entitlement gate

Authentication says _who you are_; this table is most of _may you be here at all_.

| Column                                   | Type               | What it is for                                                                                                                                                                                              |
| ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization_id`                        | uuid               | Which org is inviting.                                                                                                                                                                                      |
| `email`                                  | citext             | 🔴 **The join key at step 8.** A brand-new identity is only allowed to create a local user if a **pending** row here matches their verified address. No row ⇒ 403 _"Ask your administrator to invite you."_ |
| `token_hash`                             | text unique        | The emailed link, hashed — the plaintext is never stored.                                                                                                                                                   |
| `status`                                 | varchar(20)        | `pending` by default. Only `pending` counts at step 8.                                                                                                                                                      |
| `expires_at` `accepted_at` `declined_at` | timestamptz        | Lifecycle. An expired invite is not an entitlement.                                                                                                                                                         |
| `permission_template_id`                 | uuid, **required** | What access they get on acceptance — decided at invite time, not at sign-in.                                                                                                                                |
| `role_id`                                | uuid?              | Their job title. Grants nothing (see `memberships`).                                                                                                                                                        |
| `first_name` `last_name`                 | varchar?           | Nullable **on purpose** — invites predating 2026-07-30 have none, and inventing names from an email local-part would be fabricated data in a customer's org.                                                |

`@@unique([organizationId, email])` — one open invitation per person per org.

```jsonc
{
  "organization_id": "b41f7a90-2c3d-4e58-8a71-9f0b6d2e4c13",
  "email": "james.walker@example.com",
  "status": "pending",
  "permission_template_id": "…",
  "role_id": "…",
  "first_name": "James",
  "last_name": "Walker",
  "expires_at": "2026-09-01T09:00:00Z",
  "accepted_at": null,
}
```

**Read at step 8.** Note SSO does **not** auto-accept it — signing in creates the user; they
still land on `/no-access` until the invitation is accepted and a membership exists.

#### `memberships` — what "in" actually means

Written by inviting, not by signing in. Read at step 10 and then on **every single request**
for the rest of the session — which is why removing someone takes effect immediately, while a
disabled _account_ takes up to 15 minutes (§3).

| Column                               | Type    | What it is for                                                                                                                                     |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id` `organization_id`          | uuid    | The pair. `@@unique([userId, organizationId])`.                                                                                                    |
| `is_owner`                           | bool    | 🔴 **Above the permission system.** `tenantContext` resolves an owner to every permission _before_ reading a template, so no route branches on it. |
| `permission_template_id`             | uuid?   | **This is the authorization.** What `requirePermission` checks against.                                                                            |
| `role_id`                            | uuid?   | **A job title that grants nothing.** No middleware reads it. Same title, different access, is normal.                                              |
| `is_active`                          | bool    | Deactivated _in this org_, keeping the row and its attribution. `tenantContext` filters on it — not a display flag.                                |
| `is_deleted`                         | bool    | Removed from the org.                                                                                                                              |
| `first_name` `last_name` `full_name` | varchar | Per-org name, separate from the account's.                                                                                                         |
| `custom_fields`                      | jsonb   | Per-org dynamic fields, `entityType: 'member'`.                                                                                                    |

```jsonc
{
  "user_id": "3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5",
  "organization_id": "b41f7a90-2c3d-4e58-8a71-9f0b6d2e4c13",
  "is_owner": false,
  "permission_template_id": "…",
  "role_id": "…",
  "is_active": true,
  "is_deleted": false,
  "first_name": "James",
  "last_name": "Walker",
  "full_name": "James Walker",
}
```

> **Three "active" flags, three scopes** — worth keeping straight, because they read alike and
> fail differently:
>
> | Flag                         | Scope                   | Takes effect                                                   |
> | ---------------------------- | ----------------------- | -------------------------------------------------------------- |
> | `users.is_active` (accounts) | every app in the estate | at each app's refresh, or immediately with back-channel logout |
> | `users.is_active` (jobwork)  | this app, all orgs      | next refresh — up to 15 min                                    |
> | `memberships.is_active`      | **one org**             | next request                                                   |

---

## 10. When it goes wrong

**"Sign-in expired. Please try again."**
The `sso_flow` cookie is missing. Either more than 10 minutes passed on the login screen, or
the cookie was blocked. If it happens on _every_ attempt, check `SameSite` — `Strict` drops
the cookie on the way back from accounts and every login fails.

**403 "You don't have access to this app."**
Working as designed. There is no pending invitation for that email, _or_ the address is not
verified at accounts. Both are required.

**Signed in, but landed on `/no-access`.**
Authentication worked; entitlement did not. The user has no membership. Invite them, and have
them accept it.

**🔴 The `form-action` trap — read this before touching the CSP.**
Signing in was blocked outright by `form-action 'self'`, and it took three attempts to find.

A browser enforces `form-action` across the **whole redirect chain** a form submission
causes, not just its immediate target. The login form posts same-origin, but the chain then
leaves accounts:

```
POST /interaction/:uid/login → /auth/:uid → :3000 callback → :5173 app
      accounts                 accounts      ANOTHER ORIGIN   ANOTHER ORIGIN
```

That hop violates `'self'`, so the browser kills the submission — and reports it against the
form's own **same-origin** action, which reads as the policy contradicting itself and sends
you looking anywhere but at the redirect chain.

_Nothing about this is specific to localhost._ In production the chain is
`accounts.octfis.com → jobwork.octfis.com`, still cross-origin, so it would have failed
identically on the first real deploy.

The fix: `form-action` allows the origins from the **client registry** — exactly the redirect
targets an administrator already approved.

> ⚠️ **No server-side test can catch a regression in this.** CSP is enforced _only by
> browsers_; `fetch`, `curl` and supertest ignore the header entirely, so a completely broken
> sign-in passes every HTTP-level assertion. That is exactly how it shipped. **Verify sign-in
> changes in a real browser.**

**Also worth knowing:** helmet sends HSTS by default, and Chrome caches it for `localhost` as
a whole — `includeSubDomains`, so every port. Nothing local serves HTTPS, so it breaks
everything, and **it outlives the fix**: removing the header does not clear what the browser
stored. Clear it at `chrome://net-internals/#hsts`. HSTS is now production-only.

---

## 11. Glossary

| Term                    | Plain English                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SPA**                 | Single Page Application — the React app in `web/`. **Always jobwork's front end, never accounts**, which serves plain HTML (§2).                                                                                                                                               |
| **OIDC**                | The standard this all follows. "Log in with Google" uses the same one.                                                                                                                                                                                                         |
| **IdP**                 | Identity Provider — the `accounts` service.                                                                                                                                                                                                                                    |
| **RP**                  | Relying Party — an app that trusts the IdP. jobwork is one.                                                                                                                                                                                                                    |
| **`sub`**               | The identity's permanent id. Never changes, even if the email does.                                                                                                                                                                                                            |
| **`sid`**               | Session id, **per app**. One browser session has one `uid` and many `sid`s. Not short for `session_id` (§9).                                                                                                                                                                   |
| **`uid`**               | A session's **stable** id, for the life of the browser session. Every durable row keys on this.                                                                                                                                                                                |
| **`jti`**               | The same session's **rotating** id — what the `_session` cookie carries and what `oidc_payloads.id` holds. Changes on a per-app logout, so never key on it (step 6a).                                                                                                          |
| **`type`** / **`kind`** | The same word in two places: `oidc_payloads.type` is the **column** (half the primary key, how a row is found); `payload.kind` is inside the JSON (the library's own self-check). Both say which model the row is — `Session`, `Grant`, … — and **neither ever changes** (§9). |
| **ID token**            | The signed note saying who you are. Read once, at login, then discarded.                                                                                                                                                                                                       |
| **PKCE**                | Proof that the app redeeming the code is the one that started the login.                                                                                                                                                                                                       |
| **`state`**             | Proof you started this login, not someone else (CSRF).                                                                                                                                                                                                                         |
| **`nonce`**             | Proof this token is fresh, not a replay.                                                                                                                                                                                                                                       |
| **JWKS**                | The IdP's public keys, so apps can verify signatures without asking.                                                                                                                                                                                                           |
| **Back-channel logout** | The IdP phoning each app directly to say "end this session".                                                                                                                                                                                                                   |
| **Entitlement**         | _Are you allowed in this app?_ — separate from _who are you?_                                                                                                                                                                                                                  |

---

## 12. Running it locally

Three terminals:

```bash
cd accounts && npm run dev     # :3100  the identity provider
cd backend  && npm run dev     # :3000  the API
cd web      && npm run dev     # :5173  the React app
```

`SSO_ENABLED=true` must be set in `backend/.env`, and `backend`'s `SSO_CLIENT_ID` /
`SSO_CLIENT_SECRET` must match a row in the accounts DB's `oidc_clients`.

To let existing jobwork users sign in with the password they already have:

```bash
cd accounts && npm run seed:identities            # dry run — prints what it would do
cd accounts && npm run seed:identities -- --apply # writes
```

This works because argon2 stores its cost parameters inside the hash string, so a hash made
by one service verifies in another with no shared configuration.

---

**See also:** `SSO_AND_IDENTITY.md` (design, trade-offs, rejected alternatives, the rollout
plan) · `AUTHENTICATION.md` (jobwork's own session model) · `ROLES_AND_PERMISSIONS.md` (what
happens _after_ sign-in).
