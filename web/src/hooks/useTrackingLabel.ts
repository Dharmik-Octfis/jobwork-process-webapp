import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../features/organizations/organizations.api';

export function useTrackingLabel() {
  const { orgId } = useParams<{ orgId: string }>();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  const activeOrg = organizations?.find((o) => o.organizationId === orgId);
  const settings = activeOrg?.settings?.itemTrackingLabel;

  const singular = settings?.singular || 'Batch';
  const plural = settings?.plural || 'Batches';

  return {
    singular,
    plural,
    // Helper for placeholders
    getPlaceholder: () => `Find ${singular} Number`,
  };
}
