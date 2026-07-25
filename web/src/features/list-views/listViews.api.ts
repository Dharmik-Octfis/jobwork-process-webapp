import { z } from 'zod';
import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

/** Prefix marking a column as a per-org custom field (mirrors the backend). */
export const CUSTOM_FIELD_PREFIX = 'cf:';

export const columnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Always shown, always first, never reorderable. */
  locked: z.boolean().optional(),
  defaultVisible: z.boolean().optional(),
});
export type ColumnDef = z.infer<typeof columnDefSchema>;

export const listViewSchema = z.object({
  /** Everything this org could show — built-ins plus its own custom fields. */
  catalog: z.array(columnDefSchema),
  /** Ordered keys actually shown. */
  visible: z.array(z.string()),
  /** Preset views for the "All Vendors ▾" picker. */
  filters: z.array(z.object({ key: z.string(), label: z.string() })),
});
export type ListView = z.infer<typeof listViewSchema>;

export async function fetchListView(orgId: string, entityType: string): Promise<ListView> {
  const res = await apiClient.get(endpoints.listViews(orgId, entityType));
  return listViewSchema.parse(res.data);
}

export async function saveListView(
  orgId: string,
  entityType: string,
  columns: string[],
): Promise<ListView> {
  const res = await apiClient.put(endpoints.listViews(orgId, entityType), { columns });
  return listViewSchema.parse(res.data);
}
