import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../providers/auth-context';
import { fetchSessionStatus, type SessionEndedReason } from './auth.api';

/**
 * Notice, within seconds, that this session was ended somewhere else.
 *
 * 🔴 Nothing tells a running tab that its session is over. `authenticate` never
 * reads the database, so a back-channel logout from another app, a "sign out
 * everywhere", or a disabled account leaves every open tab working normally until
 * its access token lapses — up to 15 minutes of a screen the user believes they
 * signed out of. On a shared shop-floor terminal that is the whole point of logging
 * out, undone.
 *
 * This is the cheap half of SSO_AND_IDENTITY §11: poll our own API. The other half
 * — an accounts-origin iframe pushing the change with no polling at all — needs the
 * real same-site domains and is not built. Polling costs one indexed row every 15
 * seconds per *visible* tab and works today, across origins, with no new
 * infrastructure.
 *
 * ⚠️ It only closes the **sign-out** direction. Signing in elsewhere still does not
 * light up an already-open logged-out tab; that genuinely needs the iframe, because
 * only the accounts origin can see its own cookie.
 */

const INTERVAL_MS = 15_000;

/**
 * Deliberately specific where the user can act on it, and vague where they cannot.
 * "Signed out from another app" tells someone their own logout worked; a generic
 * message after a central logout reads like a bug.
 *
 * A switch rather than a lookup object: the reasons mirror `revoked_reason` in the
 * database and are snake_case, which the naming-convention rule rejects as keys.
 */
function messageFor(reason: SessionEndedReason | null): string {
  switch (reason) {
    case 'sso_logout':
      return 'You were signed out from another app.';
    case 'account_disabled':
      return 'Your account is no longer active. Contact your administrator.';
    case 'expired':
      return 'Your session expired. Please sign in again.';
    default:
      return 'Your session was ended. Please sign in again.';
  }
}

export function useSessionWatch(): void {
  const { isAuthenticated, clearSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The query is disabled the moment `clearSession` runs, but React batches that
  // with this render — without the latch a second tick could sign the user out
  // twice and stack two toasts.
  const signedOut = useRef(false);

  const { data } = useQuery({
    queryKey: ['auth', 'session-watch'],
    queryFn: fetchSessionStatus,
    enabled: isAuthenticated,
    refetchInterval: INTERVAL_MS,
    /**
     * Focus is what makes this feel instant: coming back to a tab checks
     * immediately instead of waiting out the interval. Both are overrides —
     * `queryClient.ts` turns focus refetching off globally, and the default
     * `staleTime` of 30s would otherwise swallow the focus refetch entirely.
     */
    refetchOnWindowFocus: true,
    staleTime: 0,
    /**
     * A failed poll means the network is unhappy, not that the session ended.
     * Retrying would only stack requests in front of the next tick, which is
     * 15 seconds away and will ask again anyway.
     */
    retry: false,
  });

  useEffect(() => {
    if (!data || data.active || signedOut.current) return;

    signedOut.current = true;
    toast.error(messageFor(data.reason));

    clearSession();
    queryClient.clear();
    /**
     * A soft navigate, not `window.location`: the `Toaster` lives above the router,
     * so the message survives the route change. A full page load would discard it
     * and the user would arrive at the login screen with no idea why.
     */
    navigate('/login', { replace: true });
  }, [data, clearSession, queryClient, navigate]);

  // Signing back in must re-arm the watch, or a second session in the same tab
  // would never be checked again.
  useEffect(() => {
    if (isAuthenticated) signedOut.current = false;
  }, [isAuthenticated]);
}
