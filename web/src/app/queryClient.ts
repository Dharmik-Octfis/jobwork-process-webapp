import { QueryClient, MutationCache } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { toApiErrorMessage } from '../api/client';

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
      const errorMessage = toApiErrorMessage(error);
      toast.error(errorMessage, { id: errorMessage });
    },
  }),
});
