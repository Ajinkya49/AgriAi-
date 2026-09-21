"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import { getDependencyHealth } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Development-only connectivity panel.
 *
 * Confirms from the browser that the API and Supabase are reachable — the two
 * failures that otherwise show up as a blank screen with no clue why. Rendered
 * only when NODE_ENV is development (see app/page.tsx), so it never reaches
 * production.
 */
export function SystemStatus() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dependency-health"],
    queryFn: getDependencyHealth,
  });

  const rows = [
    {
      label: "Frontend",
      ok: true,
      value: "running",
      detail: "Next.js App Router + TypeScript + Tailwind CSS",
    },
    {
      label: "Backend API",
      ok: !isError && Boolean(data),
      value: isLoading
        ? "checking…"
        : isError
          ? "unreachable"
          : (data?.status ?? "unknown"),
      detail: isError
        ? `Could not reach the API. Is uvicorn running on port 8000? (${String(error)})`
        : `Agri AI API · model ${data?.model.version ?? "—"} · RAG index ${
            data?.rag.loaded ? "loaded" : "not loaded"
          }`,
    },
    {
      label: "Supabase",
      ok: isSupabaseConfigured,
      value: isSupabaseConfigured ? "configured" : "not configured",
      detail: isSupabaseConfigured
        ? (data?.supabase.detail ?? "checking…")
        : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend/.env.local",
    },
  ];

  return (
    <section className="glass mx-auto w-full max-w-3xl rounded-3xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <CheckCircle2 className="text-primary size-5 shrink-0" aria-hidden="true" />
        <h2 className="font-semibold">System status</h2>
        <span className="text-muted ml-auto text-xs">development only</span>
      </div>

      <dl className="grid gap-3 text-base">
        {rows.map((row) => (
          <div
            key={row.label}
            className="border-border flex flex-col gap-0.5 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="w-32 shrink-0 font-semibold">{row.label}</dt>
            <dd className="flex flex-col gap-0.5">
              <span className={cn(row.ok ? "text-primary" : "text-muted")}>
                {row.value}
              </span>
              <span className="text-muted text-sm">{row.detail}</span>
            </dd>
          </div>
        ))}
      </dl>

      {isError && (
        <p className="bg-danger-bg text-danger mt-4 flex items-start gap-2 rounded-2xl p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            The backend did not respond. Start it with{" "}
            <code className="bg-surface-3 rounded px-1 py-0.5">
              uvicorn app.main:app --reload --port 8000
            </code>
            .
          </span>
        </p>
      )}

      {isLoading && (
        <p className="text-muted mt-4 flex items-center gap-2 text-sm">
          <CircleDashed className="size-4 animate-spin" aria-hidden="true" />
          Checking dependencies…
        </p>
      )}
    </section>
  );
}
