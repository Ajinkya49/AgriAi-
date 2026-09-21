"use client";

import { Heart, MessageCircle, Sprout, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { likePost, unlikePost, type Post } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

/**
 * A community post card.
 *
 * Likes update optimistically and roll back on failure — a farmer tapping a heart
 * should not wait on a round trip, but a like that did not save must not be shown
 * as saved.
 */
export function PostCard({
  post,
  href,
  showCommunity = false,
}: {
  post: Post;
  href?: string;
  showCommunity?: boolean;
}) {
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.like_count);
  const [busy, setBusy] = useState(false);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));

    try {
      const result = next ? await likePost(post.id) : await unlikePost(post.id);
      setLiked(result.liked);
      setLikes(result.like_count);
    } catch {
      // Roll back to the server's truth as we last knew it.
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  const authorName = post.author?.name ?? "A farmer";
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="bg-primary-soft flex size-8 shrink-0 items-center justify-center rounded-full">
          <Sprout className="text-primary size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{authorName}</span>
          <span className="text-muted text-sm">
            {timeAgo(post.created_at)}
            {showCommunity && post.community_name ? ` · ${post.community_name}` : ""}
          </span>
        </div>
      </div>

      <p className="text-base whitespace-pre-wrap">{post.content}</p>

      {post.diagnosis_summary && (
        <span className="bg-natural-bg text-natural-text inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
          <Stethoscope className="size-3.5" aria-hidden="true" />
          {post.diagnosis_summary}
        </span>
      )}
    </>
  );

  return (
    <article
      data-testid="post-card"
      className="rounded-card glass shadow-card flex flex-col gap-3 p-4"
    >
      {href ? (
        <Link href={href} className="flex flex-col gap-3">
          {body}
        </Link>
      ) : (
        body
      )}

      <div className="border-border flex items-center gap-4 border-t pt-3">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          aria-label={liked ? "Remove your like" : "Like this post"}
          data-testid="like-button"
          className={cn(
            "min-h-tap flex items-center gap-1.5 text-base font-semibold",
            liked ? "text-like" : "text-muted",
          )}
        >
          <Heart className={cn("size-5", liked && "fill-current")} aria-hidden="true" />
          {likes}
        </button>

        {href ? (
          <Link
            href={href}
            className="text-muted min-h-tap flex items-center gap-1.5 text-base font-semibold"
          >
            <MessageCircle className="size-5" aria-hidden="true" />
            {post.comment_count}
          </Link>
        ) : (
          <span className="text-muted min-h-tap flex items-center gap-1.5 text-base font-semibold">
            <MessageCircle className="size-5" aria-hidden="true" />
            {post.comment_count}
          </span>
        )}
      </div>
    </article>
  );
}
