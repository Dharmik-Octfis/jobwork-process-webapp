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
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main class="card">${body}</main></body>
</html>`;
}

export function loginPage(options: {
  uid: string;
  clientName: string;
  email?: string;
  error?: string;
}): string {
  const { uid, clientName, email = '', error } = options;

  return page(
    'Sign in',
    `
    <h1>Sign in</h1>
    <p class="sub">to continue to ${escapeHtml(clientName)}</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/interaction/${encodeURIComponent(uid)}/login" autocomplete="on">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(email)}"
             autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  `,
  );
}

export function errorPage(message: string): string {
  return page(
    'Sign-in problem',
    `
    <h1>Sign-in problem</h1>
    <p class="sub">${escapeHtml(message)}</p>
  `,
  );
}
