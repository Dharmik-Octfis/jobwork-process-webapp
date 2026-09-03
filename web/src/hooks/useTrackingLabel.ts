import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../features/organizations/organizations.api';
import type { Organization } from '../features/organizations/organizations.schemas';

/** The active organization's settings bag, or undefined while it loads. */
function useOrgSettings(): Organization['settings'] {
  const { orgId } = useParams<{ orgId: string }>();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  return organizations?.find((o) => o.organizationId === orgId)?.settings;
}

export function useTrackingLabel() {
  const settings = useOrgSettings()?.itemTrackingLabel;

  const singular = settings?.singular || 'Batch';
  const plural = settings?.plural || 'Batches';

  return {
    singular,
    plural,
    // Helper for placeholders
    getPlaceholder: () => `Find ${singular} Number`,
  };
}

/**
 * The level BELOW a batch — a taka, roll, bale, coil, plate — and whether this
 * organization runs one at all.
 *
 * 🔴 `enabled` gates the level's very existence on screen, so every caller must
 * branch on it before rendering anything: an org that has not switched it on must
 * see the batch grid exactly as it was. The labels default to "Taka"/"Takas"
 * rather than to something generic because the setting is unreachable until an
 * admin has typed real ones, and a placeholder that reads "Unit" would ship as
 * the label nobody noticed was wrong.
 *
 * A sibling of `useTrackingLabel`, sharing its cached `['organizations']` query,
 * so a screen showing both labels still makes one request.
 */
export function useBatchUnitLabel() {
  const settings = useOrgSettings()?.batchUnit;

  return {
    enabled: settings?.enabled === true,
    singular: settings?.singular || 'Taka',
    plural: settings?.plural || 'Takas',
  };
}
