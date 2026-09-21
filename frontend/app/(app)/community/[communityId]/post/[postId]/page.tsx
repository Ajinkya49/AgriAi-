import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostThread } from "@/components/community/post-thread";
import type { PostDetail } from "@/lib/api";
import { serverApiFetch } from "@/lib/api-server";

export const metadata: Metadata = { title: "Post — Agri AI" };

export default async function PostPage({
  params,
}: {
  params: Promise<{ communityId: string; postId: string }>;
}) {
  const { communityId, postId } = await params;
  const post = await serverApiFetch<PostDetail>(`/api/posts/${postId}`);

  if (!post) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href={`/community/${communityId}`}
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Back to {post.community_name ?? "the community"}
      </Link>

      {/* The post and its replies render as one unit so the reply count on the
          card stays in step with the list — this *is* the post. */}
      <PostThread post={post} />
    </div>
  );
}
