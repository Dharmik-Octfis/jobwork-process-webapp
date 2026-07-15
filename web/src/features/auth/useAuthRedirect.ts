import { useNavigate } from 'react-router-dom';
import { organizationsApi } from '../organizations/organizations.api';

/**
 * Provides a function to fetch user's organizations and redirect them
 * either to the dashboard or to the organization onboarding page.
 */
export function useAuthRedirect() {
  const navigate = useNavigate();

  const redirectAfterAuth = async (defaultRedirect = '/') => {
    try {
      const orgs = await organizationsApi.getOrganizations();
      if (orgs.length === 0) {
        navigate('/organizations/new', { replace: true });
      } else {
        navigate(defaultRedirect, { replace: true });
      }
    } catch (err) {
      console.error('Failed to fetch organizations during redirect:', err);
      // Fallback to the default route if there's a network error
      navigate(defaultRedirect, { replace: true });
    }
  };

  return redirectAfterAuth;
}
