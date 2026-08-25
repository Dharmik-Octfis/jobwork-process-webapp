/**
 * Server-rendered interaction pages. No framework, no client-side JavaScript.
 *
 * 🔴 This is the one screen in the estate that sees a plaintext password, so it
 * stays as small as it can be. Every script tag, stylesheet or font pulled from
 * somewhere else is another origin that could read a password field, and a bundler
 * is another supply chain in front of the login form. Plain HTML and inline CSS
 * are not a shortcut here — they are the security property.
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

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background:#f6f7f9; color:#14171f; }
  @media (prefers-color-scheme: dark) { body { background:#101318; color:#e8eaed; } }
  .card { width:100%; max-width:380px; padding:32px; border-radius:12px; background:#fff;
          box-shadow:0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); }
  @media (prefers-color-scheme: dark) { .card { background:#171b22; box-shadow:none; border:1px solid #262c36; } }
  h1 { margin:0 0 4px; font-size:20px; }
  p.sub { margin:0 0 24px; font-size:13px; opacity:.65; }
  label { display:block; margin-bottom:6px; font-size:13px; font-weight:500; }
  input { width:100%; padding:10px 12px; margin-bottom:16px; border:1px solid #cdd2da;
          border-radius:8px; font-size:15px; background:transparent; color:inherit; }
  input:focus { outline:2px solid #3b6ef5; outline-offset:1px; border-color:transparent; }
  @media (prefers-color-scheme: dark) { input { border-color:#333b47; } }
  button { width:100%; padding:11px; border:0; border-radius:8px; background:#2f6bf0; color:#fff;
           font-size:15px; font-weight:500; cursor:pointer; }
  button:hover { background:#2559d6; }
  button:focus-visible { outline:2px solid #14171f; outline-offset:2px; }
  .error { margin:0 0 16px; padding:10px 12px; border-radius:8px; font-size:13px;
           background:#fdecec; color:#a01d1d; }
  @media (prefers-color-scheme: dark) { .error { background:#3a1d1d; color:#ffb4b4; } }
  .notice { margin:0 0 16px; padding:10px 12px; border-radius:8px; font-size:13px;
            background:#eaf3ff; color:#14457f; }
  @media (prefers-color-scheme: dark) { .notice { background:#16283f; color:#b8d4ff; } }
  a { color:#2f6bf0; }

  /* A vertical run of buttons, as on the sign-out confirmation. */
  .stack button { margin-bottom:10px; }
  .stack button:last-child { margin-bottom:0; }

  /*
    The safe choice on a destructive prompt. Quieter than the primary, but still a
    full-size target with a real focus ring — "No, stay signed in" is the option
    someone reaches for in a hurry.
  */
  button.secondary { background:transparent; color:#2f6bf0; border:1px solid #cdd2da; }
  button.secondary:hover { background:#f1f4f9; }
  @media (prefers-color-scheme: dark) {
    button.secondary { border-color:#333b47; color:#8fb0ff; }
    button.secondary:hover { background:#1d222b; }
  }

  /* Protocol detail on the error page — present for whoever is debugging, and
     visually subordinate so it never reads as the message to the user. */
  .technical { margin:20px 0 0; padding-top:16px; border-top:1px solid #e6e9ef;
               font-size:12px; line-height:1.5; opacity:.7; word-break:break-word; }
  .technical code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media (prefers-color-scheme: dark) { .technical { border-top-color:#262c36; } }

  /* Password field with a show/hide button sitting inside its right edge. */
  .pw { position:relative; }
  .pw input { padding-right:44px; }
  .pw button {
    position:absolute; top:0; right:0; width:40px; height:40px;
    display:flex; align-items:center; justify-content:center;
    width:40px; padding:0; margin:0; border:0; border-radius:8px;
    background:none; color:#64748b; cursor:pointer;
  }
  .pw button:hover { color:#14171f; }
  @media (prefers-color-scheme: dark) { .pw button:hover { color:#e8eaed; } }
  .pw button:focus-visible { outline:2px solid #3b6ef5; outline-offset:-2px; }
`;

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
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main class="card">${body}</main>${
    options.script ? `<script src="${escapeHtml(options.script)}" defer></script>` : ''
  }</body>
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

  return shell(
    'Sign in',
    `
    <h1>Sign in</h1>
    <p class="sub">to continue to ${escapeHtml(clientName)}</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/interaction/${encodeURIComponent(uid)}/login" autocomplete="on">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(email)}"
             autocomplete="username" required autofocus>
      ${passwordField({ id: 'password', name: 'password', label: 'Password', autocomplete: 'current-password' })}
      <button type="submit">Sign in</button>
    </form>
    <p class="sub" style="margin-top:16px">
      <a href="/forgot-password">Forgot password?</a> · <a href="/signup">Create an account</a>
    </p>
  `,
    { script: PASSWORD_TOGGLE_SCRIPT },
  );
}

export function errorPage(message: string): string {
  return shell(
    'Sign-in problem',
    `
    <h1>Sign-in problem</h1>
    <p class="sub">${escapeHtml(message)}</p>
  `,
  );
}
