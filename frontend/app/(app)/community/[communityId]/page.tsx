import { ArrowLeft, PenSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommunityJoinButton } from "@/components/community/community-join-button";
import { PostCard } from "@/components/community/post-card";
import type { Community, Post } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ communityId: string }>;
}): Promise<Metadata> {
  const { communityId } = await params;
  const community = await serverApiFetch<Community>(`/api/communities/${communityId}`);
  return { title: community ? `${community.name} — Agri AI` : "Community — Agri AI" };
}

export default async function CommunityFeedPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const [community, feed] = await Promise.all([
    serverApiFetch<Community>(`/api/communities/${communityId}`),
    serverApiFetch<{ items: Post[]; total: number }>(
      `/api/communities/${communityId}/posts`,
    ),
  ]);

  if (!community) notFound();
  const posts = feed?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href="/community"
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        All communities
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{community.name}</h1>
          {community.description && (
            <p className="text-muted text-base">{community.description}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <CommunityJoinButton
            communityId={community.id}
            initialMember={community.is_member}
            initialCount={community.member_count}
          />
          <span className="text-muted text-sm">
            {community.post_count} post{community.post_count === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <Link
        href={`/post/new?community=${community.id}`}
        className="bg-accent min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold text-white"
      >
        <PenSquare className="size-5" aria-hidden="true" />
        Write a post
      </Link>

      {posts.length === 0 ? (
        <p className="text-muted rounded-card glass p-5 text-base">
          Be the first to post in this community.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} href={`/community/${community.id}/post/${post.id}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
