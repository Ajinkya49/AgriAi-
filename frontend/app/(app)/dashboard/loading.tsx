import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Dashboard-shaped loading state: greeting, CTA, then the history list. */
export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6"
    >
      <p className="text-muted flex items-center gap-2 text-base">
        <span
          aria-hidden="true"
          className="border-border border-t-primary size-4 shrink-0 animate-spin rounded-full border-2"
        />
        Loading your dashboard…
      </p>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>

      <Skeleton className="rounded-card h-[92px] w-full" />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
