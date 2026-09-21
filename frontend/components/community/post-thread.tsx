"use client";

import { useState } from "react";

import { CommentSection } from "@/components/community/comment-section";
import { PostCard } from "@/components/community/post-card";
import type { PostDetail } from "@/lib/api";

/**
 * A post and its replies, as one unit.
 *
 * This is a client component purely so the reply count on the post card stays in
 * step with the list below it. Without it the card — which is server-rendered —
 * keeps showing the count from page load, so a farmer who has just replied sees
 * "0" next to "1 reply".
 */
export function PostThread({ post }: { post: PostDetail }) {
  const [commentCount, setCommentCount] = useState(post.comment_count);

  return (
    <div className="flex flex-col gap-5">
      <PostCard post={{ ...post, comment_count: commentCount }} />
      <CommentSection
        postId={post.id}
        initialComments={post.comments}
        onCountChange={setCommentCount}
      />
    </div>
  );
}
