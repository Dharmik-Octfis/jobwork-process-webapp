/**
 * Server-rendered interaction pages. No framework, no client-side JavaScript.
 *
 * 🔴 This is the one screen in the estate that sees a plaintext password, so it
 * stays as small as it can be. Every script tag, stylesheet or font pulled from
 * somewhere else is another origin that could read a password field, and a bundler
 * is another supply chain in front of the login form. Plain HTML and inline CSS
 * are not a shortcut here — they are the security property.
 *
 * 🔴 That is also why the brand images are COPIES in `public/assets/`, not the URL
 * the app's own `AuthShell` uses. The app pulls its logo from `cliq.zoho.com`; on a
 * page with a password field that is an external origin one CSP mistake away from
 * being able to read it, and an outage away from a broken login screen. The
 * lockup below is the same official asset, served same-origin.
 */

/** Escape anything interpolated into HTML. Nothing here is trusted. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The look is ported from the app's own sign-in screen (`web/src/features/auth`)
 * so signing in does not feel like leaving the product — the browser changes host
 * mid-flow, and a page that looks nothing like the one before it is exactly when
 * people stop and wonder whether they are being phished.
 *
 * Light only, deliberately. The app's design is light, and a `prefers-color-scheme`
 * branch here would give the estate two different-looking sign-ins depending on an
 * OS setting the app itself ignores.
 */
const STYLE = `
  :root {
    color-scheme: light;
    --primary: #0088ff;
    --link: #0284c7;
    --text: #1e293b;
    --muted: #64748b;
    --border: #dbe2ea;
    --input-bg: #f8fafc;
  }
  * { box-sizing: border-box; }

  body {
    margin: 0;
    font: 15px/1.5 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: var(--text);
  }

  .page {
    min-height: 100vh;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 20px 16px;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #e3f0fc 0%, #d8eaff 50%, #eaf3ff 100%);
  }

  /* Decoration only — every one of these carries aria-hidden in the markup. */
  .cube {
    position: absolute;
    pointer-events: none;
    z-index: 1;
    background: linear-gradient(135deg,
      rgba(255,255,255,.95) 0%, rgba(225,239,255,.45) 50%, rgba(185,218,255,.75) 100%);
    box-shadow:
      inset 4px 4px 12px rgba(255,255,255,1),
      inset -6px -6px 16px rgba(135,185,245,.35),
      15px 25px 40px rgba(90,155,230,.12);
  }
  .cube-tl { width:420px; height:420px; top:-120px; left:-120px; transform:rotate(35deg); border-radius:90px; }
  .cube-br { width:480px; height:480px; bottom:-150px; right:-130px; transform:rotate(-28deg); border-radius:100px; }
  .cube-bl { width:320px; height:320px; bottom:-70px; left:-90px; transform:rotate(22deg); border-radius:70px; }
  .cube-behind { width:280px; height:280px; top:28%; left:36%; transform:rotate(28deg); border-radius:60px; opacity:.85; }
  .cube-tr { width:150px; height:150px; top:18%; right:18%; transform:rotate(22deg); border-radius:38px; opacity:.8; }
  .cube-nbr { width:160px; height:160px; bottom:22%; right:16%; transform:rotate(14deg); border-radius:40px; opacity:.75; }

  .dots {
    position: absolute;
    pointer-events: none;
    z-index: 0; /* strictly behind the cubes */
    background-image: radial-gradient(rgba(59,130,246,.28) 2px, transparent 2px);
    background-size: 16px 16px;
  }
  .dots-tl { width:220px; height:220px; top:12%; left:8%; transform:rotate(-10deg); }
  .dots-r  { width:220px; height:220px; top:35%; right:22%; transform:rotate(12deg); }
  .dots-l  { width:200px; height:200px; bottom:20%; left:21%; transform:rotate(-8deg); }

  .card {
    position: relative;
    z-index: 2;
    margin: auto 0;
    width: 100%;
    max-width: 400px;
    background: #fff;
    border: 1px solid #eaedf1;
    border-radius: 12px;
    padding: 22px 28px;
    box-shadow: 0 10px 30px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.03);
  }

  .brand { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .brand img { display:block; flex:none; object-fit:contain; }

  h1 { margin:0 0 2px; font-size:20px; font-weight:700; letter-spacing:-.01em; }
  p.sub { margin:0 0 16px; font-size:13px; color:var(--muted); }

  /*
    Visually hidden, NOT removed. The app's own auth forms set
    \`label { display:none }\`, which is what a placeholder-only design usually
    costs: the field loses its accessible name, and a screen reader announces
    "edit text, blank" once something is typed and the placeholder disappears.
    Same look, kept name.
  */
  label {
    position:absolute; width:1px; height:1px; margin:-1px; padding:0;
    overflow:hidden; clip-path:inset(50%); white-space:nowrap;
  }

  input {
    width:100%; height:38px; margin-bottom:10px; padding:0 12px;
    border:1px solid var(--border); border-radius:6px;
    background:var(--input-bg); color:var(--text);
    /* Longhand on purpose: the \`font\` shorthand cannot take \`inherit\` as its
       family, so the whole declaration would be invalid and silently dropped. */
    font-family:inherit; font-size:13.5px; font-weight:400;
    outline:none; transition:border-color .2s ease, box-shadow .2s ease, background .2s ease;
  }
  input::placeholder { color:#94a3b8; }
  input:focus {
    border-color:var(--primary); background:#fff;
    box-shadow:0 0 0 2.5px rgba(0,136,255,.12);
  }

  button[type="submit"] {
    width:100%; height:38px; margin-top:6px; border:0; border-radius:6px;
    background:linear-gradient(135deg, #0D5C75 0%, #0088CC 100%);
    color:#fff; font-family:inherit; font-size:13.5px; font-weight:600; cursor:pointer;
    box-shadow:0 4px 12px rgba(0,136,255,.2);
    transition:box-shadow .2s ease, transform .1s ease;
  }
  button[type="submit"]:hover {
    background:linear-gradient(135deg, #0f6c8a 0%, #009be6 100%);
    box-shadow:0 6px 16px rgba(0,136,204,.35);
    transform:translateY(-1px);
  }
  button[type="submit"]:active { transform:translateY(1px); }
  button[type="submit"]:focus-visible { outline:2px solid var(--text); outline-offset:2px; }

  a { color:var(--link); text-decoration:none; font-weight:500; }
  a:hover { text-decoration:underline; }

  .forgot { display:flex; justify-content:flex-end; margin:-4px 0 4px; font-size:12px; }
  .switch { margin:12px 0 0; text-align:center; color:var(--muted); font-size:12px; }
  .switch a { font-weight:600; }

  .error, .notice {
    margin:0 0 12px; padding:9px 12px; border-radius:6px; font-size:12.5px;
  }
  .error  { background:#fdecec; color:#a01d1d; }
  .notice { background:#eaf3ff; color:#14457f; }

  /* A vertical run of buttons, as on the sign-out hand-off. */
  .stack button { margin-bottom:10px; }
  .stack button:last-child { margin-bottom:0; }

  /* Protocol detail on the error page — present for whoever is debugging, and
     visually subordinate so it never reads as the message to the user. */
  .technical {
    margin:16px 0 0; padding-top:14px; border-top:1px solid #eaedf1;
    font-size:12px; line-height:1.5; color:var(--muted); word-break:break-word;
  }
  .technical code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }

  /* Password field with a show/hide button sitting inside its right edge. */
  .pw { position:relative; }
  .pw input { padding-right:40px; }
  .pw button {
    position:absolute; top:0; right:6px; height:38px; width:26px;
    display:flex; align-items:center; justify-content:center;
    padding:0; border:0; border-radius:50%; background:none;
    color:var(--muted); cursor:pointer;
  }
  .pw button:hover { color:var(--primary); background:rgba(0,136,255,.1); }
  .pw button:focus-visible { outline:2px solid var(--primary); outline-offset:-2px; }
  /* The script renders an 18px icon; the app's own field shows 16px. */
  .pw button svg { width:16px; height:16px; }

  .card-footer {
    display:flex; align-items:center; justify-content:center; gap:12px;
    margin-top:16px; padding-top:14px; border-top:1px solid #eaedf1;
    font-size:12px;
  }
  .card-footer a { display:inline-flex; align-items:center; gap:5px; color:var(--link); }
  .card-footer .divider { width:1px; height:12px; background:#cbd5e1; }

  .copyright {
    position:relative; z-index:2;
    width:100%; margin-top:auto; padding-top:12px;
    text-align:center; font-size:12px; color:var(--muted);
  }

  @media (max-width:480px) {
    .card { padding:24px 20px; border-radius:10px; }
    .cube-behind, .cube-tr, .cube-nbr, .dots { display:none; }
  }
`;

/** The one static asset every page loads, beside the optional password toggle. */
const BRAND = `
      <div class="brand">
        <img src="/assets/octfis-mark.gif" width="30" height="30" alt="">
        <img src="/assets/octfis-wordmark-green.png" height="38" alt="OCTFIS TECHNO LLP">
      </div>`;

const GLOBE_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const MAIL_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * The one page chrome, shared by every server-rendered screen here.
 *
 * `script` is the ONLY script any of these pages loads: same-origin, ~60 lines, no
 * dependencies. helmet's default `script-src 'self'` already permits it, so no CSP
 * is relaxed to make it work — and an inline script would not have been allowed.
 * These pages carry a plaintext password field, so that bar stays where it is.
 */
export function shell(title: string, body: string, options: { script?: string } = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<link rel="icon" type="image/gif" href="/assets/octfis-mark.gif">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="page">
    <div class="cube cube-tl" aria-hidden="true"></div>
    <div class="cube cube-br" aria-hidden="true"></div>
    <div class="cube cube-bl" aria-hidden="true"></div>
    <div class="cube cube-behind" aria-hidden="true"></div>
    <div class="cube cube-tr" aria-hidden="true"></div>
    <div class="cube cube-nbr" aria-hidden="true"></div>
    <div class="dots dots-tl" aria-hidden="true"></div>
    <div class="dots dots-r" aria-hidden="true"></div>
    <div class="dots dots-l" aria-hidden="true"></div>

    <main class="card">${BRAND}${body}
      <footer class="card-footer">
        <a href="https://www.octfis.com" target="_blank" rel="noreferrer">${GLOBE_ICON}octfis.com</a>
        <span class="divider"></span>
        <a href="mailto:sales@octfis.com">${MAIL_ICON}sales@octfis.com</a>
      </footer>
    </main>

    <footer class="copyright">© ${new Date().getFullYear()}, OCTFIS Techno LLP. All Rights Reserved.</footer>
  </div>${options.script ? `\n  <script src="${escapeHtml(options.script)}" defer></script>` : ''}
</body>
</html>`;
}

/**
 * A password input with a show/hide toggle.
 *
 * The toggle is a real `<button type="button">`, not a styled `<div>`: it is
 * therefore reachable with Tab, operable with Enter and Space, and announced as a
 * toggle — all for free. `type="button"` matters as much as the element does, since
 * a bare `<button>` inside a form submits it.
 */
export function passwordField(options: {
  id: string;
  name: string;
  label: string;
  autocomplete: string;
  minlength?: number;
}): string {
  const { id, name, label, autocomplete, minlength } = options;

  return `
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <div class="pw">
        <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="password"
               placeholder="${escapeHtml(label)}"
               autocomplete="${escapeHtml(autocomplete)}"${minlength ? ` minlength="${minlength}"` : ''} required>
        <button type="button" data-toggle-for="${escapeHtml(id)}" aria-label="Show password"
                aria-pressed="false"></button>
      </div>`;
}

/** Every page with a password field loads this, and nothing else does. */
export const PASSWORD_TOGGLE_SCRIPT = '/js/password-toggle.js';

export function loginPage(options: {
  uid: string;
  clientName: string;
  email?: string;
  error?: string;
}): string {
  const { uid, clientName, email = '', error } = options;

  /**
   * The address is carried through to signup, so someone who arrived from an
   * invitation and has no account yet registers the address they were invited AT.
   * Register a different one and the app refuses them after everything else
   * succeeded — see the note on the `/signup` route.
   */
  const signupHref = email ? `/signup?email=${encodeURIComponent(email)}` : '/signup';

  return shell(
    'Sign in',
    `
      <h1>Sign in</h1>
      <p class="sub">to continue to ${escapeHtml(clientName)}</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/interaction/${encodeURIComponent(uid)}/login" autocomplete="on">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" value="${escapeHtml(email)}"
               placeholder="Email address" autocomplete="username" required autofocus>
        ${passwordField({ id: 'password', name: 'password', label: 'Password', autocomplete: 'current-password' })}
        <p class="forgot"><a href="/forgot-password">Forgot password?</a></p>
        <button type="submit">Sign In</button>
      </form>
      <p class="switch">Don't have an account? <a href="${escapeHtml(signupHref)}">Create Account</a></p>`,
    { script: PASSWORD_TOGGLE_SCRIPT },
  );
}

export function errorPage(message: string): string {
  return shell(
    'Sign-in problem',
    `
      <h1>Sign-in problem</h1>
      <p class="sub">${escapeHtml(message)}</p>`,
  );
}
