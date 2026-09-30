/**
 * Fetches a lightweight { id, label } list for a given related module
 * (e.g. 'member', 'vendor', 'item', 'customer', 'job_order', …).
 *
 * Automatically pages through paginated backend endpoints so organizations with
 * >500 records (e.g. 501, 1000+) receive all records in full.
 *
 * Results are cached per orgId + module for 2 minutes. On error the hook
 * returns an empty list so the parent can fall back to a plain text input.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../api/client';
import { endpoints } from '../../../../api/endpoints';
import { membersApi } from '../../../members/members.api';

export interface FkOption {
  id: string;
  label: string;
}

/**
 * Paginates through all pages of an endpoint (each page up to 500 records)
 * to return all records for the dropdown without capping at 500.
 */
async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ results?: T[]; pageContext?: { hasMore: boolean } } | T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    const res = await fetchPage(page);
    if (Array.isArray(res)) {
      all.push(...res);
      break;
    }
    const results = res?.results ?? [];
    all.push(...results);
    hasMore = Boolean(res?.pageContext?.hasMore && results.length > 0);
    page++;
  }
  return all;
}

async function fetchFkOptions(orgId: string, relatedModule: string): Promise<FkOption[]> {
  try {
    switch (relatedModule) {
      // ── Members / Users (Active Only) ───────────────────────────────────
      case 'member':
      case 'user': {
        const items = await fetchAllPages(async (page) => {
          return await membersApi.list(orgId, { filter: 'all', page, perPage: 500 });
        });

        return (items as { id?: string; userId?: string; fullName?: string; email?: string; status?: string; isActive?: boolean; kind?: string }[])
          .filter((m) => m.kind !== 'invite' && (m.status === 'active' || m.isActive === true))
          .map((m) => ({
            id: (m.userId ?? m.id ?? ''),
            label: m.fullName || m.email || m.id || '',
          }))
          .filter((m) => Boolean(m.id && m.label));
      }

      // ── Vendors (Active Only) ───────────────────────────────────────────
      case 'vendor': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; contactName?: string; companyName?: string; status?: string; isActive?: boolean }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.purchases.vendors(orgId)}?filter=active&page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((v) => v.isActive !== false && (!v.status || v.status.toLowerCase() === 'active' || v.status.toLowerCase() === 'approved'))
          .map((v) => ({ id: v.id, label: v.contactName || v.companyName || v.id }));
      }

      // ── Customers (Active Only) ─────────────────────────────────────────
      case 'customer': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; contactName?: string; companyName?: string; status?: string; isActive?: boolean }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.sales.customers(orgId)}?filter=active&page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((c) => c.isActive !== false && (!c.status || c.status.toLowerCase() === 'active' || c.status.toLowerCase() === 'approved'))
          .map((c) => ({ id: c.id, label: c.contactName || c.companyName || c.id }));
      }

      // ── Items (Active Only) ─────────────────────────────────────────────
      case 'item': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; name?: string; sku?: string; isActive?: boolean; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.seedData.items(orgId)}?filter=active&page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((i) => i.isActive !== false && i.status !== 'inactive')
          .map((i) => ({ id: i.id, label: i.name ? (i.sku ? `${i.name} (${i.sku})` : i.name) : i.id }));
      }

      // ── Job Orders ─────────────────────────────────────────────────────
      case 'job_order': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; jobOrderNumber?: string; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.jobwork.jobOrders(orgId)}?page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((j) => j.status?.toUpperCase() !== 'CANCELLED')
          .map((j) => ({ id: j.id, label: j.jobOrderNumber || j.id }));
      }

      // ── Job Issues / Challans ──────────────────────────────────────────
      case 'job_issue': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; issueNumber?: string; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.jobwork.issues(orgId)}?page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((j) => j.status?.toUpperCase() !== 'CANCELLED')
          .map((j) => ({ id: j.id, label: j.issueNumber || j.id }));
      }

      // ── Job Receipts ───────────────────────────────────────────────────
      case 'job_receipt': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; receiptNumber?: string; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.jobwork.receipts(orgId)}?page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((r) => r.status?.toUpperCase() !== 'CANCELLED')
          .map((r) => ({ id: r.id, label: r.receiptNumber || r.id }));
      }

      // ── Bills ──────────────────────────────────────────────────────────
      case 'bill': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; billNumber?: string; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.purchases.bills(orgId)}?page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((b) => b.status?.toUpperCase() !== 'CANCELLED' && b.status?.toUpperCase() !== 'VOID')
          .map((b) => ({ id: b.id, label: b.billNumber || b.id }));
      }

      // ── Purchase Orders ────────────────────────────────────────────────
      case 'purchase_order': {
        const rows = await fetchAllPages(async (page) => {
          const { data } = await apiClient.get<{ results?: { id: string; poNumber?: string; status?: string }[]; pageContext?: { hasMore: boolean } }>(
            `${endpoints.purchases.purchaseOrders(orgId)}?page=${page}&perPage=500`,
          );
          return data;
        });

        return rows
          .filter((p) => p.status?.toUpperCase() !== 'CANCELLED')
          .map((p) => ({ id: p.id, label: p.poNumber || p.id }));
      }

      // ── Locations ──────────────────────────────────────────────────────
      case 'location': {
        const { data } = await apiClient.get<unknown[] | { results?: unknown[] }>(
          endpoints.configuration.locations(orgId),
        );
        const rows = Array.isArray(data) ? data : (data?.results ?? []);
        return (rows as { id: string; name?: string; isActive?: boolean; is_active?: boolean; type?: string }[])
          .filter(
            (l) =>
              l.isActive !== false &&
              l.is_active !== false &&
              l.type?.toLowerCase() !== 'processor'
          )
          .map((l) => ({ id: l.id, label: l.name || l.id }));
      }

      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * React Query hook — returns `{ options, isLoading }` for a foreign-key field.
 * Pass `relatedModule = null | undefined` to skip (hook returns empty array instantly).
 */
export function useFkLookupOptions(
  orgId: string | undefined,
  relatedModule: string | null | undefined,
): { options: FkOption[]; isLoading: boolean } {
  const result = useQuery({
    queryKey: ['fk-options', orgId, relatedModule],
    queryFn: () => fetchFkOptions(orgId!, relatedModule!),
    enabled: !!orgId && !!relatedModule,
    staleTime: 2 * 60 * 1000,
    placeholderData: [],
  });

  return {
    options: (result.data ?? []) as FkOption[],
    isLoading: result.isLoading,
  };
}
