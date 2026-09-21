"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/state-message";

/**
 * Error boundary for every signed-in route.
 *
 * Catches render and data-fetch failures in the page below the app shell, so a
 * broken screen does not take the navigation with it — a farmer can move to
 * another tab rather than being stuck.
 *
 * The raw error is logged to the console for debugging but never shown: a stack
 * trace is meaningless to a farmer and can leak internals.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <ErrorState
        title="This screen didn't load"
        description="Something went wrong on our side. Your records are safe — please try again."
        onRetry={reset}
      />
    </div>
  );
}
