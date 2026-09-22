# SSO guide 2 of 3 — the app's product page on www.octfis.com

**Who this is for:** the website developer (Zoho Sites) who builds one product page per Octfis
app, e.g. `https://www.octfis.com/job-work-1` for Jobwork.
**Other guides:** `SSO_GUIDE_NEW_APP.md` (the app itself) · `SSO_GUIDE_ACCOUNTS.md` (accounts).

---

## 1. What the page does

It carries **one button** that is the way into the app.

| Visitor                              | Button reads       | On click                               |
| ------------------------------------ | ------------------ | -------------------------------------- |
| Not signed in                        | **Sign In**        | Octfis Accounts sign-in → into the app |
| Already signed in to Octfis Accounts | **Access \<App\>** | Straight into the app, no screen       |

Both labels use the **same link**. The label comes from a small check in the visitor's browser.
If the check fails for any reason, the button says **Sign In** and still works.

"Into the app" means the app decides what comes next — for jobwork, someone with no organization
yet (a brand-new account, including one created from the Sign In screen) lands on **Create
organization**. The website never needs to know which.

The page is also where the app sends people who are **signed out** or **not signed in** — so it
must be **public** (no IP restriction) before the app team points at it.

---

## 2. The values for each app

| Value           | Jobwork (example)                               | Your app                                      |
| --------------- | ----------------------------------------------- | --------------------------------------------- |
| Page address    | `https://www.octfis.com/job-work-1`             | `https://www.octfis.com/<slug>`               |
| Button link     | `https://jobwork.octfis.com/api/auth/sso/login` | `https://<app>.octfis.com/api/auth/sso/login` |
| Signed-in label | `Access Jobwork`                                | `Access <App>`                                |
| Label check URL | `https://accounts.octfis.com/session/status`    | same for every app                            |

🔴 The button link has **nothing after it** — no `?returnTo=`, no parameters. Where people land
inside the app is the app's decision.
🔴 The page must stay on **`www.octfis.com`** (with `www`). The label check only answers that
exact origin.

---

## 3. The code (paste into a Zoho Sites "Embed Code" element)

Replace the three `<<…>>` values. Nothing else needs to change.

```html
<!-- <<App>> sign-in button (Octfis Accounts SSO) -->
<div class="octfis-cta-wrap">
  <a id="octfis-cta" class="octfis-cta" href="https://<<app>>.octfis.com/api/auth/sso/login"
    >Sign In</a
  >
</div>

<style>
  .octfis-cta-wrap {
    text-align: center;
  }
  .octfis-cta {
    display: inline-block;
    min-width: 11rem;
    min-height: 44px;
    padding: 12px 28px;
    border-radius: 6px;
    background: #3fa2e7;
    color: #fff;
    font-weight: 600;
    font-size: 16px;
    line-height: 20px;
    text-align: center;
    text-decoration: none;
  }
  .octfis-cta:hover {
    background: #2b93d8;
  }
  .octfis-cta:focus-visible {
    outline: 3px solid #14171c;
    outline-offset: 3px;
  }
</style>

<script>
  (function () {
    var cta = document.getElementById('octfis-cta');
    if (!cta || !window.fetch) return;
    fetch('https://accounts.octfis.com/session/status', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.signedIn === true) cta.textContent = 'Access <<App>>';
      })
      .catch(function () {
        /* blocked, offline or unavailable: stay on "Sign In" */
      });
  })();
</script>
```

Styles may change to match the site. The link and the script may not.
Use **only one** sign-in button per page.

---

## 4. The one API the page calls

### `GET https://accounts.octfis.com/session/status`

|             |                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Called from | The visitor's **browser** only (never a server or build step — it has no cookie there and always says `false`). |
| Must send   | `credentials: 'include'` — the visitor's accounts cookie is the answer.                                         |
| Auth / key  | None. No API key, no secret, no registration.                                                                   |

Response (always 200 unless something is broken):

```jsonc
{ "signedIn": true } // or false
```

Response headers for `Origin: https://www.octfis.com`:

```
Access-Control-Allow-Origin: https://www.octfis.com
Access-Control-Allow-Credentials: true
Cache-Control: no-store
Vary: Origin
```

Any other origin gets no CORS headers, so the browser blocks the answer.

`signedIn: true` only means "signed in to Octfis Accounts". It does **not** mean the person may
use the app — some will be turned away by the app. That is expected and handled by the app.

---

## 5. When it runs and how it decides

1. The page loads with the button reading **Sign In**.
2. The script runs immediately, sends the check in the background, and does not block the page.
3. 50–300 ms later: `signedIn === true` → text changes to **Access \<App\>**. Anything else
   (false, error, blocked) → stays **Sign In**.
4. Runs once per page load. Signing in in another tab shows up after a refresh.

It works because `www.octfis.com` and `accounts.octfis.com` share the domain `octfis.com`, so
browsers treat the accounts cookie as first-party.

---

## 6. Rules

1. Both labels → the same link. Never change the link based on the check.
2. The check runs only in the browser.
3. Never cache the answer; never write "Access \<App\>" into the page by hand.
4. Don't delay the page waiting for the check.
5. Don't call anything else on `accounts.octfis.com`.
6. Don't rename or move the page without telling the app team — its address is configured in the
   app and in accounts, character for character.

---

## 7. Before going live

- [ ] Page content final, title and description set (it is the Google result for the app).
- [ ] Signed out: **Sign In** → accounts sign-in → lands in the app.
- [ ] Signed in: hard reload → **Access \<App\>** → lands in the app with no screen.
- [ ] Browser devtools blocking `accounts.octfis.com`: button still works, still says Sign In.
- [ ] Safari and Firefox, and a phone.
- [ ] IP restriction removed → **tell the app team the page is public** (they then point
      signed-out visitors and logouts at it).
