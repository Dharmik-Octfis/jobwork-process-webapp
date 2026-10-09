# Invitation sign-in: create-account for new people, sign-in for existing ones

> **Purpose.** An invitation link should open **Create Account** with the invited address locked when
> that address has no Octfis account, and **Sign In** with the address prefilled when it does. Today
> every invitee lands on Sign In with an editable address, whatever their state. This is the plan:
> what changes on each service, why the obvious implementation is wrong, the traps, and the build order.
>
> Builds on `docs/SSO_AND_IDENTITY.md` and `docs/SSO_WEBSITE_ENTRY_PLAN.md` §5.3. **Neither is
> superseded.** This changes which screen accounts shows at one step of one flow, and how jobwork
> vouches for the address it hands over.

_Status: **built 2026-10-09 on `feat/singleSignOn`, uncommitted; not deployed.** §8 steps 1–2 are
code-complete and tested (accounts `invitee.flow.test.ts` drives a real `oidc-provider` with PAR;
jobwork `sso.silent.test.ts`, `invitations.sso.test.ts`). Not yet done: the accounts migration
`20261009064336_add_oidc_client_require_par` was **applied to `accounts_dev` on 2026-10-09**. That
database holds all three registrations (`jobwork`, `jobwork-staging`, `jobwork-production`), all
still `require_par = false` (§8 step 3), and nothing is browser-walked. The §10 docs were updated
2026-10-09 to describe the built behaviour, each noting it is live only once deployed._

_Implementation notes that differ from the text below:_

- _The flag is set with `npm run client:require-par -- --id <client> [--off] --apply`, which changes
  that one column and nothing else, not a migration. Registry rows are data written by scripts,
  never by migrations. `register:client` also accepts `--require-par` / `--no-require-par`, but it
  rewrites the whole row._
- _Deploy order changed: jobwork goes FIRST (§8). Production accounts already advertises
  `pushed_authorization_request_endpoint` (checked 2026-10-09), so PAR works against it today._
- _"Stay signed in as X" finishes the interaction with a marker (`inviteeMismatchStay`), not a login
  result, so it does not restamp X's authentication time._
- _A locked Sign In has no "Create Account" link, and `GET /interaction/:uid/signup` for an address
  that already has an account redirects to the locked Sign In. Signing up again would replace that
  account's password._
- _Async `Check`s are supported by `oidc-provider` 9.11 (its own `id_token_hint` check is async), and
  the switch path through the library's end-session step is covered by the flow test._
- _`/api/auth/sso/login` now has the same route-level error handler as `/callback`, so a PAR failure
  lands on `/login?sso=manual&error=signin_failed` rather than JSON._

---

## 1. What happens today

```
email link  /invite/accept?token=T
  → AcceptInvitePage.tsx:226   SSO on → always <Navigate to="/login?email=E&next=…">
  → LoginPage.tsx:90           startSsoLogin(next, E)
  → sso.controller.ts:134-142  GET /api/auth/sso/login?email=E → login_hint=E on /authorize
  → interaction/routes.ts:57   accounts ALWAYS renders loginPage, email editable
       └ "Create Account" → /interaction/:uid/signup, email prefilled from login_hint, editable
```

So an invitee can register **any** address. Registering a different one signs them in as an
identity the invitation can't be accepted by, and they end on the "Different account" screen
(`AcceptInvitePage.tsx:173`). The code comments at `sso.controller.ts:123-127` already name this as
the thing to prevent. No doc ever recorded a "locked email" decision. `SSO_GUIDE_NEW_APP.md:397` and
`SSO_GUIDE_ACCOUNTS.md:68` only say "prefilled".

## 2. Target behaviour

The decision is made by **accounts**, on its own `users` table, and **only** for an address jobwork
has vouched for (§3).

| Address state in accounts `users`                              | Screen                        | Email field                |
| -------------------------------------------------------------- | ----------------------------- | -------------------------- |
| no row                                                         | **Create Account**            | read-only, server-enforced |
| row with **no** `password_hash` (a signup never confirmed)     | **Create Account**            | read-only, server-enforced |
| row **with** `password_hash`: verified, unverified or disabled | **Sign In**                   | read-only                  |
| hint **not** vouched (any other request)                       | **Sign In**, exactly as today | editable, exactly as today |

- **Which organization sent the invite doesn't matter.** Octfis accounts are global. "Already has an
  account" means a row in accounts, not in jobwork.
- A **disabled** account gets Sign In, not Create Account. Its sign-in then fails with the usual
  generic message, so being disabled is never revealed. Showing signup would also fail
  (`verifyEmail` filters `ACTIVE_USER`), just more confusingly.
- An **unverified account with a password** gets Sign In, which already routes into the code step
  (`routes.ts:134`).
- Both screens carry one escape link, **"Not you? Use a different account"**. It leads to the plain
  Sign In form with an editable address. Signing in as someone else still ends on jobwork's
  "Different account" screen. That is correct, because the invitation belongs to one address.

## 3. 🔴 The one hard problem: this screen choice must not reveal who has an account

Accounts is built so nobody can find out from outside whether an address is registered. The login
error is deliberately vague (`routes.ts:112`). Signup answers new and existing addresses identically,
in the same time (`account.service.ts:170`). Branching on `login_hint` would undo both, because
`login_hint` is just a URL parameter. Anyone could open `/authorize?client_id=jobwork&login_hint=ceo@acme.com`
and tell from which page appears whether that person has an account.

Big providers solve this by making **the invitation the credential**. The screen choice is shown only
to someone holding a valid invitation for that exact address, which in practice is the inbox owner.

🔴 **The invitation token is what protects the address, not PAR.** PAR by itself prevents nothing:
if jobwork pushed whatever email a browser supplied, the leak would be exactly as open as with a
bare `login_hint`. There are two parts, with different jobs:

| Part                          | Its job                                                                                                   | Prevents enumeration on its own?                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Invitation check** (step 1) | decide **which** address may get a screen choice: only one with a valid invitation, looked up server-side | yes, but only if accounts can be sure step 1 happened |
| **PAR** (step 2)              | **carry** jobwork's "I checked the invitation" to accounts in a form a stranger can't forge               | no; it only transports                                |

In plain terms: today the hint travels through the browser's address bar, so accounts can't tell
whether jobwork wrote it or a stranger typed it. With PAR, jobwork hands the hint to accounts
directly, server to server, logged in with its client secret. The browser only carries a one-time
reference to it. A hint can only reach accounts that way if jobwork sent it, so accounts can trust it.

Both steps are required:

1. **Jobwork sets `login_hint` only from a valid invitation looked up server-side.** It never copies
   it from the query string. `/api/auth/sso/login?email=` is removed. The browser sends `?invite=<token>`;
   the backend resolves it (pending, unexpired) and uses the email **from the database**. Without
   this, jobwork's own endpoint becomes the leak: anyone could call it with any email.
   - The invite link is only ever emailed to the invitee (`invitations.service.ts:342-350`); it is
     never returned to the inviter. So an admin can't invite strangers in order to probe them.
     **Keep it that way.** An API that returns the link to the inviter would reopen the leak.
2. **Accounts trusts the hint only when it reached it server-to-server, authenticated as the client.**
   That is Pushed Authorization Requests (PAR, RFC 9126): jobwork POSTs the authorization parameters
   to accounts' `/request` endpoint with its client secret and gets back a `request_uri`. Only that
   reference travels through the browser.
   - Checked in `node_modules`: `oidc-provider` 9.x has PAR **enabled by default**
     (`defaults.js:1806`) and supports the per-client `require_pushed_authorization_requests`
     metadata. `openid-client` 6.x has `buildAuthorizationUrlWithPAR`.
   - With that flag on jobwork's client, **every** jobwork authorization request was pushed by
     jobwork, so a `login_hint` on one is vouched for. A hand-built `/authorize?login_hint=…` for
     jobwork's client is rejected by the library before any page renders.
   - The rule in accounts is therefore: **branch only if the client requires PAR**. It doesn't rely
     on any per-request library internals, and the portal client (`oidc/portal.ts`) stays exactly as
     it is today.

**PAR is the chosen carrier, not the only possible one.** C, D and E below are also safe, because
each still ties the hint to the invitation. PAR was picked because it is the least new code:

- one function-call change in jobwork;
- one registry flag in accounts;
- no new secret, and no new API.

**Alternatives:**

| Alternative                                                               | Why not                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobwork decides, using its `accountExists` (`invitations.service.ts:480`) | That checks **jobwork's** `users`, which only gets a row after a first jobwork sign-in. A person with an Octfis account from another app would be shown signup, and signing up on an existing address **replaces that account's password** (`account.service.ts:170-174`). The invitee would believe they were creating a jobwork account.                      |
| Jobwork asks accounts "does E exist?" over a server-to-server API         | Same leak, now an API. It also adds a second round trip and a second contract to keep working.                                                                                                                                                                                                                                                                  |
| Accounts branches on a bare `login_hint` (with or without rate limiting)  | §3 above: anyone can probe arbitrary addresses. Rate limiting slows that down; it doesn't stop it.                                                                                                                                                                                                                                                              |
| **C.** A signed `{email, expiry}` hint in the URL                         | **Safe, not chosen.** Needs a **new** shared secret in both services and both environments, kept in sync and rotated. Jobwork's client secret can't be reused for signing: accounts stores only its argon2 hash (`clients.ts:13`), and a signature can't be checked against a hash. The same rules out JAR (RFC 9101, signed request objects) with that secret. |
| **D.** Accounts asks jobwork whether the invite token is valid            | **Safe, not chosen.** A new jobwork API, and accounts would start depending on jobwork, the reverse of today's direction.                                                                                                                                                                                                                                       |
| **E.** Email a code first, then choose the screen                         | **Safe, not chosen.** No PAR, no secret, no API: accounts sends a 6-digit code to the hinted address and picks the screen only after it's entered, so only the inbox owner ever sees the result. Costs one extra email step for every invitee, including people who already have an account.                                                                    |
| `prompt=create` (OIDC "Initiating User Registration")                     | It's the standard way for the **app** to ask for the signup screen, but the app doesn't know whether an account exists, so it can't send it correctly. `oidc-provider` also doesn't support that prompt value out of the box. It is not needed: accounts makes the decision.                                                                                    |

## 4. `accounts.octfis.com`: the identity provider

### 4.1 Registry: a per-client "require PAR" flag

- **Migration:** `oidc_clients.require_par BOOLEAN NOT NULL DEFAULT false`. It defaults off, so
  nothing changes on deploy.
- **`oidc/clients.ts` `loadClients`:** map it to `require_pushed_authorization_requests`.
- The registry loads at boot (`clients.ts:7-11`), so flipping the flag needs an accounts restart.

### 4.2 `GET /interaction/:uid`: choose the screen

At `routes.ts:57`, when `prompt.name === 'login'`:

```ts
const vouched = clientRequiresPar(clientId) && typeof params['login_hint'] === 'string';
if (vouched) {
  const row = await prisma.user.findUnique({
    where: { email: hint },
    select: { passwordHash: true },
  });
  if (!row?.passwordHash) return res.send(signupPage({ email: hint, emailLocked: true, ...links }));
  return res.send(loginPage({ uid, clientName, email: hint, emailLocked: true }));
}
// not vouched: today's loginPage, unchanged
```

- `clientRequiresPar` reads the loaded client metadata, not a second database query.
- **Timing:** the two branches don't need the dummy-hash equalisation `verifyCredentials` uses.
  Whoever sees this page already holds an invitation for the address (§3).

### 4.3 🔴 The lock is enforced on the server; the read-only field is only display

- **`POST /interaction/:uid/signup`** (`routes.ts:182`): when the interaction is vouched, **overwrite**
  `parsed.data.email` with the interaction's `login_hint` before calling `service.signup`. A
  tampered form then registers the invited address or nothing.
- **`POST /interaction/:uid/login`**: same rule, use the hint. The only thing it prevents is a
  confusing mismatch screen, but it keeps the two forms consistent.
- **`POST /interaction/:uid/verify`**: already safe. The code is consumed by email plus browser
  binding, so a swapped email just fails. Still, take the email from the hint so a tampered form
  can't produce a misleading error.
- **The field is `readonly`, never `disabled`.** Browsers don't submit a `disabled` field, and the POST
  handlers read `email` from the form body. Disabled would make every invite signup fail validation.

### 4.4 Views

- `signupPage` (`account.views.ts:32`) and `loginPage` (`views.ts:311`) take an `emailLocked` option:
  - add `readonly` and `aria-readonly="true"` to the input;
  - give the field a muted style so it doesn't look editable;
  - show the "Not you? Use a different account" link.
- **Where the escape link leads.** It goes to `/interaction/:uid?switch=1`, which renders today's
  unlocked `loginPage`. A reload keeps the query parameter, so the field doesn't re-lock. Unlocking
  shows nothing a stranger couldn't already see (decision 9.3).
- **Signup copy when locked:** subtitle "Create your Octfis account to join" in place of "One account
  for every Octfis app". The organization name isn't available at accounts and must not travel in
  the request (§1 of `SSO_AND_IDENTITY.md`: identity only).

### 4.5 Signed in as the wrong address: "You're signed in as X; this invite is for Y" (decided 2026-10-09)

Today a browser already signed in to accounts as X gets X back with no screen at all. Under this
change, a vouched hint that doesn't match the session forces a screen:

- **Policy:** add a `Check` to the `login` prompt in `interactions.policy`. It fires when the hint is
  vouched (§4.2) and the session account's email ≠ `login_hint` (case-insensitive). The library then
  sends the browser to `/interaction/:uid` with `prompt.reasons` containing that check's name. Not
  yet verified: whether a `Check` callback may be async (it needs one account lookup). Prove it in
  the first test before building the screen on it.
- **Screen** (`/interaction/:uid` when the reason is present):
  - title "This invitation is for Y", body "You're signed in as X".
  - **Switch to Y** (primary): continue to §4.2's choice for Y, locked Sign In or locked Create
    Account.
  - **Stay signed in as X** (secondary): finish the interaction as X. Jobwork then shows its
    "Different account" screen. This is the honest outcome: an invitation can't be accepted by
    another address.
- 🔴 **Switching signs X out of every Octfis app in this browser.** That's the library, not a
  choice: `resume.js:47-69` sees a login result for a different account than the session holds and
  runs the end-session flow first. That flow includes back-channel logout to every app X is signed
  in to. The Switch button must say so ("This signs you out as X"). Also check in a test that our
  self-submitting `signingOutPage` (`provider.ts:142`) doesn't strand the browser between the
  logout and the resumed sign-in.
- **Jobwork has to route mismatches here, or this screen is almost never reached.** The common case
  is someone already signed in to **jobwork** as X opening Y's invite. That's Case A in
  `AcceptInvitePage.tsx:164`, which never contacts accounts. Its SSO branch changes from **Sign out**
  (which leaves the app and loses the token) to **Switch account**:
  1. end the local jobwork session only (`POST /auth/logout`, no redirect to accounts);
  2. `startSsoLogin('/invite/accept?token=…', token)`.

  Accounts then shows this screen with the token still in hand. The copy names both addresses.

## 5. `jobwork.octfis.com`: the app

### 5.1 Backend: `GET /api/auth/sso/login`

- **Remove** the `email` query parameter (`sso.controller.ts:134-138`).
- **Add** `invite=<raw token>`. Resolve it with the same `tokenHash` lookup `lookupInvitation` uses
  (`invitations.service.ts:433`). Only a pending, unexpired invitation sets `login_hint`. A bad,
  expired, accepted, revoked or declined token sets no hint, and sign-in carries on normally. The
  accept page already shows the right state for those, so this endpoint stays quiet.
- **Switch to PAR for every sign-in**, silent ones included:
  `client.buildAuthorizationUrlWithPAR(config, params)`. Required, not optional: once accounts
  requires PAR for jobwork, a plain `/authorize` from jobwork is refused.
- **Cost:** one server-to-server POST to accounts per sign-in. Sign-ins only, not per request, so
  §3's "accounts is off the request path" still holds.
- **New failure mode:** if accounts is unreachable, the error now happens in jobwork's endpoint and
  not at accounts. It must redirect to `/login?error=signin_failed`, never a raw 500.

### 5.2 Frontend

- `AcceptInvitePage.tsx:142`: `loginPath` carries `invite=<token>` instead of `email=`.
- `LoginPage.tsx:38,89-90`: read `invite`, pass it to `startSsoLogin`. A visitor with an invite is
  never silent, same rule as `invitedEmail` today.
- `useAuthConfig.ts:66`: `startSsoLogin(returnTo, invite)` sets `invite`, not `email`. Update its
  comment (`:59-64`), which describes an editable default.
- **SSO off is unchanged.** `/login?email=` and the password form keep working for the rollback
  path, and `accountExists` keeps meaning what it means there.

## 6. Flows after the change

| Invitee                                                    | Sees                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No Octfis account                                          | Create Account, address locked → 6-digit code → back in jobwork as Case A → joins automatically                                    |
| Octfis account (from jobwork or any other app), signed out | Sign In, address locked → back in jobwork → joins automatically                                                                    |
| Signed in at accounts **as the invited address**           | No screen at all; accounts answers at once → joins automatically                                                                   |
| Signed in at accounts **as a different address**           | "This invitation is for Y; you're signed in as X" → Switch (signs X out everywhere) → locked Sign In / Create Account for Y (§4.5) |
| Signed in to **jobwork** as a different address            | Jobwork's "Different account" → **Switch account** → local sign-out → accounts shows the §4.5 screen, token kept                   |
| Clicks "Not you?"                                          | Plain, editable Sign In → ends on "Different account" unless they use the invited address                                          |
| Expired / revoked / accepted link                          | Unchanged: accept page shows the state, sign-in never starts                                                                       |

## 7. Traps

- **Deploy order is load-bearing (§8).** Flip `require_par` before jobwork sends PAR and **every**
  jobwork sign-in fails, invitations or not.
- **`disabled` vs `readonly`** (§4.3): disabled looks right in a screenshot and breaks every submit.
- **Don't leave `?email=` working "for compatibility".** Any path that turns a browser-supplied
  address into a vouched hint is the leak §3 exists to close. Links already sent stay valid: they are
  `/invite/accept?token=`, and the accept page builds the new `?invite=` itself.
- **The token rides in a URL.** It already did, inside `next=`. This adds no new exposure, but don't
  log `req.query` on the sso route.
- **`interaction/:uid` reload after "Not you?"** must not re-lock (§4.4).
- **Switching account ends X's sessions in every app** (§4.5). Say so on the button. Don't let it
  surprise anyone.
- **Test-suite hygiene:** accounts tests create their own users and hard-delete them. Never mutate a
  user a test merely found (CLAUDE.md, Tests).

## 8. Build order

Each step is deployable alone and leaves sign-in working. Per environment (`staging` / `production`):

0. **Migration** `20261009064336_add_oidc_client_require_par`: done on `accounts_dev` 2026-10-09.
   That database serves every environment's accounts. The accounts already running doesn't read
   the column.
1. **`npm run deploy:<env>:api`:** the jobwork that sends `?invite=` and PAR. Works against the
   accounts already running (PAR is on by default there). Invitees still get today's editable
   Sign In, prefilled from the invitation.
2. **`npm run client:require-par -- --id jobwork-<env> --apply`:** writes the flag to the database.
   The accounts still running ignores it.
3. **`npm run deploy:<env>:accounts`:** the new accounts reads the registry at boot, sees the flag,
   and the locked screens go live. This deploy is the restart the flag needs.

🔴 Never step 2 before step 1 is live, if accounts is restarted in between. A flagged client whose
jobwork does not send PAR has every sign-in refused. To undo: `client:require-par … --off --apply`,
then restart accounts. 4. **Verify on staging, then production,** with three invitees: a fresh address, an address with an
Octfis account but no jobwork user, and an existing jobwork user. Also confirm that a hand-built
`/authorize?client_id=<jobwork>&login_hint=…` is refused. 5. **Docs** (§10), after the code lands.

**Tests:**

- **accounts** (`signup.flow.test.ts` style):
  - vouched with no row → signup, readonly;
  - vouched with no password → signup;
  - vouched with a password → login, readonly;
  - vouched and disabled → login;
  - not vouched → today's page, byte-for-byte;
  - a signup posted with a different email registers the hint;
  - "Not you?" survives a reload;
  - session X plus a vouched hint Y → the mismatch screen (§4.5); Switch → Y signed in, X's
    session ended; Stay → finishes as X;
  - session X plus a hint X → no screen.
- **web:** jobwork-session mismatch → Switch account keeps the invite token through to accounts.
- **jobwork** (`sso.test.ts`):
  - a valid invite → the PAR body carries `login_hint`;
  - an invalid, expired or accepted invite → no hint, sign-in still starts;
  - `?email=` is ignored;
  - PAR failure → `/login?error=signin_failed`.

## 9. Decisions (all settled 2026-10-09)

1. ✅ **Signed in as the wrong address: decided 2026-10-09.** Accounts shows "You're signed in as
   X; this invite is for Y" with a switch option. Design in §4.5, including the jobwork-side
   **Switch account** button without which the screen is rarely reached.
2. ✅ **Lock the Sign In email too: decided 2026-10-09, yes, lock both, each with "Not you?".**
   - The Sign In screen is shown precisely **because** Y has an account. Editing the address there
     only leads to signing in as someone the invitation can't be accepted by.
   - Locking both means one rule for both screens instead of two.
   - "Not you?" keeps the escape hatch. Slack and Microsoft invites behave this way.
3. ✅ **"Not you?" mechanics: decided 2026-10-09, a plain `?switch=1` on the interaction URL.**
   - Earlier draft: store the switch on the interaction with `interactionResult`. That's
     unnecessary: a query parameter survives a reload on its own.
   - Unlocking only shows today's ordinary sign-in form, so a hand-typed `?switch=1` reveals
     nothing.
   - The interaction, `next` and the invite all stay intact.
   - Restarting sign-in from jobwork was the other option and is rejected: it loses the return path.
4. ✅ **Other Octfis apps: decided 2026-10-09, the rule stays generic, and it is turned on for jobwork only.**
   - The rule in accounts is "client requires PAR", so it costs nothing extra to build.
   - But `require_par` stays `false` for every other client until that app has invitations of its
     own. A vouched hint means nothing without an invitation behind it.
   - Document the opt-in in `SSO_GUIDE_NEW_APP.md`, with the §3 rule that the hint must come from a
     server-side invitation lookup and never from the browser.

## 10. Documents this will invalidate (edit after the code lands)

| Doc                         | What changes                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `SSO_AND_IDENTITY.md`       | PAR on the jobwork client; the vouched-hint rule next to the enumeration rules    |
| `SSO_WALKTHROUGH.md`        | Step 2 becomes PAR + redirect; the invitation walkthrough shows the locked signup |
| `SSO_LOGIN_API_SEQUENCE.md` | `:351` `&email=` → `&invite=`; new PAR row before `/authorize`                    |
| `SSO_GUIDE_ACCOUNTS.md`     | `:68` signup row; `require_par` in the client registry section                    |
| `SSO_GUIDE_NEW_APP.md`      | `:397` invitation path; how an app opts into PAR                                  |
