import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/auth-context';
import { useSessionWatch } from '../features/auth/useSessionWatch';

/** Guards nested routes: redirect to /login when unauthenticated. */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Mounted here because this is the one component every authenticated route
  // renders through, and it sits inside the router so the sign-out can navigate.
  // It polls only while authenticated — see the hook.
  useSessionWatch();

  // Hold off on the redirect decision until the on-load session restore
  // settles, otherwise a reload would bounce a logged-in user to /login.
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    // Remember where the user was headed so we can send them back after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
