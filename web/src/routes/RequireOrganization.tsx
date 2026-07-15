import { Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../features/organizations/organizations.api';

/**
 * Guards routes that require the user to have at least one organization.
 * If the user has none, they are redirected to the organization onboarding page.
 */
export function RequireOrganization() {
  const { data: organizations, isLoading, isError } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    // Cache the result for a short time so it doesn't flash too much on navigation
    staleTime: 5 * 60 * 1000, 
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Loading workspace...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-danger)' }}>Failed to load workspace. Please refresh.</p>
      </div>
    );
  }

  if (organizations && organizations.length === 0) {
    return <Navigate to="/organizations/new" replace />;
  }

  return <Outlet />;
}
