import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { relativeDays, type Outbreak } from "@/lib/outbreaks";

/**
 * "Disease spreading near you" banner for the dashboard.
 *
 * WHY IT EXISTS
 * -------------
 * A farmer can only see their own diagnoses. Three neighbours independently
 * finding Late Blight in the same fortnight is a signal none of them can see
 * alone, and it is the most useful thing the app can tell them: act now, before
 * it reaches your field. This surfaces that aggregate.
 *
 * RENDERS NOTHING WHEN EMPTY
 * --------------------------
 * There is deliberately no "no outbreaks" state. A banner that says "nothing to
 * report" every day trains people to ignore it, which is exactly the failure
 * that would make the real alert useless. Absence of news is not news.
 *
 * NOT DISMISSIBLE, ON PURPOSE
 * ---------------------------
 * This is safety-relevant and short-lived. A dismissible version would be gone
 * after the first tap and never seen again — and unlike a nudge, there is no
 * annoyance cost to justify it, because it only appears when something is
 * genuinely spreading. If it ever becomes noisy, the fix is the threshold in
 * `regional_outbreaks()`, not a dismiss button.
 *
 * Mobile-first: the rows stack, the text is `text-base` (16px, per the brief),
 * and the call to action is a full tap target.
 */
export function OutbreakAlert({
  outbreaks,
  region,
}: {
  outbreaks: Outbreak[];
  region?: string | null;
}) {
  if (outbreaks.length === 0) return null;

  // Cap at three. More than that stops being a warning and becomes a wall the
  // farmer scrolls past to reach their own history.
  const shown = outbreaks.slice(0, 3);
  const place = region?.trim() || "your area";
  const one = shown.length === 1;

  return (
    <section
      aria-labelledby="outbreak-heading"
      className="rounded-card border-warning-border bg-warning-bg flex flex-col gap-3 border p-4"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          className="text-warning mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <h2 id="outbreak-heading" className="text-warning font-semibold">
            Disease spreading near you
          </h2>
          <p className="text-base">
            Other farmers in {place} have reported {one ? "this" : "these"} recently.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((o) => (
          <li
            key={`${o.crop_type}-${o.predicted_disease}`}
            className="border-border flex flex-col gap-0.5 border-t pt-2 first:border-t-0 first:pt-0"
          >
            <span className="font-semibold">
              {o.display_disease} <span className="text-warning">· {o.crop_type}</span>
            </span>
            {/* Always plural: `regional_outbreaks()` enforces a floor of 3
                distinct farmers, so a count below that cannot reach the UI. */}
            <span className="text-muted text-sm">
              {o.farmer_count} farmers reported it
              {relativeDays(o.last_reported_at)
                ? ` · latest ${relativeDays(o.last_reported_at)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm">
        Check your {one ? shown[0].crop_type : "crops"} now — acting early is easier than
        treating it later.
      </p>

      <Link
        href="/upload"
        className="min-h-tap rounded-card border-warning-border text-warning inline-flex items-center justify-center gap-2 border px-5 font-semibold"
      >
        Check a crop
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>
    </section>
  );
}
