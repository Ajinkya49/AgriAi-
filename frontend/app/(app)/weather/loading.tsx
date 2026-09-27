import { LoadingBlock } from "@/components/ui/skeleton";

/**
 * Weather-shaped skeleton: a title, an advisory-sized card, then the 7-day
 * rows. Rendered by the (app) shell while the server fetch runs, so the tab
 * bar stays put on a slow connection.
 */
export default function WeatherLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <div className="flex flex-col gap-2">
        <div
          className="bg-border/60 h-7 w-40 animate-pulse rounded-[8px]"
          aria-hidden="true"
        />
        <div
          className="bg-border/60 h-4 w-64 animate-pulse rounded-[8px]"
          aria-hidden="true"
        />
      </div>
      <LoadingBlock label="Loading weather…" rows={4} />
    </div>
  );
}
