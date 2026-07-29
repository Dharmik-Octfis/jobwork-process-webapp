import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../features/organizations/organizations.api';

/** Remembers the last organization the user was in, so `/` returns them to it. */
export const LAST_ORG_KEY = 'lastOrgId';

/**
 * Sends `/` to a real organization URL.
 *
 * Every tenant-scoped page lives under `/organizations/:orgId/…` so the URL is
 * bookmarkable and shareable. That leaves `/` with no organization in it, so
 * something has to choose one: the last organization this browser used, falling
 * back to the first the user belongs to.
 *
 * localStorage is only a *convenience* here — it decides where to send someone
 * with no org in their URL, and nothing more. It is not an authorization input:
 * whatever id ends up in the URL is verified against `memberships` server-side
 * on every request. A stale or hand-edited value gets a 403, not someone else's
 * data.
 */
export function OrgRedirect() {
  const {
    data: organizations,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--color-bg)',
        }}
      >
        <p style={{ color: 'var(--color-text-muted)' }}>Loading workspace...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--color-bg)',
        }}
      >
        <p style={{ color: 'var(--color-danger)' }}>Failed to load workspace. Please refresh.</p>
      </div>
    );
  }

  if (!organizations?.length) return <Navigate to="/organizations/new" replace />;

  // Only trust the remembered id if the user is still a member — they may have
  // been removed, or be signed in as someone else on a shared browser.
  const remembered = localStorage.getItem(LAST_ORG_KEY);
  const target = organizations.some((o) => o.organizationId === remembered) ? remembered : organizations[0]!.organizationId;

  return <Navigate to={`/organizations/${target}`} replace />;
}
