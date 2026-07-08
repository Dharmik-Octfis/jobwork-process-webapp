import { QueryClient } from '@tanstack/react-query';

/** App-wide React Query client (server-state cache; architecture §3.16). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
