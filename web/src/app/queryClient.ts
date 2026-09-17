import { QueryClient, MutationCache } from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { toApiErrorMessage } from '../api/client';

/**
 * The one error toast a failed mutation gets. A screen's own `onError` highlights
 * fields and must not toast again — two toasts for one failure is the bug this
 * prevents. Opt out with `meta: { suppressToast: true }` when a screen shows the
 * error somewhere else instead.
 */
function mutationErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // "Please check the highlighted fields" names no field — lead with the first one's reason.
    const details = (error.response?.data as { details?: Record<string, unknown> } | undefined)
      ?.details;
    const first = Object.values(details ?? {}).find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );
    if (first) return first;
  }
  return toApiErrorMessage(error);
}

/** App-wide React Query client (server-state cache; architecture §3.16). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      /**
       * 🔴 ON since 2026-09-07, and `staleTime` is what keeps it cheap: a focus
       * refetch only fires for queries already older than 30s, so tabbing back and
       * forth costs nothing.
       *
       * Invalidation is per app instance — a challan posted in one browser tab
       * cannot reach the cache in another — so a second tab left open on the Item
       * page showed a balance from before the issue for as long as it stayed
       * mounted. Focus is the only signal that tab gets. Queries that genuinely
       * must not refetch (the typeahead pickers) opt out where they are declared.
       */
      refetchOnWindowFocus: true,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Allow specific mutations to opt out of global toasts via meta
      if (mutation.meta?.suppressToast) return;
      const message = mutationErrorMessage(error);
      toast.error(message, { id: message });
    },
  }),
});
