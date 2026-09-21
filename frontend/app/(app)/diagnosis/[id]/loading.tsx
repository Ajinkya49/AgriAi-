import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Diagnosis-shaped loading state: photo, result card, then the two solution tabs. */
export default function DiagnosisLoading() {
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
        Loading your result…
      </p>

      <Skeleton className="rounded-card h-64 w-full" />

      <div className="rounded-card glass shadow-card flex flex-col gap-4 p-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>

      <SkeletonCard lines={2} />
    </div>
  );
}
