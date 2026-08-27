import { escapeHtml, shell } from './views.ts';

/**
 * The pages `oidc-provider` renders on its own — the sign-out hand-off, post-logout,
 * and errors. Left alone they are the library's built-in placeholders, which the
 * library itself warns about at boot ("you SHOULD change it in order to customize
 * the look").
 *
 * 🔴 Beyond looking wrong, the defaults pull a stylesheet from
 * `fonts.googleapis.com`. Every page in this service is part of the auth path, and
 * the rule the sign-in screen follows applies here too: no external origin gets to
 * participate in a page where someone is authenticating. These replacements load
 * nothing.
 */

/**
 * The sign-out hand-off. Not a confirmation — it submits itself and is on screen
 * for a few milliseconds.
 *
 * 🔴 `logout=yes` is what makes this a real sign-out. Without that parameter the
 * request succeeds but only detaches the ONE client that asked, leaving the SSO
 * cookie alive — so the user lands back on the app's login page and is signed
 * straight back in without typing anything. That is the failure this page exists to
 * avoid, and it is why the parameter is a hidden input rather than a button the user
 * could decline.
 *
 * The library always renders this page: `end_session.js` calls `logoutSource`
 * whenever a session exists, and sending `id_token_hint` would NOT skip it. So
 * auto-submitting is the only way to remove the click, and storing the ID token
 * after login would buy nothing.
 *
 * ⚠️ **The trade, stated plainly:** the confirmation was the only thing stopping
 * another site from linking to `/session/end?client_id=…` and signing the user out
 * of everything. Removing it makes that possible. It is a nuisance, not a breach —
 * nothing is disclosed and nothing is authorised — and it is the same trade Google
 * and Zoho make, where sign-out is a plain link. Restoring the click means putting
 * a submit button back in place of the hidden input below.
 *
 * `form` comes from the library and already carries the XSRF token and the form id
 * (`op.logoutForm`). The input and the fallback button sit outside it and target it
 * by id, which is how the library's own default does it.
 *
 * The `<noscript>` button is not decoration: `submit()` lives in a file because
 * inline script is blocked by CSP, and a blocked or disabled script would otherwise
 * leave a page that can never sign anyone out. It carries no `name`, because a
 * second `logout` parameter is rejected by the provider's `rejectDupes`.
 */
export function signingOutPage(form: string, clientName?: string): string {
  const who = clientName ? escapeHtml(clientName) : 'your apps';

  return shell(
    'Signing out',
    `
    <h1>Signing you out…</h1>
    <p class="sub">Ending your session on ${who} and every other Octfis app on this browser.</p>
    ${form}
    <input type="hidden" name="logout" value="yes" form="op.logoutForm">
    <noscript>
      <p class="sub">JavaScript is off, so this needs one click.</p>
      <div class="stack">
        <button autofocus type="submit" form="op.logoutForm">Sign out</button>
      </div>
    </noscript>
  `,
    { script: '/js/logout-submit.js' },
  );
}

/** Shown after a logout when the client sent no `post_logout_redirect_uri`. */
export function signedOutPage(): string {
  return shell(
    'Signed out',
    `
    <h1>You're signed out</h1>
    <p class="sub">Your session on this browser has ended. Close this tab, or sign in again.</p>
  `,
  );
}

/**
 * Human sentences for the protocol errors a person can actually end up looking at.
 *
 * 🔴 The raw code is not enough on its own. "invalid_request: could not find logout
 * details" is precise and completely opaque — it is what the user saw after using
 * the browser Back button onto a spent sign-out link, and it reads like a crash
 * rather than "that link has already been used".
 */
function explain(error: string, description: string): { title: string; detail: string } {
  if (description.includes('could not find logout details')) {
    return {
      title: 'That sign-out link has already been used',
      detail:
        'Sign-out links work once. If you meant to sign out, you probably already are — start again from the app.',
    };
  }

  if (description.includes('interaction session') || description.includes('interaction')) {
    return {
      title: 'That sign-in took too long',
      detail: 'Go back to the app and start signing in again.',
    };
  }

  switch (error) {
    case 'invalid_client':
      return {
        title: "That app isn't recognised",
        detail:
          'It may not be registered here, or its settings changed. Contact your administrator.',
      };
    case 'invalid_redirect_uri':
      return {
        title: "That app's return address doesn't match",
        detail:
          'This is a configuration problem, not something you did. Contact your administrator.',
      };
    case 'access_denied':
      return { title: 'Access denied', detail: 'You were not signed in.' };
    default:
      return {
        title: 'Something went wrong',
        detail: 'The request could not be completed. Go back to the app and try again.',
      };
  }
}

/**
 * The error page.
 *
 * Two audiences, and they need different things. The person reading it needs a
 * sentence they can act on; whoever is debugging needs the protocol code. So the
 * sentence is always shown, and the raw `error` / `error_description` are shown
 * only OUTSIDE production — in production they are noise to the user and a small
 * hint to anyone probing.
 */
export function problemPage(
  out: Record<string, unknown>,
  options: { showDetail: boolean },
): string {
  const error = typeof out['error'] === 'string' ? out['error'] : 'server_error';
  const description = typeof out['error_description'] === 'string' ? out['error_description'] : '';
  const { title, detail } = explain(error, description);

  const technical =
    options.showDetail && (error || description)
      ? `<p class="technical"><code>${escapeHtml(error)}</code>${
          description ? `<br>${escapeHtml(description)}` : ''
        }</p>`
      : '';

  return shell(
    title,
    `
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${escapeHtml(detail)}</p>
    ${technical}
  `,
  );
}
