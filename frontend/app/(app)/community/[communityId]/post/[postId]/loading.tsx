import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Post-detail loading state: the post, then its replies. */
export default function PostLoading() {
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
        Loading this post…
      </p>

      <SkeletonCard lines={3} />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28" />
        <SkeletonCard lines={2} />
        <Skeleton className="h-tap rounded-card w-full" />
      </div>
    </div>
  );
}
