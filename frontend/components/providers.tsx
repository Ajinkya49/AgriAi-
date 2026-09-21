"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Client-side provider tree.
 *
 * React Query is the data-fetching/caching layer named in the TRD. It is set up
 * in Phase 1 so feature phases can simply call `useQuery`/`useMutation`.
 *
 * The client is created inside `useState` so it is never shared between requests
 * during server rendering.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Mobile users on moderate connectivity: avoid refetching on every
            // window focus, which is both wasteful and jarring.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
