# SSO website entry: sign-in moves to octfis.com

> **Purpose.** Today sign-in starts on jobwork's own `/login` screen. It is moving to a public
> product website — `https://www.octfis.com/jobwork`, one page per app — which is what Google
> indexes and what carries the button. This document is the plan: what changes on each of the three sites, what
> deliberately does not, and the traps between them.
>
> The design this builds on is `docs/SSO_AND_IDENTITY.md`; the worked example of a single sign-in is
> `docs/SSO_WALKTHROUGH.md`. **Neither is superseded.** This changes where a sign-in _starts_ and
> where an unauthenticated visitor is _sent_ — the entry and the exit, not the flow between them.

_Status: **✅ fully deployed to production from `feat/singleSignOn`** — steps 1–4 and phase A
on 2026-09-21, phase B (§5.6) on 2026-09-26 once the page moved to the public
`www.octfis.com/jobwork`. Verified live that day: a signed-out direct visit bounces to the website,
a second silent attempt within 30 s falls to `/login?sso=manual`, and logout hands accounts
`post_logout_redirect_uri=https://www.octfis.com/jobwork`, which it accepts. `feat/singleSignOn` was merged into `dev` on 2026-09-26 (`05e4f08`), so a
deploy from `dev` carries all of it. The website page is owned by a different developer;
what they need from us is a link and one endpoint, and that contract is already handed over (§3).
Sections below are marked with the site they belong to._

🔴 **The website URL is `https://www.octfis.com/jobwork` — exactly that string, decided
2026-09-26.** It replaces `https://www.octfis.com/job-work-1` (decided 2026-09-21), which now
answers 404: the button and probe script moved onto the existing `/jobwork` page, which had been
the public page for the _Zoho Creator_ Jobwork app. Three things on our side match it by exact
string or exact origin (§4.2, §4.5, §5.6), so it is a contract: the page is not renamed without
changing all three in the same release. The origin did not change, so §4.2's CORS allowlist and
the CSP `form-action` list were untouched by the move; only §4.5 and §5.6 carry the path.

- **`www` is the only host that serves it.** Bare `https://octfis.com/jobwork` answers 404, so
  the origin is `https://www.octfis.com`, never `https://octfis.com`.
- **No trailing slash.** `https://www.octfis.com/jobwork/` answers 404 too, and accounts matches
  the post-logout URI byte for byte.

🔴 **Two prerequisites sat in front of all of this on 2026-09-21:**

1. ~~**Production jobwork is not running an SSO build.**~~ _Resolved the same day: production was
   redeployed from `feat/singleSignOn` with `SSO_ENABLED=true`. It had been running a `dev` build
   with no SSO code and the flag off. That regression risk ended when the branch was merged into
   `dev` on 2026-09-26._
2. ~~**The website page is IP-restricted.**~~ _Resolved 2026-09-26: the button moved to the
   already-public `www.octfis.com/jobwork` (200 from outside the office, probe script in place).
   §5.2's bounce and §5.6's post-logout both land there._

| Section                            | Site                  | State                                                                                                                                                       |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 what does not change            | —                     | ✅ true today, and must stay true                                                                                                                           |
| §2 the same-site cookie            | —                     | the fact the whole design rests on                                                                                                                          |
| §3 the website                     | `www.octfis.com`      | ✅ external — live on `www.octfis.com/jobwork` (button + probe), checked 2026-09-26                                                                         |
| §4 the identity provider           | `accounts.octfis.com` | ✅ §4.1–§4.5 and noindex **deployed to production 2026-09-21** (`/` is now the login form + My Account; `jobwork-production` accepts both post-logout URIs) |
| §5 the app                         | `jobwork.octfis.com`  | ✅ §5.1–§5.5 and §5.7 **deployed to production 2026-09-21** (SSO on); ✅ §5.6 values (phase B) **deployed 2026-09-26**                                      |
| §6 the four flows                  | —                     | ✅ checked on the live hosts 2026-09-26, plus a brand-new invitee end to end (run locally)                                                                  |
| §7 traps                           | —                     | 🔴 read before implementing                                                                                                                                 |
| §8 build order                     | —                     | ✅ every step deployed (last: step 5 B, 2026-09-26)                                                                                                         |
| §9 open decisions                  | —                     | ✅ all decided — `/no-access` copy 2026-09-22, status endpoint boolean-only 2026-09-26                                                                      |
| §10 documents this will invalidate | —                     | ✅ edited 2026-09-22 (walkthrough, identity doc, the accounts `No CORS` comment)                                                                            |

_Last updated: 2026-09-26 — the website page moved from `/job-work-1` to `/jobwork` and is
public; phase B deployed. Build-order steps 1–4 and step 5 phase A deployed 2026-09-21._

---

## 1. What does not change

Worth stating first, because it bounds the work. The two-layer model in `SSO_WALKTHROUGH.md` §3
survives completely. None of this is touched:

- the code exchange, PKCE, `state`/`nonce`, the `sso_flow` cookie (`sso.controller.ts:55,115`)
- `issueTokens` / `refresh_tokens` / `authenticate` / `tenantContext` / `requirePermission`
- `linkOrCreateLocalUser`, `provisionOrRefuse`, the invitation entitlement check _(true for this
  plan; separately on 2026-09-22 the entitlement check was replaced by self-signup —
  `provisionLocalUser`, `SSO_AND_IDENTITY.md` §9.3)_
- back-channel logout and `useSessionWatch`

The risky half of SSO stays where it is. What moves is the front door.

---

## 2. The one hard problem, and the fact that solves it

> "If the user is already logged in at `accounts.octfis.com`, then `www.octfis.com/jobwork`
> shows **Access Jobwork** instead of **Sign In**."

`www.octfis.com` is a public page. It has no session of its own, and accounts' `_session` cookie is
`HttpOnly` and host-scoped (`provider.ts:107`). So the website has to **ask** accounts whether a
session exists.

🔴 **`www.octfis.com` and `accounts.octfis.com` are different _origins_ but the same _site_.** They share
the registrable domain `octfis.com`. `SameSite` is a site-level rule, not an origin-level one, so a
credentialed `fetch()` between them carries the existing `SameSite=Lax` cookie, and Safari's and
Firefox's tracking protection do not treat it as third-party.

**Therefore the `_session` cookie stays `SameSite=Lax`.** This matters because the obvious "fix" when
a probe misbehaves is to relax it to `SameSite=None`:

| If someone relaxes it to `None` | Consequence                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Cross-site CSRF surface         | every SSO session in the estate is weakened, for every app, forever             |
| Safari / Firefox                | 🔴 **still blocked** — third-party cookie blocking is not a `SameSite` question |

So it buys nothing and costs the estate's central session. `provider.ts:107-108` is not to be
touched by this work.

---

## 3. `www.octfis.com/jobwork` — the website (external)

Owned by the website developer, not this repo. The site is **Zoho Sites 2.0**, and the page's one
call to action is a native Zoho Sites button (**Get Started Now**, `href="javascript:;"`,
`target="_blank"`). The contract is small enough to state fully:

| They add                  | What it is                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The button's link         | `https://jobwork.octfis.com/api/auth/sso/login` — **no query string**, label **Sign In**, **new tab off**             |
| ~15 lines of page JS      | `fetch` our status endpoint, swap the label to `Access Jobwork` when it answers `signedIn`                            |
| One CSS rule              | `min-width` on the button so the label swap does not shift the layout                                                 |
| Publish the page publicly | lift the IP restriction — §5.2's bounce and §5.6's post-logout land here, so a restricted page is a dead end for both |

_As published on `/jobwork` (checked 2026-09-26), the developer used a plain anchor,
`id="octfis-jobwork-cta"`, and the script sets its `textContent` — no new tab, no query string.
That meets the contract; the two notes below applied to the native-button version handed over._

Two Zoho Sites specifics decide how the script is written:

- **It finds the button by its `href`**, `a[href^="https://jobwork.octfis.com/api/auth/sso/login"]`.
  A native Zoho Sites button cannot carry a `data-` attribute, and selecting by the link means the
  developer sets one URL in the editor and adds no embed element.
- **It rewrites `.zpbutton-content`, not the anchor's `textContent`.** The label sits in that inner
  span; replacing the anchor's text wipes the span and Zoho's button styling with it.

The site sends **no Content-Security-Policy** and already runs inline scripts, so page-level custom
code can call `accounts.octfis.com` without any change on their side.

**Handed over as a standalone page:** <https://claude.ai/artifact/JE5FkNwuyYNMAFeLYiHnWS> (version 2,
2026-09-21 — Zoho Sites specifics and the `www.octfis.com/jobwork` address)

### Two properties that make this safe to hand to someone else

🔴 **The label is cosmetic — both labels use the same URL.** The probe is allowed to fail, be
blocked, or be stale; the button still works. Nothing about correctness depends on the website
getting it right, which is what makes it safe to have this code live outside our review.

🔴 **The link carries no `returnTo`.** Where someone lands inside jobwork is our decision and it will
change (§5.1). Putting `returnTo=/home` in their markup would mean either shipping them a URL that is
wrong until we deploy, or going back to ask them to edit it later. With no query string,
`landingPathFor(undefined)` returns `/` (`sso.service.ts:213`) — correct today, and correct after §5.1
points `/` at `/home`.

### What the website is not

- **Not an OIDC client.** Never register it in `oidc_clients`. It never needs a code, a token, or an
  identity, and registering it would put identity plumbing on a public marketing origin for no gain.
- **Not told anything about entitlement.** `signedIn: true` means "has an accounts session", never
  "has jobwork". Since 2026-09-22 jobwork is self-signup, so a visitor with no organization lands
  on "Create organization"; only a disabled account is refused, and that is §5.4's job.

---

## 4. `accounts.octfis.com` — the identity provider

Four changes. The first is the only new surface.

### 4.1 New: `GET /session/status`

```jsonc
{ "signedIn": true }
```

**Implementation:** unseal the signed `_session` cookie with `COOKIE_SECRETS` via Keygrip (the
library sets `signed: true`, `provider.ts:107`), then resolve it against `oidc_payloads` where
`type='Session'` — the adapter's composite key is `(type, id)` and it enforces expiry on read
(`adapter.ts:47-53`), so the same rule applies here. Also check `sso_sessions.revoked_at IS NULL`.

🔴 **A boolean and nothing else.** No email, no name, no avatar, no list of apps. Same reasoning as
`GET /api/auth/config` returning only `ssoEnabled` (`SSO_WALKTHROUGH.md` step 0): this is
unauthenticated surface reachable from a public page, and the estate's shape is not public.
**Decided 2026-09-26 that it stays this way** (§9): "signed in as james@…" would turn it into
identity disclosure, and is not to be added.

### 4.2 The `No CORS, deliberately` rule gains its first exception

`accounts/src/app.ts:13-21` currently states that nothing legitimate makes a cross-origin XHR here.
That stops being true. The exception must be narrow and the comment must be amended rather than
silently contradicted:

- exact-origin allowlist (`https://www.octfis.com`), **never** a wildcard, never reflected from the
  request. 🔴 `www` is part of the origin: allowlisting `https://octfis.com` blocks every probe, and
  the website's `.catch()` turns that into a button that silently never says **Access Jobwork**
- `Access-Control-Allow-Credentials: true` on **this route only**
- `Vary: Origin`, `Cache-Control: no-store`
- `GET` only, no preflight-triggering headers

### 4.3 Repoint the root

`app.ts:146` sends `accounts.octfis.com/` → `env.defaultAppSigninUrl` → jobwork's
`/api/auth/sso/login`. With a product directory in the estate, jumping into one arbitrary app is
wrong; it should land on the site's home, `https://www.octfis.com` (bare `octfis.com` does not
serve the site).

Rename `DEFAULT_APP_SIGNIN_URL` (`config/env.ts:67`) — the name becomes a lie the moment the target
is not an app's sign-in URL. The zod refinements (absolute URL, https-except-localhost) stay.

⚠️ This changes documented behaviour in `SSO_WALKTHROUGH.md` §6.1b, which said a bare visit to
accounts signs you into jobwork. It will not any more.

🔄 **Superseded 2026-09-21, same day.** Redirecting `/` to the website was deployed, then replaced
at the user's request by a **login form + My Account page** at `accounts.octfis.com`, like
`accounts.zoho.com`: accounts is its own `accounts-portal` client (`oidc/portal.ts`), and the
variable became `PRODUCT_SITE_URL` (the website link on the account page). See
`SSO_WALKTHROUGH.md` §6.1b.

### 4.4 `loadExistingGrant` — strongly recommended, not optional in practice

`provider.ts` has no `loadExistingGrant` override, so consent always costs an interaction hop
(`interaction/routes.ts` → `approveConsent`). That means `prompt=none` (§5.2) returns
`consent_required` for anyone signing into jobwork for the **first time**, and again after the
Grant's 14-day expiry.

Every client here is first-party and consent is already auto-approved, so auto-issuing the grant in
`loadExistingGrant` is consistent with the decision already made — and it is what makes silent auth
actually silent. Without it, the flow in §6 row 3 falls to row 4 on a user's first visit.

🔴 This is ~35 lines that change **when consent is granted**. It fails toward granting, not refusing.
Review it by reading, not by line count.

### 4.5 Register the new post-logout URI

Add `https://www.octfis.com/jobwork` to the `jobwork-production` client's `post_logout_uris`,
exact string (`clients.ts:79-80` — matched exactly, never as a pattern; no trailing slash, since
that is a different string).

🔴 `clientOrigins()` (`clients.ts:40`) folds `postLogoutUris` into the CSP `form-action` list, and the
registry is **read once at boot** (`app.ts:43`). Add the URI without restarting accounts and the
sign-out form submission is blocked by CSP — which presents as _"the sign-out button does nothing"_
and is diagnosed nowhere near its cause. Same class of bug as the `form-action` note in `app.ts:67-89`.

---

## 5. `jobwork.octfis.com` — the app

The bulk of the work, and all of the fiddly parts.

### 5.1 `/home` does not exist

`router.tsx:254` maps `/` to `OrgRedirect`, which reads `lastOrgId` from `localStorage` and lands on
`/organizations/:orgId`. `/home` today falls through the catch-all (`router.tsx:392`) back to `/`.

🔴 **Make `/home` _be_ `OrgRedirect`, not a new static dashboard.** `landingPathFor` was rewritten
twice on 2026-08-31 (`SSO_WALKTHROUGH.md` step 10) precisely because a server-side landing ladder
produced **two different homes for the same account** — one for jobwork's own button, another for an
arrival with no `returnTo`. If `/home` is the redirector, `returnTo=/home` and `returnTo=/` mean the
same thing and that decision survives intact. Keep `/` redirecting to `/home` for existing bookmarks.

### 5.2 Direct hit while unauthenticated → silent SSO, then bounce

`ProtectedRoute.tsx:21-24` currently renders `<Navigate to="/login">`. New behaviour when SSO is on:

```
jobwork.octfis.com  →  no local session
   →  /api/auth/sso/login?prompt=none&returnTo=/home
      ├─ accounts has a session → code → local session → /home        (no UI at all)
      └─ no session → ?error=login_required → 302 https://www.octfis.com/jobwork
```

**Why `prompt=none` and not the §4.1 probe.** This is a top-level navigation, so the `Lax` cookie is
sent, there is no CORS and no third-party-cookie question — and it does not merely _report_ that the
person is signed in, it signs them in. The probe answers a label; this answers a session.

Two changes in `sso.controller.ts` make it work:

| Change                                                           | Why                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `callback` branches on `req.query.error` **before** the exchange | `login_required` / `interaction_required` / `consent_required` are normal answers here. Today they would throw and surface as a 400 page |
| A one-shot loop guard — short-lived cookie, or `?silent=1`       | 🔴 website → app → website → app is a real ping-pong risk, and the kind of bug that only appears in production                           |

### 5.3 🔴 The invitation deep link must be carved out of the bounce

Invite emails link to `/invite/accept?token=…`. An invitee has **no accounts identity yet**, so
`prompt=none` always fails for them — and bouncing them to `www.octfis.com/jobwork` **throws their
invitation token away**. The flow in `SSO_WALKTHROUGH.md` §6.2 breaks silently.

**The rule:** silent-then-bounce applies only when there is no meaningful `returnTo`. A deep link does
a normal interactive SSO login carrying `returnTo` and `?email=` (`login_hint`), exactly as today
(`sso.controller.ts:83-91`).

### 5.4 Build `/no-access`

`SSO_WALKTHROUGH.md` step 10 records that `/no-access` was designed and never built, and that the one
case with no landing place died on the catch-all. That was tolerable while jobwork's own login screen
was the only door.

It stops being tolerable here: **Access Jobwork** is a button on a _public_ page that any signed-in
identity can see, so an unentitled visitor clicking it is an ordinary path, not an edge case.
`provisionOrRefuse`'s 403 needs somewhere real to land, with a sign-out link — otherwise silent auth
turns a 403 into a raw error or a loop.

_Since self-signup (2026-09-22) an unentitled visitor is no longer ordinary: a verified account with
no organization lands on "Create organization". `/no-access` now only serves an unverified email or
an account disabled in jobwork._

### 5.5 `/login` becomes a redirector

Keep the route (`router.tsx:242`) — the `SSO_ENABLED=false` rollback still needs the password form —
but with SSO on it does the silent attempt / bounce instead of rendering the `Access Jobwork` button
(`LoginPage.tsx:137-152`). The sign-in surface now lives on the website.

### 5.6 Two environment values

| Variable                       | Now                              | Becomes                                                     |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------- |
| `SSO_POST_LOGOUT_REDIRECT_URI` | jobwork's own `/` (`env.ts:139`) | `https://www.octfis.com/jobwork`                            |
| _new_ — the website URL        | —                                | `https://www.octfis.com/jobwork` — where §5.2's bounce goes |

Same value twice, on purpose: one is where accounts sends the browser after logout (and must equal
the §4.5 registry entry), the other is where jobwork itself sends an unauthenticated visitor. They
only coincide today; keep them as two variables.

After logout the accounts session is gone, so the website correctly shows **Sign In**. Pointing it at
jobwork's root instead would only bounce through §5.2 to the same place.

### 5.7 `X-Robots-Tag: noindex`

On the whole app, and on all of accounts (only its root sets it today, `app.ts:147`). Otherwise Google
surfaces the app's login screen for "octfis jobwork" — which is exactly the search result
`www.octfis.com/jobwork` exists to own.

---

## 6. The four flows

| Visitor                                                 | What happens                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Google → `www.octfis.com/jobwork`, not signed in        | Probe says `false` → **Sign In**. Click → accounts login form → callback → `/home`                        |
| `www.octfis.com/jobwork`, already signed in at accounts | Probe says `true` → **Access Jobwork**. Click → accounts answers silently → callback → `/home`. No screen |
| Direct `jobwork.octfis.com`, signed in at accounts      | No local session → `prompt=none` → code → `/home`. **Needs §4.4**, or the first-ever visit falls to row 4 |
| Direct `jobwork.octfis.com`, not signed in              | `prompt=none` → `login_required` → 302 `https://www.octfis.com/jobwork`                                   |

---

## 7. Traps

Collected because each one fails in a way that points somewhere other than its cause.

| Trap                                                      | How it presents                                                            | §    |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| Relaxing `_session` to `SameSite=None` to "fix" the probe | Nothing improves — Safari still blocks — and every session is weaker       | §2   |
| Post-logout URI added without restarting accounts         | "Sign out does nothing" — CSP blocks the form, nowhere near the registry   | §4.5 |
| No `loadExistingGrant`                                    | Silent auth works for everyone except first-time users. Looks intermittent | §4.4 |
| No loop guard on `prompt=none`                            | Website ↔ app ping-pong, production only                                   | §5.2 |
| Invitation deep link sent through the bounce              | Invitee loses their token and can never accept. Silent                     | §5.3 |
| `/no-access` still unbuilt                                | A successful sign-in ends on the catch-all, reading as sign-in failure     | §5.4 |
| Probe called server-side by the website                   | Always `signedIn: false`, for everyone, with no error                      | §3   |
| CORS allowlist says `https://octfis.com` (no `www`)       | Label never flips, anywhere. The probe fails into `.catch()` silently      | §4.2 |
| Website page renamed away from `/jobwork`                 | Sign-out lands on a 404, or accounts refuses the post-logout URI           | top  |
| Website page still IP-restricted when §5.2 ships          | Every signed-out visitor is bounced to "Access Restricted"                 | top  |
| Website button published before an SSO build is deployed  | The button 404s — a deploy of a branch without SSO code would do this      | top  |

---

## 8. Build order

Each step is independently deployable and leaves the estate working.

0. **Deploy an SSO build of jobwork to production again** — the website's link 404s until this is
   done. The website may add the button and script at any time, but must not **publish** the page
   until this step is confirmed live.
1. **`/session/status` on accounts** (§4.1, §4.2) — nothing depends on it; the website's `.catch()`
   already treats its absence as "not signed in". Ship first so the website team can verify.
2. **`loadExistingGrant`** (§4.4) — must precede §5.2, or silent auth looks broken for first-time users.
3. **`/home`, `/no-access`, `/` → `/home`** (§5.1, §5.4) — routes, plus the callback's refusal
   (a 403 from `linkOrCreateLocalUser`) redirecting to `/no-access` instead of showing the JSON
   envelope. ✅ Built 2026-09-21 (`redirectFailedSignIn` in `sso.controller.ts`), not deployed.
   Since 2026-09-22 every other callback failure (expired flow cookie, failed code exchange) also
   redirects, to `/login?sso=manual&error=signin_failed`, instead of showing a raw JSON 500.
4. **`prompt=none` + error branch + loop guard + invite carve-out** (§5.2, §5.3, §5.5) — the change
   that alters what an unauthenticated visitor sees. One deploy, tested across real hostnames.
   ✅ Built 2026-09-21, not deployed. As built:
   - `/login` (SSO on) is a redirector: `/` or `/home` → silent (`?prompt=none&returnTo=/home`);
     any deep link or `?email=` → interactive `startSsoLogin`, so an invitation is never bounced.
     It shows the button only for `?sso=manual` or after `useSessionWatch` signs the tab out.
   - `callback` answers ANY `?error=` on a silent flow whose `state` matches with a redirect to
     `SSO_WEBSITE_URL` — or `/login?sso=manual` while that is unset, which is local dev today.
   - Loop guard: an `sso_silent` cookie (30 s, not cleared on success) makes a second silent
     attempt go to `/login?sso=manual` instead.
   - Verified locally against real accounts: `prompt=none` with no session → `login_required` →
     `/login?sso=manual`, and the guard refuses a second attempt. The signed-in success path and
     the website bounce need the real hostnames.
     The bounce lands on `www.octfis.com/jobwork`, public since 2026-09-26 — see step 5 B.
5. **Repoint the roots** (§4.3, §4.5, §5.6, §5.7) — config and registry. Same blocker as step 4 for
   the post-logout half. Code built 2026-09-21, in two phases so nothing waits on the website:
   - **A — safe now.** `DEFAULT_APP_SIGNIN_URL` renamed to `ROOT_REDIRECT_URL` (accounts `/` →
     `https://www.octfis.com`, the public home page; `deploy/services.json` requires the new name);
     `X-Robots-Tag: noindex, nofollow` on every response of both services. Registry: added the
     website URL of the day (`https://www.octfis.com/job-work-1`) to `jobwork-production`'s
     post-logout URIs, KEEPING `https://jobwork.octfis.com/` so either value of the jobwork
     variable works and rollback needs no registry change.
   - **B — ✅ deployed 2026-09-26.** The page moved to `/jobwork`, so the registry row changed
     first. `register:client` REPLACES the whole list, so name every URI to keep:
     `npm run register:client -- --id jobwork-production --name Jobwork --redirect https://jobwork.octfis.com/api/auth/sso/callback --post-logout https://jobwork.octfis.com/ --post-logout https://www.octfis.com/jobwork --backchannel https://jobwork.octfis.com/api/auth/sso/backchannel-logout --apply`
     then deploy accounts (the registry is read at boot — the api must not go first, or every
     logout ends on accounts' "post_logout_redirect_uri not registered" page). Then in
     `backend/.env.production` set `SSO_POST_LOGOUT_REDIRECT_URI` and `SSO_WEBSITE_URL` to
     `https://www.octfis.com/jobwork` and deploy the api.

⚠️ **Step 4 cannot be fully verified on localhost.** `SSO_AND_IDENTITY.md` §10.3 already records that
`oidc-provider` refuses to POST logout tokens to `127.0.0.0/8`; the three-host cookie and CSP
behaviour here has the same shape. Budget a deploy–test–fix cycle, and note that staging accounts has
**never been deployed** (`octfis-accounts-staging` does not exist) — that is a prerequisite sitting in
front of this, not part of it.

---

## 9. Open decisions

1. ~~**`/home`**~~ — decided 2026-09-21: `/home` renders `OrgRedirect`, and `/` forwards to it
   (§5.1). Not a new landing page.
2. ~~**`loadExistingGrant`**~~ — decided 2026-09-21: first-party auto-grant, built in
   `oidc/firstPartyGrant.ts` (§4.4).
3. ~~**`/no-access` copy**~~ — decided 2026-09-22, with self-signup: title _"No access to
   Jobwork"_, _"This account can't use Jobwork right now. It may have been disabled by your
   organization's administrator — ask them to restore it."_, _"Or sign out and sign in with a
   different account."_, and one button, _"Sign out and use another account"_. The "ask to be
   invited" wording went with invite-only.
4. ~~**The status endpoint's answer**~~ — decided 2026-09-26: **boolean only, permanently**
   (`{ "signedIn": boolean }`, §4.1). No email, name or app list, now or later.

_Decided:_ **the website URL** — `https://www.octfis.com/jobwork` (2026-09-26, replacing
`/job-work-1` from 2026-09-21). Any later rename is a coordinated change: §4.5's registry entry, both §5.6 variables,
and the website in one release.

---

## 10. Documents this will invalidate

🔴 **Edit these _after_ the code lands, not before.** Listed here so nothing is missed, not as work to
do now.

| Doc                   | Section               | Why it changes                                                         |
| --------------------- | --------------------- | ---------------------------------------------------------------------- |
| `SSO_WALKTHROUGH.md`  | §6.1b                 | A bare visit to accounts goes to the website, not into jobwork         |
| `SSO_WALKTHROUGH.md`  | steps 0–1, §6.2       | Sign-in starts on `octfis.com`, not jobwork's `/login`                 |
| `SSO_WALKTHROUGH.md`  | step 10               | `landingPathFor` gains the silent-auth and no-access branches          |
| `SSO_WALKTHROUGH.md`  | §6.3                  | Post-logout lands on the website                                       |
| `SSO_AND_IDENTITY.md` | header table, §11     | The cross-tab check listed ❌ is partly what `/session/status` becomes |
| `accounts/src/app.ts` | the `No CORS` comment | One documented exception now exists                                    |
| `CLAUDE.md`           | deploy section        | Only if the website becomes a target in this repo (§9 is silent on it) |
