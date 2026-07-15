import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/auth-context';

/** Guards nested routes: redirect to /login when unauthenticated. */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

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
