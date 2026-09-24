import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../providers/auth-context';

/** Guards public routes (login/signup): redirect to home when authenticated. */
export function GuestRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  // Wait for auth to settle to prevent flashing the login screen before redirect
  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
