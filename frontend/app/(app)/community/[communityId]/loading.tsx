import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Community-feed-shaped loading state: header, composer CTA, then posts. */
export default function CommunityFeedLoading() {
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
        Loading posts…
      </p>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Skeleton className="h-tap rounded-card w-full" />

      <div className="flex flex-col gap-3">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
