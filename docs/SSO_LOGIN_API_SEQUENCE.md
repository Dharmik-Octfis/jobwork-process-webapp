# SSO sign-in — the API calls, in order

Every request a first-time SSO sign-in makes, in the order it makes them, with the request and
the response. This is the reference card. For why each step exists, what it writes and what
breaks it, read [`SSO_WALKTHROUGH.md`](SSO_WALKTHROUGH.md) (same example values; its steps are finer
grained, so the numbers differ).

**Hosts.** Production values below. Locally, the jobwork UI is `http://localhost:5173` (it proxies
`/api` to `:3000`), the jobwork API is `http://localhost:3000`, and accounts is
`http://localhost:3100`. In production the UI and API are one origin, `https://jobwork.octfis.com`.

**Values.** IDs, tokens, hashes and the person (James Walker) are the walkthrough's worked
example — the right shape, not captured traffic.

---

## The sequence at a glance

| #   | Who calls    | Request                                                            | Kind                 | Answers with                            |
| --- | ------------ | ------------------------------------------------------------------ | -------------------- | --------------------------------------- |
| 0   | website (JS) | `GET  accounts.octfis.com/session/status`                          | XHR, cross-origin    | `{ signedIn }` → button label           |
| 1   | browser      | `GET  jobwork.octfis.com/api/auth/sso/login`                       | page load            | 302 → accounts `/auth`, sets `sso_flow` |
| 2   | browser      | `GET  accounts.octfis.com/auth?client_id=jobwork&…`                | page load (redirect) | 302 → `/interaction/:uid`               |
| 3   | browser      | `GET  accounts.octfis.com/interaction/:uid`                        | page load (redirect) | 200 HTML login form                     |
| 4   | browser      | `POST accounts.octfis.com/interaction/:uid/login`                  | HTML form post       | 303 → `/auth/:uid`                      |
| 5   | browser      | `GET  accounts.octfis.com/auth/:uid` (twice on a first-ever login) | page load (redirect) | 302 → jobwork callback with `?code=`    |
| 6   | browser      | `GET  jobwork.octfis.com/api/auth/sso/callback?code=…&state=…`     | page load (redirect) | 302 → the app, sets `refreshToken`      |
| 6a  | jobwork API  | `POST accounts.octfis.com/token`                                   | server to server     | `id_token`                              |
| 6b  | jobwork API  | `GET  accounts.octfis.com/jwks`                                    | server to server     | public signing keys                     |
| 7   | React app    | `POST jobwork.octfis.com/api/auth/refresh-token`                   | XHR                  | `accessToken` + `user`                  |
| 8   | React app    | `GET  jobwork.octfis.com/api/organizations`                        | XHR, Bearer          | the user's organizations → pick one     |

Steps 1–6 are **full page navigations**, not API calls from JavaScript — the browser has to visit
accounts itself so it can present (or receive) the accounts session cookie. Only 0, 7 and 8 are
`fetch`/XHR, and 6a/6b never touch the browser at all.

---

## 0. Website sets the button label

The product page at `https://www.octfis.com/jobwork` asks accounts whether this browser is
already signed in, only to choose between **Sign In** and **Access Jobwork**. Both labels link to
the same URL (step 1).

```http
GET https://accounts.octfis.com/session/status
Origin: https://www.octfis.com
Cookie: _session=…                      (sent because of credentials: 'include')
```

```json
{ "signedIn": false }
```

Not the envelope — this is accounts, read by the website. `signedIn: true` does not mean jobwork
will let them in; step 6 decides that.

## 1. Clicking the button — jobwork starts the handshake

```http
GET https://jobwork.octfis.com/api/auth/sso/login
```

Optional query parameters (the website sends none):

| Parameter        | Set by                                 | Effect                                                         |
| ---------------- | -------------------------------------- | -------------------------------------------------------------- |
| `returnTo=/path` | jobwork's `/login` for a deep link     | where step 6 lands; must be a same-app path                    |
| `email=…`        | jobwork's `/login` for an invitee      | forwarded to accounts as `login_hint` to prefill the email box |
| `prompt=none`    | jobwork's `/login` with no destination | silent sign-in — see _Variants_                                |

```http
302 Found
Set-Cookie: sso_flow={"state":"xQ8vN2mK...","nonce":"pL4tR9wZ...","codeVerifier":"mB7cX3qW..."};
            HttpOnly; Secure; SameSite=Lax; Path=/api/auth/sso; Max-Age=1800
Location: https://accounts.octfis.com/auth
            ?client_id=jobwork
            &redirect_uri=https%3A%2F%2Fjobwork.octfis.com%2Fapi%2Fauth%2Fsso%2Fcallback
            &response_type=code
            &scope=openid+email+profile
            &state=xQ8vN2mK...
            &nonce=pL4tR9wZ...
            &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
            &code_challenge_method=S256
```

The `code_verifier` stays in the cookie; only its SHA-256 (`code_challenge`) goes to accounts.

## 2. accounts receives the authorization request

```http
GET https://accounts.octfis.com/auth?client_id=jobwork&redirect_uri=…&state=…&nonce=…&code_challenge=…
```

No `_session` cookie, so accounts parks the request as an `Interaction` row and asks for a login.

```http
302 Found
Set-Cookie: _interaction=…;        HttpOnly; SameSite=Lax; Path=/interaction/YtRfX4ht…
Set-Cookie: _interaction_resume=…; HttpOnly; SameSite=Lax; Path=/auth/YtRfX4ht…
Location: /interaction/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
```

## 3. The login form

```http
GET https://accounts.octfis.com/interaction/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
Cookie: _interaction=…
```

`200 OK` — server-rendered HTML with email and password fields. The address bar now shows
`accounts.octfis.com`.

## 4. Password submit

```http
POST https://accounts.octfis.com/interaction/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS/login
Content-Type: application/x-www-form-urlencoded
Cookie: _interaction=…

email=james.walker%40example.com&password=correct-horse-battery
```

Success — the Interaction row gains `"result": { "login": { "accountId": "8f2b1c04-…" } }`:

```http
303 See Other
Location: /auth/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
```

Failure — `200` with the form re-rendered and _"That email and password do not match."_ The same
words and the same timing whether the email or the password was wrong.

A new person clicks **Create Account** instead, which runs `/interaction/:uid/signup` then
`/interaction/:uid/verify` (a 6-digit emailed code). A confirmed code ends in the same 303.

## 5. accounts resumes the request and issues a code

```http
GET https://accounts.octfis.com/auth/YtRfX4htNcZhOwTeg7C6E_t0209txc8vy2wUtcOG-uS
Cookie: _interaction_resume=…
```

On a **first-ever** sign-in to jobwork this runs twice: the first pass finds no Grant, parks a
second interaction and redirects to `/interaction/<uid2>`, which auto-approves consent and
redirects to `/auth/<uid2>`. Later sign-ins finish in one pass.

```http
302 Found
Set-Cookie: _session=Hn4KpQ2rTvXz7B9cLmS3dF6gJ8kW1yA5eR0uZoI-tNb; HttpOnly; SameSite=Lax; Path=/
Location: https://jobwork.octfis.com/api/auth/sso/callback
            ?code=TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi
            &state=xQ8vN2mK...
            &iss=https%3A%2F%2Faccounts.octfis.com
```

The code is single-use and lives 60 seconds.

## 6. jobwork callback

```http
GET https://jobwork.octfis.com/api/auth/sso/callback?code=TX7vFJ…&state=xQ8vN2mK...&iss=…
Cookie: sso_flow=…
```

jobwork reads and clears `sso_flow`, then makes two server-to-server calls inside this request.

### 6a. Code exchange

```http
POST https://accounts.octfis.com/token
Authorization: Basic base64(jobwork:<client_secret>)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=TX7vFJpeg4DyQx23FuPS17c5UPhgr6vhdajAPD_tTUi
&redirect_uri=https://jobwork.octfis.com/api/auth/sso/callback
&code_verifier=mB7cX3qW...
```

```json
{
  "access_token": "eyJhbGciOiJFZERTQSIsImtpZCI6…",
  "id_token": "eyJhbGciOiJFZERTQSIsImtpZCI6…",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

The `id_token` payload, decoded:

```json
{
  "sub": "8f2b1c04-9d7e-4a51-b3c6-0e5a7d21f9ab",
  "email": "james.walker@example.com",
  "email_verified": true,
  "name": "James Walker",
  "picture": null,
  "sid": "btpdNjTMMI97F3YHhiHJnJ47pUi7K82YMN3EjBbxiVM",
  "iss": "https://accounts.octfis.com",
  "aud": "jobwork",
  "nonce": "pL4tR9wZ...",
  "exp": 1787654700,
  "iat": 1787654400
}
```

Identity only — no organizations, roles or permissions. jobwork discards the `access_token`.

### 6b. Signing keys

```http
GET https://accounts.octfis.com/jwks
```

Returns the public keys; jobwork verifies the `id_token` signature, `iss`, `aud`, `exp`, `state`
and `nonce`.

### 6 — what the browser gets back

jobwork maps `sub` to its own `users` row (linked, matched by verified email once, or created
password-less), writes a `refresh_tokens` row, and redirects:

```http
302 Found
Set-Cookie: sso_flow=; Path=/api/auth/sso; Expires=Thu, 01 Jan 1970 00:00:00 GMT
Set-Cookie: refreshToken=eyJhbGciOiJIUzI1NiIs…; HttpOnly; Secure; SameSite=None; Path=/api/auth;
            Expires=<session expiry, 7 days after sign-in>
Location: https://jobwork.octfis.com/            (or the returnTo path from step 1)
```

No token in the URL — the next call picks the session up from the cookie.

| When the callback fails                                                   | Browser is sent to                      |
| ------------------------------------------------------------------------- | --------------------------------------- |
| 403 — email not verified, or the account disabled in jobwork              | `/no-access`                            |
| anything else — missing/expired `sso_flow`, state mismatch, replayed code | `/login?sso=manual&error=signin_failed` |

## 7. The React app restores the session

The app loads fresh with nothing in memory and does what it does on every load:

```http
POST https://jobwork.octfis.com/api/auth/refresh-token
Cookie: refreshToken=eyJhbGciOiJIUzI1NiIs…
```

```json
{
  "statusCode": 200,
  "message": "Session refreshed.",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "user": {
      "id": "3c9d5e21-7b48-4f0a-9e13-6a2c8b40d7f5",
      "firstName": "James",
      "lastName": "Walker",
      "fullName": "James Walker",
      "email": "james.walker@example.com",
      "avatarUrl": null,
      "userAgent": "Mozilla/5.0 …"
    }
  }
}
```

`user.id` is jobwork's id, not the `sub`. The access token lives 15 minutes, in memory only; this
same call renews it. The refresh token is not rotated — the same cookie comes back.

## 8. Pick the organization

Landing on `/` mounts `OrgRedirect`, which asks for the user's organizations:

```http
GET https://jobwork.octfis.com/api/organizations
Authorization: Bearer eyJhbGciOiJIUzI1NiIs…
```

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": [
    {
      "organizationId": "b41f7a90-2c3d-4e58-8a71-9f0b6d2e4c13",
      "org_code": "…",
      "name": "OCTFIS TECHNO LLP",
      "industryType": "…",
      "email": "…",
      "phone": "…",
      "dialCode": "+91",
      "address": {
        "street_address1": "…",
        "country": "IN",
        "stateCode": "…",
        "city": "…",
        "zip": "…"
      },
      "website": null,
      "logo_url": null,
      "account_created_date": "2026-08-04T09:12:00.000Z",
      "industry": { "name": "…" },
      "settings": {},
      "migrationDate": null
    }
  ]
}
```

| Result                                      | Browser goes to                   |
| ------------------------------------------- | --------------------------------- |
| last-used org (`localStorage`) still listed | `/organizations/<that id>`        |
| otherwise                                   | `/organizations/<first id>`       |
| empty list                                  | `/organizations/new` — create one |

Signed in. Every request from here carries the Bearer token; accounts is not contacted again until
the next sign-in.

---

## Variants

### Returning user — already signed in at accounts

Step 2 finds the `_session` cookie and goes straight to issuing the code. Steps 3, 4 and the
consent hop never happen:

```
0 → 1 → 2 (302 straight to the callback with ?code=) → 6 → 6a → 6b → 7 → 8
```

The user sees a flicker through accounts and lands in the app.

### Opening jobwork directly (`https://jobwork.octfis.com/`)

With no session the app sends the visitor to `/login`, which first asks whether SSO is on:

```http
GET https://jobwork.octfis.com/api/auth/config
```

```json
{ "statusCode": 200, "message": "Success", "data": { "ssoEnabled": true } }
```

Then `/login` redirects without showing a screen:

| The visitor wanted                      | `/login` starts                                                   |
| --------------------------------------- | ----------------------------------------------------------------- |
| nothing in particular (`/`, `/home`)    | `GET /api/auth/sso/login?prompt=none&returnTo=/home` — **silent** |
| a deep link, or came from an invitation | `GET /api/auth/sso/login?returnTo=<path>[&email=<invitee>]`       |

A **silent** sign-in adds `prompt=none` to the step-1 redirect to accounts, and sets a 30-second
`sso_silent` cookie so a second silent attempt inside that window shows the button instead (the
loop guard). accounts then never shows a form:

- signed in there → a code, and the flow continues at step 6;
- not signed in → `/api/auth/sso/callback?error=login_required&state=…`, which jobwork turns into
  a redirect to the website (`https://www.octfis.com/jobwork`) to sign in from there — or to
  `/login?sso=manual` where no website URL is configured (local dev).

`/login?sso=manual` skips the redirect and shows the **Access Jobwork** button instead.
