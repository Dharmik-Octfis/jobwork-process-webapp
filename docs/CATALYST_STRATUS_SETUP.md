# Catalyst Stratus — bucket + OAuth setup

How to get file uploads working in an environment from nothing: create the bucket, create the
Self Client, pick the right scopes, exchange a grant token for a refresh token, and wire the
result into `backend/.env*`.

Do this **once per Zoho account**. Staging and production are different accounts in this project,
so each needs its own pass through this document. Nothing `ZC_*` carries across accounts.

**Related:** `docs/CATALYST_DEPLOYMENT_GUIDE.md` (deploying), `backend/src/lib/storage.ts` (the
only place the SDK is initialized), `backend/.env.production.example` (the annotated template).

---

## 🔴 Step 0 — find your data centre first

Everything below is DC-specific, and the failure mode when you get it wrong is
`{"error": "invalid_client"}` — which reads like a bad client id and sends you hunting in the
wrong place for an hour.

Your DC is whatever domain the Catalyst console loads on when you sign in:

| Console you see             | API Console            | Token endpoint      |
| --------------------------- | ---------------------- | ------------------- |
| `console.catalyst.zoho.com` | `api-console.zoho.com` | `accounts.zoho.com` |
| `console.catalyst.zoho.in`  | `api-console.zoho.in`  | `accounts.zoho.in`  |
| `console.catalyst.zoho.eu`  | `api-console.zoho.eu`  | `accounts.zoho.eu`  |

It is **per account**, not per project and not per repo. In this project:

| Target     | Account                  | DC    |
| ---------- | ------------------------ | ----- |
| staging    | `dharmik.m@octfis.com`   | `com` |
| production | `user1@demo14.octfis.in` | `in`  |

`deploy/targets.json` is the source of truth for that mapping — check there rather than guessing
from the email domain, which tells you nothing about the DC.

> Note: `backend/.env.production` contains a `ZC_DATA_CENTER` key. Nothing reads it — it is not in
> the `env.ts` schema, and Zod drops unknown keys. The DC lives in `deploy/targets.json` (`dc`) and
> in which `accounts.zoho.*` host you exchange against. Don't rely on the env key.

---

## Step 1 — create the bucket

Catalyst Console → your project → **Stratus** → **Create Bucket**.

- **Name** — lowercase, no spaces. This becomes `ZC_STRATUS_BUCKET` verbatim. This project uses
  `jobwork-uploads`.
- **Access** — keep it **private**. The app never hands out a raw bucket URL: it stores only the
  object key in Postgres and streams bytes through `GET /api/storage/stream?key=…`, or mints a
  short-lived signed URL via `getFileUrl()`. A public bucket would make every uploaded document
  world-readable by URL guess.
- **CORS** — not needed for the current code path, because uploads go through the API
  (`uploadFile()` server-side). You only need a CORS rule if you start using `createUploadUrl()`
  to let browsers `PUT` straight to Stratus.
- **Versioning / TTL** — optional. `uploadFile()` defaults `overwrite: false`, so a key collision
  errors rather than silently replacing.

The bucket belongs to the **project**, not to the person who made it. Every member of the Catalyst
org can see it, and it does not move when you switch which member's credentials the app uses.

You also need two ids from the console for the env file:

| Value            | Where                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `ZC_PROJECT_ID`  | Console → Settings → Project Settings → General                            |
| `ZC_PROJECT_KEY` | the ZAID — `.catalystrc` → `projects[].domain.id`. Not printed by the CLI. |

---

## Step 2 — create the Self Client

The bucket exists, but the app has no way to authenticate to it. That comes from an OAuth client,
which lives in a **different Zoho property**: the API Console, not the Catalyst Console.

Go to `api-console.zoho.<your-dc>` → **Add Client** → **Self Client**.

Signed in as the account that owns (or is a member of) the Catalyst org from Step 0. A Self Client
is the right type here because there is no browser redirect in this flow — the server authenticates
as itself, with no end user present.

Then open the **Client Secret** tab and copy:

- `Client ID` → `ZC_CLIENT_ID`
- `Client Secret` → `ZC_CLIENT_SECRET`

> 🔴 **Deleting a Self Client is permanent** (and Zoho generally allows only one per account, so
> you cannot keep a spare alongside it). There is no trash,
> no undo, and no support restore. A recreated Self Client gets a **new** id and secret, and every
> refresh token ever minted under the old one dies with it. If you delete it, you redo Steps 2–4
> and update every env file that referenced it.

---

## Step 3 — generate a grant token, with the right scopes

Still in the API Console, on your Self Client → **Generate Code** tab.

**Scope** — paste all of these, comma-separated, on one line:

```
ZohoCatalyst.buckets.READ,ZohoCatalyst.buckets.objects.CREATE,ZohoCatalyst.buckets.objects.READ,ZohoCatalyst.buckets.objects.UPDATE,ZohoCatalyst.buckets.objects.DELETE
```

If this environment might ever enable the L2 cache (`ZC_CACHE_SEGMENT_ID`), **append the
cache/segment scopes now**. `lib/catalystCache.ts` builds its SDK app from the same three
credentials as `lib/storage.ts`, so one token covers both — but:

> 🔴 **Scopes are fixed at generation time.** They cannot be added to an existing refresh token.
> A bucket-only token means redoing this entire flow the day you turn caching on.

**Time duration** — 10 minutes is plenty. **Scope Description** — anything.

Click Create and copy the code. It looks like `1000.<hex>.<hex>`.

> The grant token is **single-use and minutes-lived**. Have the cURL from Step 4 ready to paste
> before you click Create.

---

## Step 4 — exchange the grant token for a refresh token

This is the step that produces `ZC_REFRESH_TOKEN`. Self Client uses no `redirect_uri`.

**PowerShell** — note `curl.exe`, not `curl` (a bare `curl` is an alias for `Invoke-WebRequest` and
will not accept these flags):

```powershell
curl.exe -X POST "https://accounts.zoho.com/oauth/v2/token" `
  -d "grant_type=authorization_code" `
  -d "client_id=1000.XXXXXXXXXXXXXXXXXXXXXXXXX" `
  -d "client_secret=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY" `
  -d "code=1000.<grant-token-from-step-3>"
```

**bash / Git Bash:**

```bash
curl -X POST 'https://accounts.zoho.com/oauth/v2/token' \
  -d 'grant_type=authorization_code' \
  -d 'client_id=1000.XXXXXXXXXXXXXXXXXXXXXXXXX' \
  -d 'client_secret=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY' \
  -d 'code=1000.<grant-token-from-step-3>'
```

**Postman** — Import → Raw text → paste the single-line form:

```
curl -X POST "https://accounts.zoho.com/oauth/v2/token" -d "grant_type=authorization_code" -d "client_id=1000.XXX" -d "client_secret=YYY" -d "code=1000.ZZZ"
```

Swap `accounts.zoho.com` for your DC's host from Step 0.

A successful response:

```json
{
  "access_token": "1000.…",
  "refresh_token": "1000.…",
  "scope": "ZohoCatalyst.buckets.READ ZohoCatalyst.buckets.objects.CREATE …",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Check two things before moving on:

1. **`api_domain`** matches your DC (`zohoapis.com` vs `zohoapis.in`). If it doesn't, you exchanged
   against the wrong host and the token will not work against your project.
2. **`scope`** lists everything you asked for. This is your only chance to notice a missing scope
   before it costs you a re-run.

`refresh_token` is returned **only on this first exchange** and never again. Save it immediately.
It does not expire on a timer — it lives until the Self Client is deleted or the token revoked.

### Verifying a refresh token later

To check an existing triple without generating a new code:

```bash
curl -X POST 'https://accounts.zoho.com/oauth/v2/token' \
  -d 'grant_type=refresh_token' \
  -d 'client_id=1000.XXX' \
  -d 'client_secret=YYY' \
  -d 'refresh_token=1000.ZZZ'
```

An `access_token` back means the triple is live. This is exactly what the SDK does on every cold
start, so it is a true end-to-end check of the credentials.

---

## Step 5 — wire it into the env file

Set all six in the target's env file (`backend/.env` for local, `.env.staging`, `.env.production`):

| Variable            | From                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `ZC_PROJECT_ID`     | Step 1                                                                                             |
| `ZC_PROJECT_KEY`    | Step 1 (ZAID)                                                                                      |
| `ZC_ENVIRONMENT`    | `Development` or `Production` — the Catalyst environment's real name, not the deploy target's name |
| `ZC_CLIENT_ID`      | Step 2                                                                                             |
| `ZC_CLIENT_SECRET`  | Step 2                                                                                             |
| `ZC_REFRESH_TOKEN`  | Step 4                                                                                             |
| `ZC_STRATUS_BUCKET` | Step 1                                                                                             |

All seven are **optional** in `env.ts` on purpose — a deployment that never uploads still boots.
`env.catalyst.configured` goes true only when six of them are present (everything but
`ZC_ENVIRONMENT`, which has a default), and `lib/storage.ts` throws a readable error at call time
rather than letting a cryptic SDK failure surface at the upload site.

**All three of `ZC_CLIENT_ID` / `ZC_CLIENT_SECRET` / `ZC_REFRESH_TOKEN` must come from the same
Self Client.** Mixing a new client id with an old refresh token is a common copy-paste error and
produces `invalid_client`, which looks like a credentials problem rather than a pairing problem.

### Serving what you uploaded

Nothing extra to configure. The API stores only the object key and returns a **relative**
`/api/storage/stream?key=…` URL for logos, item images, and avatars, which the browser resolves
against whatever origin it is already on. Same string works on localhost, staging, and production.

Do not "improve" these into absolute URLs built from an env var. That was the previous design and
it failed in the quietest possible way: `APP_URL` has a dev default of `http://localhost:5173` in
`env.ts`, so a deployed environment that omitted it did not error — it served perfectly
well-formed image links pointing at the developer's laptop.

`APP_URL` is still required, but for one thing only: the accept link in invitation emails
(`invitations.service.ts`). An email has no origin to resolve a relative path against, so that one
must be absolute. Set it in every deployed env file:

```
APP_URL="https://your-deployment-origin"
```

The same silent default applies there — an unset `APP_URL` sends invitees to `localhost:5173` and
nothing in the logs will tell you.

### Why the `ZC_` prefix

Not `CATALYST_`. AppSail reserves that prefix for the variables it injects into the container and
rejects the whole deploy with `environment_variables must not contain reserved keywords` if the
config sets any `CATALYST_*` key.

---

## Step 6 — verify

1. `npm run dev` in `backend/`.
2. Upload an org logo from the UI (Settings → Organization).
3. Expect `logo_url` in the response to start with your `APP_URL`, and the image to render.

Objects land under keys like `organizations/<orgId>/logo-<ts>-<filename>`. Confirm in Catalyst
Console → Stratus → your bucket.

---

## Troubleshooting

| Symptom                                                               | Cause                                                                                                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"error":"invalid_client"}`                                          | Wrong DC host, or id/secret/refresh-token not all from the same Self Client, or the client was deleted                                                                  |
| `{"error":"invalid_code"}`                                            | Grant token expired or already used. Generate a new one — never retry a used code                                                                                       |
| `{"error":"invalid_client"}` on a code that just worked elsewhere     | You generated the code in one account's API Console and exchanged with another account's client                                                                         |
| 500 with `debug: "[object Object]"`                                   | The SDK rejected with a plain object, not an `Error`. The real payload is in the server terminal via `console.error('[unhandled]', …)` in `middlewares/errorHandler.ts` |
| `Catalyst Stratus is not configured.`                                 | One of the six vars is missing — `env.catalyst.configured` is false                                                                                                     |
| Upload succeeds, image is broken, URL is absolute with the wrong host | Something rebuilt a storage URL from `APP_URL`. These are relative on purpose — see "Serving what you uploaded"                                                         |
| Invitation emails link to `localhost:5173`                            | `APP_URL` not set for that environment                                                                                                                                  |
| Upload succeeds locally, fails after deploy                           | Env vars reach AppSail only through a deploy. Redeploy after editing any env file                                                                                       |
| `deploy: … disagree about the destination`                            | The env file's `ZC_PROJECT_ID`/`ZC_PROJECT_KEY`/`ZC_ENVIRONMENT` belong to another target                                                                               |

---

## Rotating or replacing credentials

There is no rotation flow — you regenerate. Repeat Steps 3–4 against the existing Self Client
(the client id and secret stay the same; only the refresh token changes), update
`ZC_REFRESH_TOKEN`, and redeploy. The old refresh token keeps working until you revoke it in the
API Console, so there is no downtime window.

If the Self Client itself was deleted, all three credentials change and you start at Step 2.

**Never commit these.** `backend/.env*` (except `.env.example` and `.env.production.example`) is
gitignored. A refresh token is a long-lived credential with full read/write on the bucket — treat
a leaked one as compromised and revoke it in the API Console rather than waiting it out.
