import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Processes and Process Routes moved from the main sidebar to Settings on
 * 2026-08-10. Same reasoning as `settings/members` → `settings/users`: the old
 * URLs are in bookmarks and in links already sent around, and a 404 there reads
 * as "the feature was removed".
 *
 * One splat route per master covers the list, `new`, and `:id/edit`, and `?id=`
 * survives because the search string is carried over.
 */
export function LegacyJobworkMasterRedirect() {
  const { orgId } = useParams<{ orgId: string }>();
  const location = useLocation();
  const suffix = location.pathname.split(`/organizations/${orgId}/jobwork/`)[1] ?? '';
  return (
    <Navigate to={`/organizations/${orgId}/settings/jobwork/${suffix}${location.search}`} replace />
  );
}
