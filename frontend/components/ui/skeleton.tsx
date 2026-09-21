import { cn } from "@/lib/utils";

/**
 * Loading skeletons.
 *
 * The design brief requires loading to be communicated with both a visual cue and
 * text, because colour and animation alone do not convey state to every user.
 * Skeletons therefore always sit next to a readable label, and `aria-busy` plus a
 * live region announce the state to a screen reader.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      // `shimmer` sweeps a violet highlight across the block; the flat
      // `bg-surface-3` underneath keeps it visible if animation is disabled.
      className={cn("bg-surface-3 shimmer rounded-[8px]", className)}
    />
  );
}

/** A card-shaped placeholder matching the app's card pattern. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="glass rounded-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3.5", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/**
 * A labelled loading block. Use this for any screen that fetches before it can
 * render anything meaningful.
 */
export function LoadingBlock({
  label = "Loading…",
  rows = 3,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading"
      className={cn("flex flex-col gap-4", className)}
    >
      <p className="text-muted flex items-center gap-2 text-base">
        <span
          aria-hidden="true"
          className="border-border border-t-primary size-4 shrink-0 animate-spin rounded-full border-2"
        />
        {label}
      </p>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
