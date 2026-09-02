import { QueryClient, MutationCache } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { toApiErrorMessage } from '../api/client';

/** App-wide React Query client (server-state cache; architecture §3.16). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
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
