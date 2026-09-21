import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  MessageCircle,
  ShieldQuestion,
  Stethoscope,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfidenceIndicator } from "@/components/diagnosis/confidence-indicator";
import { SolutionTabs } from "@/components/diagnosis/solution-tabs";
import type { Diagnosis } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";
import { formatConfidence } from "@/lib/utils";

export const metadata: Metadata = { title: "Diagnosis — Agri AI" };

export default async function DiagnosisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const diagnosis = await serverApiFetch<Diagnosis>(`/api/diagnoses/${id}`);

  if (!diagnosis) notFound();

  const createdAt = new Date(diagnosis.created_at).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href="/dashboard"
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Back to dashboard
      </Link>

      {/* ---- Photo ---- */}
      <div className="rounded-card glass shadow-card overflow-hidden">
        {diagnosis.image_signed_url ? (
          // The bucket is private; this is a short-lived signed URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={diagnosis.image_signed_url}
            alt="The crop photo you submitted"
            className="max-h-80 w-full object-contain"
          />
        ) : (
          <p className="text-muted p-6 text-center text-base">
            We couldn&apos;t load your photo, but your result is saved below.
          </p>
        )}
      </div>

      {/* ---- Result ---- */}
      <section className="rounded-card glass shadow-card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-muted text-sm font-semibold tracking-wide uppercase">
            {diagnosis.crop_type}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            {diagnosis.is_healthy
              ? "Looks healthy"
              : diagnosis.predicted_disease.replace(`${diagnosis.crop_type} - `, "")}
          </h1>
          <p className="text-muted text-sm">
            Analysed {createdAt} · model {diagnosis.model_version}
          </p>
        </div>

        <ConfidenceIndicator
          score={diagnosis.confidence_score}
          band={diagnosis.confidence_band}
        />

        {/* A healthy prediction is only reassuring when the model is actually
            confident. At low confidence it must not read as an all-clear. */}
        {diagnosis.is_healthy && (
          <p className="rounded-card bg-primary-soft text-primary flex items-start gap-2 p-3 text-base">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>
              {diagnosis.confidence_band === "high"
                ? "No disease symptoms were detected in this photo. Keep monitoring your crop and check again if anything changes."
                : "The model did not find disease symptoms in this photo, but it is not confident about it. Look over the plant again, and ask your KVK if you are unsure."}
            </span>
          </p>
        )}

        {/* Low confidence is a normal result state, not an error — but it always
            carries a visible prompt to confirm with a human.
            NOTE: deliberately NOT gated on `!is_healthy`. A low-confidence
            "Healthy" is still a low-confidence result, and suppressing the warning
            there would tell a farmer with a sick crop that it looks fine. */}
        {diagnosis.needs_expert_confirmation && (
          <div className="rounded-card bg-traditional-bg text-traditional-text flex items-start gap-2 p-3 text-base">
            <ShieldQuestion className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold">
                {diagnosis.is_reliable
                  ? "The model is not fully certain"
                  : "The model is not confident about this photo"}
              </span>
              <span>
                Please confirm with your local KVK or extension officer before acting on
                this result.
              </span>
            </div>
          </div>
        )}

        {diagnosis.symptoms_summary && (
          <div className="border-border flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center gap-2">
              <Stethoscope className="text-primary size-5 shrink-0" aria-hidden="true" />
              <h2 className="font-semibold">What the model looked for</h2>
            </div>
            <p className="text-muted text-base">{diagnosis.symptoms_summary}</p>
          </div>
        )}

        {diagnosis.alternatives && diagnosis.alternatives.length > 0 && (
          <details className="border-border border-t pt-4">
            <summary className="text-primary cursor-pointer text-base font-semibold">
              Other possibilities the model considered
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {diagnosis.alternatives.map((alt) => (
                <li
                  key={alt.disease_name}
                  className="flex justify-between gap-3 text-base"
                >
                  <span className="text-muted">{alt.disease_name}</span>
                  <span className="text-muted shrink-0">
                    {formatConfidence(alt.confidence_score)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ---- Solutions ----
          Read from the curated `solutions` table. The LLM never generates these. */}
      {diagnosis.solutions && (
        <SolutionTabs
          solutions={diagnosis.solutions}
          heading={diagnosis.is_healthy ? "Keeping your crop healthy" : "What you can do"}
        />
      )}

      {/* ---- Actions ---- */}
      <section className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/assistant/${diagnosis.id}`}
          className="min-h-tap rounded-card bg-accent inline-flex flex-1 items-center justify-center gap-2 px-6 font-semibold text-white"
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          Ask the assistant
        </Link>
        <Link
          href={`/post/new?diagnosis=${diagnosis.id}`}
          className="min-h-tap rounded-card glass inline-flex flex-1 items-center justify-center gap-2 px-6 font-semibold"
        >
          <Users className="size-5" aria-hidden="true" />
          Share with community
        </Link>
      </section>

      <p className="text-muted flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          This is a prediction, not a diagnosis. Agri AI never claims certainty — the
          confidence score above tells you how much to rely on it.
        </span>
      </p>
    </div>
  );
}
