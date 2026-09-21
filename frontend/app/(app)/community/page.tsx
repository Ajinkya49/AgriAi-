import type { Metadata } from "next";

import { CommunityList } from "@/components/community/community-list";
import type { Community } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Community — Agri AI" };

export default async function CommunityPage() {
  const data = await serverApiFetch<{ items: Community[]; total: number }>(
    "/api/communities",
  );
  const communities = data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Farmer community</h1>
        <p className="text-muted text-base">
          Join farmers growing the same crop, ask questions, and help others with what you
          know.
        </p>
      </header>

      <CommunityList communities={communities} />
    </div>
  );
}
