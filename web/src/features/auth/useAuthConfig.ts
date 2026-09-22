import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/**
 * What the sign-in screen needs to know before anyone is signed in.
 *
 * 🔴 Fetched at runtime, not read from `import.meta.env`. `SSO_ENABLED` is the
 * rollback path for the cutover (docs/SSO_AND_IDENTITY.md §13 step 4), and a flag
 * baked into this bundle would mean flipping it needs a rebuild and a redeploy of
 * the web app — at exactly the moment nobody can sign in. Asking the API costs one
 * request on the login screen and makes the switch a restart.
 */
export interface AuthConfig {
  ssoEnabled: boolean;
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth', 'config'],
    queryFn: async (): Promise<AuthConfig> => {
      const { data } = await apiClient.get<AuthConfig>(endpoints.auth.config);
      return data;
    },
    /**
     * It changes only when the API restarts, so refetching it is noise. But it is
     * NOT `Infinity`: after a cutover the operator wants a reload to be enough, not
     * a cache-clear.
     */
    staleTime: 5 * 60 * 1000,

    /**
     * 🔴 Retry harder than the default, and keep trying on focus.
     *
     * Nothing on the sign-in screen works until this resolves, so a single failed
     * attempt strands the user on an error page — and the most likely reason it
     * failed is the most transient one: the API was still starting. Three tries with
     * backoff covers a restart; refetching when the tab regains focus covers the
     * user who walked away, came back, and would otherwise still be looking at a
     * stale failure.
     */
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    refetchOnWindowFocus: true,
  });
}

/**
 * Start the redirect to the identity provider.
 *
 * 🔴 A full navigation, not a fetch. The whole point is to hand the browser to
 * another origin so it can present its own cookie — an XHR cannot do that, and
 * following the redirect with `fetch` would defeat the mechanism entirely (§2).
 *
 * `returnTo` is passed so a deep link survives the round trip; the server rejects
 * anything that is not a same-app path, because an absolute one would make this an
 * open redirect.
 *
 * `email` becomes the provider's `login_hint`, and is only ever set when we already
 * know who is arriving — today, an invitee following their link. It prefills the
 * provider's sign-in and signup fields so someone with no account yet registers the
 * address they were actually invited at; registering a different one gets them
 * signed in as an account the invitation cannot be accepted by. It is a default in
 * an editable field, nothing more.
 */
export function startSsoLogin(returnTo?: string, email?: string): void {
  const url = new URL(`${window.location.origin}/api/auth/sso/login`);
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  if (email) url.searchParams.set('email', email);
  window.location.assign(url.href);
}

/**
 * Sign in WITHOUT a screen, or be sent to the product website —
 * docs/SSO_WEBSITE_ENTRY_PLAN.md §5.2.
 *
 * `prompt=none` makes accounts answer immediately: a code if it already has a
 * session (the user lands on `/home` having seen nothing), or `login_required`, which
 * the callback turns into a redirect to the website, where the Sign In button lives.
 *
 * 🔴 Only for a visitor with no destination in mind. A deep link — an invitation above
 * all — must use `startSsoLogin`: a silent failure bounces to the website and the
 * link, with its invitation token, is lost for good (§5.3).
 */
export function startSilentSsoLogin(): void {
  const url = new URL(`${window.location.origin}/api/auth/sso/login`);
  url.searchParams.set('prompt', 'none');
  url.searchParams.set('returnTo', '/home');
  window.location.assign(url.href);
}
