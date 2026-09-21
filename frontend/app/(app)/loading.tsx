import { LoadingBlock } from "@/components/ui/skeleton";

/**
 * Loading state for every signed-in route.
 *
 * Lives at the `(app)` group so the bottom tab bar / desktop sidebar stay put
 * while the page content loads — navigation that vanishes during a load feels
 * broken, especially on a slow rural connection.
 *
 * Individual routes override this when their content has a distinct shape (the
 * dashboard, a feed, a diagnosis).
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <div className="flex flex-col gap-2">
        <div
          className="bg-border/60 h-7 w-48 animate-pulse rounded-[8px]"
          aria-hidden="true"
        />
        <div
          className="bg-border/60 h-4 w-72 animate-pulse rounded-[8px]"
          aria-hidden="true"
        />
      </div>
      <LoadingBlock label="Loading…" rows={3} />
    </div>
  );
}
