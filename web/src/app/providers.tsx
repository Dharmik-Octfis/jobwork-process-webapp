import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider } from '../providers/AuthProvider';
import { queryClient } from './queryClient';
import { Toaster } from 'react-hot-toast';

/** Wraps the app in its global providers (server state + auth). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
      <Toaster position="top-center" />
    </>
  );
}
