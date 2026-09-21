import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { AuthProvider } from '../providers/AuthProvider';
import { queryClient } from './queryClient';
import { Toaster, toast, useToasterStore } from 'react-hot-toast';

/**
 * Only one error toast on screen, app-wide: a newer error replaces the older one.
 * Enforced here rather than at each `toast.error` call, so no screen can stack two.
 */
function SingleErrorToast() {
  const { toasts } = useToasterStore();
  useEffect(() => {
    // Newest first — react-hot-toast prepends each new toast.
    toasts
      .filter((t) => t.type === 'error' && t.visible)
      .slice(1)
      .forEach((t) => toast.dismiss(t.id));
  }, [toasts]);
  return null;
}

/** Wraps the app in its global providers (server state + auth). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
      <Toaster position="top-center" />
      <SingleErrorToast />
    </>
  );
}
