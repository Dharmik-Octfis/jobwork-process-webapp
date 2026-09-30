import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../features/organizations/organizations.api';

/** The active organization's name, or '' while it loads. Shares the cached `['organizations']` query. */
export function useOrganizationName(): string {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });
  return organizations?.find((o) => o.organizationId === orgId)?.name ?? '';
}
