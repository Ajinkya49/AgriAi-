import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PostForm } from "@/components/community/post-form";
import type { Community, Diagnosis } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "New post — Agri AI" };

/**
 * Create a post.
 *
 * Reached from a community feed (`?community=<id>`) or from a diagnosis result via
 * "Share with community" (`?diagnosis=<id>`), which attaches the result so the
 * thread has evidence in it.
 */
export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string; diagnosis?: string }>;
}) {
  const { community: communityParam, diagnosis: diagnosisParam } = await searchParams;

  const [communitiesData, diagnosis] = await Promise.all([
    serverApiFetch<{ items: Community[]; total: number }>("/api/communities"),
    diagnosisParam
      ? serverApiFetch<Diagnosis>(`/api/diagnoses/${diagnosisParam}`)
      : Promise.resolve(null),
  ]);

  const communities = communitiesData?.items ?? [];
  // Only communities the farmer has joined — posting into a group you have not
  // joined would be surprising.
  const joined = communities.filter((c) => c.is_member);

  const diagnosisSummary = diagnosis
    ? `${diagnosis.crop_type} — ${diagnosis.predicted_disease.replace(
        `${diagnosis.crop_type} - `,
        "",
      )} (${Math.min(99, Math.floor(diagnosis.confidence_score * 100))}%)`
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href={diagnosis ? `/diagnosis/${diagnosis.id}` : "/community"}
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        {diagnosis ? "Back to your result" : "All communities"}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Write a post</h1>
        <p className="text-muted text-base">
          Ask other farmers what they think. Plain language is fine — describe what you
          can see.
        </p>
      </header>

      <PostForm
        communities={joined}
        initialCommunityId={communityParam}
        diagnosisId={diagnosis?.id}
        diagnosisSummary={diagnosisSummary}
      />
    </div>
  );
}
