import { Compass, Home, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found — Agri AI" };

/**
 * Custom 404.
 *
 * Reached when a farmer follows a stale link, or when a route handler calls
 * `notFound()` — a diagnosis, post or community that no longer exists, or one
 * that belongs to somebody else (RLS makes those indistinguishable on purpose).
 *
 * So the wording does not say "this does not exist" — it says we could not find
 * it, which is true in both cases and does not confirm that someone else's record
 * is there.
 */
export default function NotFound() {
  return (
    <main className="bg-surface flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-12">
      <span className="bg-primary-soft flex size-16 items-center justify-center rounded-full">
        <Compass className="text-primary size-8" aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          We couldn&apos;t find that page
        </h1>
        <p className="text-muted max-w-md text-base">
          The link may be old, or the item may have been removed. Nothing has gone wrong
          with your account or your crop records.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/dashboard"
          className="bg-accent min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold text-white"
        >
          <Home className="size-5" aria-hidden="true" />
          Go to my dashboard
        </Link>
        <Link
          href="/community"
          className="glass min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold"
        >
          <Search className="size-5" aria-hidden="true" />
          Browse communities
        </Link>
      </div>
    </main>
  );
}
