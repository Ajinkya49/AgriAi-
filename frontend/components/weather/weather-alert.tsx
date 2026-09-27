import { CloudSun, TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { WeatherAdvisory } from "@/lib/api";

/**
 * Dashboard weather-advisory banner.
 *
 * WHY IT EXISTS
 * -------------
 * The dashboard is the screen a farmer opens first. A "spray before Thursday's
 * rain" or "41° on Friday" signal is only worth anything if it reaches them
 * before the day it concerns — a farmer who must visit the Weather tab to
 * discover a heat warning has already lost the warning's value. This surfaces
 * the highest-severity advisories from the IMD forecast on Home.
 *
 * RENDERS NOTHING IN THE COMMON CASES
 * -----------------------------------
 * Same discipline as the outbreak banner: absence of news is not news. The
 * banner appears only when there is at least one active advisory; a benign
 * forecast renders nothing, and a failed/unconfigured weather service renders
 * nothing either — weather is supplementary, and a permanent "weather is down"
 * card on Home would just train people to ignore it. The /weather page carries
 * the full explanation and the error states.
 *
 * NOT DISMISSIBLE, ON PURPOSE
 * ---------------------------
 * Mirrors `OutbreakAlert`: short-lived, safety-relevant, and only present when
 * something is genuinely worth acting on. If it ever becomes noisy, the fix is
 * the advisory thresholds in `backend/app/weather/advisory.py`, not a dismiss
 * button.
 */
export function WeatherAlert({
  advisories,
  region,
}: {
  advisories: WeatherAdvisory[];
  region?: string | null;
}) {
  if (advisories.length === 0) return null;

  // Cap at two: more than that is a wall, not a warning. The Weather tab has
  // the full list.
  const shown = advisories.slice(0, 2);
  const place = region?.trim() || "your area";
  const one = shown.length === 1;

  return (
    <section
      aria-labelledby="weather-heading"
      className="rounded-card border-warning-border bg-warning-bg flex flex-col gap-3 border p-4"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          className="text-warning mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <h2 id="weather-heading" className="text-warning font-semibold">
            Weather alert for {place}
          </h2>
          <p className="text-muted text-sm">
            {one ? "An advisory from" : "Advisories from"} the IMD forecast.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((a) => (
          <li
            key={a.title}
            className="border-border flex flex-col gap-0.5 border-t pt-2 first:border-t-0 first:pt-0"
          >
            <span className="font-semibold">
              {a.title} <span className="text-warning">· {a.day_labels.join(", ")}</span>
            </span>
            <span className="text-sm">{a.detail}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/weather"
        className="min-h-tap rounded-card border-warning-border text-warning inline-flex items-center justify-center gap-2 border px-5 font-semibold"
      >
        <CloudSun className="size-4 shrink-0" aria-hidden="true" />
        See the full forecast
      </Link>
    </section>
  );
}
