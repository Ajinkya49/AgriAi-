import {
  Camera,
  CloudSun,
  MessageCircle,
  Sprout,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OutbreakAlert } from "@/components/diagnosis/outbreak-alert";
import { WeatherAlert } from "@/components/weather/weather-alert";
import { getProfile } from "@/lib/auth/session";
import { getRegionalOutbreaks } from "@/lib/outbreaks";
import type { Weather } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import { confidenceBand, confidencePercent, formatConfidence } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard — Agri AI",
};

type DiagnosisRow = {
  id: string;
  crop_type: string;
  predicted_disease: string;
  confidence_score: number;
  created_at: string;
};

const BAND_CLASS: Record<ReturnType<typeof confidenceBand>, string> = {
  high: "bg-confidence-high",
  medium: "bg-confidence-medium",
  low: "bg-confidence-low",
};

export default async function DashboardPage() {
  const profile = await getProfile();

  // All three run concurrently: the outbreak alert, the weather banner and the
  // history query are independent, and on a rural connection the extra
  // round-trips should overlap rather than queue. A failed weather fetch
  // degrades to `null` — the banner simply does not render.
  const supabase = await createClient();
  const [diagnosesResult, outbreaks, weather] = await Promise.all([
    supabase
      .from("diagnoses")
      .select("id, crop_type, predicted_disease, confidence_score, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    getRegionalOutbreaks(),
    serverApiFetch<Weather>("/api/weather"),
  ]);

  const rows = (diagnosesResult.data ?? []) as DiagnosisRow[];
  const firstName = (profile?.name ?? "").trim().split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Hello, {firstName}</h1>
        <p className="text-muted text-base">
          {profile?.region
            ? `${profile.region}${profile.primary_crops?.length ? ` · ${profile.primary_crops.join(", ")}` : ""}`
            : "Tell us your region and crops in Profile to get more relevant guidance."}
        </p>
      </header>

      {/* Sits directly under the greeting, above the farmer's own history: it is
          the most time-sensitive thing on the screen. Renders nothing when there
          is nothing to report. */}
      <OutbreakAlert outbreaks={outbreaks} region={profile?.region} />

      {/* Same time-sensitive band, same render-nothing discipline. A 30-minute
          backend cache keeps this from adding latency on repeat visits. */}
      <WeatherAlert advisories={weather?.advisories ?? []} region={profile?.region} />

      {/* Same time-sensitive band, same render-nothing discipline. A 30-minute
          backend cache keeps this from adding latency on repeat visits. */}
      <WeatherAlert advisories={weather?.advisories ?? []} region={profile?.region} />

      {/* ---- Recent diagnoses ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your recent diagnoses</h2>

        {rows.length === 0 ? (
          <div className="rounded-card glass shadow-card flex flex-col items-start gap-4 p-5">
            <div className="flex items-start gap-3">
              <Camera
                className="text-primary mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-base">
                You haven&apos;t uploaded a crop photo yet — tap Upload to get your first
                diagnosis.
              </p>
            </div>
            <Link
              href="/upload"
              className="min-h-tap rounded-card bg-accent inline-flex items-center justify-center gap-2 px-6 font-semibold text-white"
            >
              <Camera className="size-5" aria-hidden="true" />
              Upload a photo
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((d) => {
              const band = confidenceBand(d.confidence_score);
              return (
                <li key={d.id}>
                  <Link
                    href={`/diagnosis/${d.id}`}
                    className="rounded-card glass shadow-card flex flex-col gap-2 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{d.predicted_disease}</span>
                      <span className="text-muted shrink-0 text-sm">
                        {new Date(d.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                    <p className="text-muted text-sm">{d.crop_type}</p>
                    <div className="flex items-center gap-2">
                      <div
                        className="bg-border h-2 w-24 overflow-hidden rounded-full"
                        role="img"
                        aria-label={`Confidence ${formatConfidence(d.confidence_score)}`}
                      >
                        <div
                          className={`h-full rounded-full ${BAND_CLASS[band]}`}
                          style={{ width: `${confidencePercent(d.confidence_score)}%` }}
                        />
                      </div>
                      <span className="text-muted text-sm">
                        {formatConfidence(d.confidence_score)} confidence
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Quick actions ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What would you like to do?</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickAction
            href="/upload"
            icon={Sprout}
            title="Check a crop"
            body="Take a photo and find out what is wrong."
          />
          <QuickAction
            href="/assistant"
            icon={MessageCircle}
            title="Ask the assistant"
            body="Get answers from trusted farming knowledge."
          />
          <QuickAction
            href="/community"
            icon={Users}
            title="Farmer community"
            body="See what other farmers are growing."
          />
          <QuickAction
            href="/weather"
            icon={CloudSun}
            title="Weather advisory"
            body="IMD forecast and spray-timing alerts for your region."
          />
        </div>
      </section>

      <p className="text-muted flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Agri AI predictions always come with a confidence score and never claim
          certainty. For anything serious, confirm with your local KVK or extension
          officer.
        </span>
      </p>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: typeof Camera;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="rounded-card glass shadow-card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <Icon className="text-primary size-5 shrink-0" aria-hidden="true" />
        <span className="font-semibold">{title}</span>
      </div>
      <p className="text-muted text-sm">{body}</p>
    </Link>
  );
}
