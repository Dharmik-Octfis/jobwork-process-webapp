import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchListView, saveListView, type ColumnDef } from '../features/list-views/listViews.api';

/**
 * The user's column layout for one module's list ("Customize Columns").
 *
 * `columns` is the resolved, ordered list the table should render — the visible
 * keys mapped back to their catalog entries — so a list component never has to
 * know about keys, only `columns.map(...)`. `catalog` is the full pick-list the
 * modal renders (built-ins + this org's custom fields).
 *
 * Query key includes orgId: switching organisation must not serve the previous
 * tenant's layout (its custom-field columns wouldn't even exist there).
 */
export function useListColumns(orgId: string | undefined, entityType: string) {
  const queryClient = useQueryClient();
  const queryKey = ['list-view', orgId, entityType];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchListView(orgId!, entityType),
    enabled: Boolean(orgId),
    /**
     * Overrides the app-wide 30s default (`app/queryClient.ts`) because this
     * payload is near-static and the request is expensive — it is a column
     * layout plus the org's custom-field catalog, and it costs six sequential
     * database round trips server-side.
     *
     * 30s bought nothing: the only writer that matters is the user's own save
     * below, which seeds the cache directly via `setQueryData`, so a refetch
     * would never show them anything they did not already have. The remaining
     * writer is an admin editing custom fields — five minutes is a fine bound
     * for a new column appearing, and matches what `customFields.api.ts` already
     * uses for the same underlying data.
     */
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: (columns: string[]) => saveListView(orgId!, entityType, columns),
    // The PUT returns the normalised layout (locked columns re-asserted), so seed
    // the cache with the server's answer rather than the optimistic input.
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
  });

  const catalog: ColumnDef[] = data?.catalog ?? [];
  const visible: string[] = data?.visible ?? [];
  /** Preset views for the list's filter dropdown, served alongside the columns. */
  const filters: { key: string; label: string }[] = data?.filters ?? [];

  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const columns = visible.map((k) => byKey.get(k)).filter((c): c is ColumnDef => Boolean(c));

  return { catalog, visible, filters, columns, isLoading, save: saveMutation };
}
