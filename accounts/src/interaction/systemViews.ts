import { escapeHtml, shell } from './views.ts';

/**
 * The pages `oidc-provider` renders on its own — logout confirmation, post-logout,
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
 * The sign-out confirmation.
 *
 * 🔴 This page is NOT optional, and it is not merely a courtesy. Without an
 * `id_token_hint` the provider cannot know the request genuinely came from the
 * user, so any site that links to `/session/end` could otherwise sign people out
 * of every app at once — a small but real cross-site nuisance. The spec expects a
 * confirmation in exactly this case.
 *
 * We could skip it by sending `id_token_hint`, but that would mean STORING the ID
 * token after login purely to hand it back at logout, and §3 is explicit that the
 * token is read once and discarded. One click is the better trade than a retained
 * credential.
 *
 * `form` comes from the library and already carries the XSRF token and the form id
 * (`op.logoutForm`). The buttons live outside it and target it by id, which is how
 * the default does it — hence `form="op.logoutForm"` rather than nesting them.
 *
 * 🔴 The confirm button MUST carry `name="logout" value="yes"`. That parameter is
 * what makes the provider actually destroy the session; without it the request
 * succeeds but only detaches this one client, and the user stays signed in
 * everywhere else while believing they signed out.
 */
export function logoutConfirmPage(form: string, clientName?: string): string {
  const who = clientName ? escapeHtml(clientName) : 'your apps';

  return shell(
    'Sign out',
    `
    <h1>Sign out?</h1>
    <p class="sub">This signs you out of ${who} and every other Octfis app on this browser.</p>
    ${form}
    <div class="stack">
      <button autofocus type="submit" form="op.logoutForm" name="logout" value="yes">
        Yes, sign me out
      </button>
      <button type="submit" form="op.logoutForm" class="secondary">
        No, stay signed in
      </button>
    </div>
  `,
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
