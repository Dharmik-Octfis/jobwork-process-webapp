import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { reportsApi, reportsCenterQueryKey, type ReportKey } from './reports.api';

/**
 * Stamp "last visited" once per opening of a report page. Every report listed in
 * the Reports Center calls this — a page that forgets shows "—" forever.
 *
 * Deliberately not tied to the report's own fetch: re-filtering or paging is not
 * a new visit. A failure is swallowed — it must never disturb the report itself.
 */
export function useRecordReportVisit(orgId: string | undefined, reportKey: ReportKey): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;
    reportsApi
      .recordVisit(orgId, reportKey)
      .then(() => queryClient.invalidateQueries({ queryKey: reportsCenterQueryKey(orgId) }))
      .catch(() => undefined);
  }, [orgId, reportKey, queryClient]);
}
