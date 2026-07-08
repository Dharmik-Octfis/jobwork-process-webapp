import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/auth-context';

/** Guards nested routes: redirect to /login when unauthenticated. */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where the user was headed so we can send them back after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
