import {
  CloudRain,
  CloudSun,
  Droplets,
  MapPin,
  Sprout,
  Sun,
  Thermometer,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth/session";
import type { Weather } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Weather — Agri AI",
};

/**
 * The weather screen: IMD's 7-day city forecast for the farmer's region, plus
 * the advisories derived from it.
 *
 * Data path: this is a Server Component, so the forecast is fetched on the
 * server through `serverApiFetch` (the farmer's own session) and arrives as
 * props-free HTML — one round trip on a rural connection, no client-side
 * spinner, and the loading skeleton in `loading.tsx` covers the wait.
 *
 * Failure states are distinct on purpose:
 *   no region set      → a "set your region" card (farmer action fixes it);
 *   unresolvable state → the same card, with the reason;
 *   IMD down/no key    → an honest "weather unavailable" card with a retry.
 * A failed weather card never breaks the rest of the screen — the advisory is
 * supplementary, exactly like the outbreak banner.
 */
export default async function WeatherPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // The backend resolves `users.region` itself; this fetch is authenticated as
  // the farmer. A 4xx/5xx becomes `null` and the page renders a state card.
  const weather = await serverApiFetch<Weather>("/api/weather");

  if (!weather) {
    const hasRegion = Boolean(profile.region?.trim());
    return (
      <StateCard
        icon={MapPin}
        title={hasRegion ? "Weather isn't available right now" : "No region set yet"}
        body={
          hasRegion
            ? "The weather service may be busy or not yet configured. Your crop checks and assistant still work normally — please try again a little later."
            : "Weather advisories need to know where you farm. Add your region in Settings and this page will show your local IMD forecast."
        }
        cta={hasRegion ? undefined : { href: "/settings", label: "Open Settings" }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Weather</h1>
        <p className="text-muted text-base">
          {weather.region} area · IMD forecast for {weather.station_name}
        </p>
      </header>

      {/* ---- Advisories first: they are the reason this screen exists. ---- */}
      {weather.advisories.length > 0 ? (
        <section aria-label="Farm advisories" className="flex flex-col gap-3">
          {weather.advisories.map((a) => (
            <article
              key={a.title}
              className="rounded-card border-warning-border bg-warning-bg flex flex-col gap-2 border p-4"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert
                  className="text-warning mt-0.5 size-5 shrink-0"
                  aria-hidden="true"
                />
                <div className="flex flex-col gap-1">
                  <h2 className="text-warning font-semibold">{a.title}</h2>
                  <p className="text-warning text-sm font-medium">{a.title_hi}</p>
                </div>
              </div>
              <p className="text-base">{a.detail}</p>
              <p className="text-muted text-base">{a.detail_hi}</p>
              {a.day_labels.length > 0 && (
                <p className="text-muted text-sm">Concerns: {a.day_labels.join(", ")}</p>
              )}
            </article>
          ))}
        </section>
      ) : (
        <section
          aria-label="Farm advisories"
          className="rounded-card glass shadow-card flex items-start gap-3 p-4"
        >
          <Sprout className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-base">
            No weather alerts for the next week. A good window for normal field work.
          </p>
        </section>
      )}

      {/* ---- The 7-day strip ---- */}
      <section aria-label="7-day forecast" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Next 7 days</h2>
        <ul className="flex flex-col gap-2">
          {weather.days.map((day) => {
            const rainy = day.rain_expected;
            return (
              <li
                key={day.label}
                className="rounded-card glass shadow-card flex items-center gap-4 p-4"
              >
                {rainy ? (
                  <CloudRain
                    className="text-primary size-6 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <CloudSun className="text-muted size-6 shrink-0" aria-hidden="true" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{day.label}</span>
                  <span className="text-muted truncate text-sm">
                    {day.weather || "—"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-base">
                  {day.min_temp_c !== null && (
                    <span className="text-muted inline-flex items-center gap-1">
                      <Droplets className="size-4" aria-hidden="true" />
                      {Math.round(day.min_temp_c)}°
                    </span>
                  )}
                  {day.max_temp_c !== null && (
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <Thermometer className="size-4" aria-hidden="true" />
                      {Math.round(day.max_temp_c)}°
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-muted flex items-start gap-2 text-sm">
        <Sun className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Forecast from the India Meteorological Department (city level,{" "}
          {weather.station_name}
          {weather.observed_at ? ` · issued ${weather.observed_at}` : ""}). District-level
          accuracy varies — check IMD&apos;s local bulletin before major decisions, and
          confirm spray timing with your KVK.
        </span>
      </p>

      {weather.fetched_at && (
        <p className="text-muted text-xs">
          Fetched {timeAgo(weather.fetched_at)} · cached up to 30 minutes
        </p>
      )}
    </div>
  );
}

function StateCard({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon: typeof MapPin;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-6">
      <div className="rounded-card glass shadow-card flex flex-col items-start gap-4 p-5">
        <div className="flex items-start gap-3">
          <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold">{title}</h1>
            <p className="text-muted text-base">{body}</p>
          </div>
        </div>
        {cta && (
          <Link
            href={cta.href}
            className="min-h-tap rounded-card bg-accent inline-flex items-center justify-center gap-2 px-6 font-semibold text-white"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
