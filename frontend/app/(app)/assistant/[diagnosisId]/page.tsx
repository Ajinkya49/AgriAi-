import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import type { Diagnosis } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Assistant — Agri AI" };

/**
 * The assistant, opened from a diagnosis result.
 *
 * The diagnosis is passed through as context so a short follow-up like "what
 * should I do about it?" still retrieves the right knowledge — the backend
 * augments the search query with the crop and condition.
 */
export default async function AssistantWithContextPage({
  params,
}: {
  params: Promise<{ diagnosisId: string }>;
}) {
  const { diagnosisId } = await params;
  const diagnosis = await serverApiFetch<Diagnosis>(`/api/diagnoses/${diagnosisId}`);

  if (!diagnosis) notFound();

  const displayName = diagnosis.predicted_disease.replace(
    `${diagnosis.crop_type} - `,
    "",
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href={`/diagnosis/${diagnosis.id}`}
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Back to your result
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Ask about this result</h1>
        <p className="text-muted text-base">
          {diagnosis.crop_type} · {displayName} ·{" "}
          {Math.min(99, Math.floor(diagnosis.confidence_score * 100))}% confidence
        </p>
      </header>

      <AssistantChat
        diagnosisId={diagnosis.id}
        contextLabel={`${diagnosis.crop_type} — ${displayName}`}
      />
    </div>
  );
}
