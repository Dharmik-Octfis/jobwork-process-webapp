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
 */
export function startSsoLogin(returnTo?: string): void {
  const url = new URL(`${window.location.origin}/api/auth/sso/login`);
  if (returnTo) url.searchParams.set('returnTo', returnTo);
  window.location.assign(url.href);
}

/**
 * Send the browser to the identity provider to create an account.
 *
 * 🔴 Via our own API, not a link straight to accounts. The issuer URL stays
 * server-side — the browser is told where to go one hop at a time — so
 * `/auth/config` never has to publish the shape of the estate to an
 * unauthenticated caller.
 *
 * There is no local signup once SSO is on: an account in jobwork is granted by
 * invitation (§9.3), never self-created here.
 */
export function startSsoSignup(): void {
  window.location.assign(`${window.location.origin}/api/auth/sso/signup`);
}
