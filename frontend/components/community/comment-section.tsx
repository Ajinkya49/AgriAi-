"use client";

import { AlertCircle, Loader2, Send, Sprout } from "lucide-react";
import { useState } from "react";

import { ApiError, createComment, type Comment } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

/**
 * Comments on a post, with an inline composer.
 *
 * Per the App Flow the composer expands at the bottom of the post rather than
 * opening a separate page — replying should not cost a navigation.
 */
export function CommentSection({
  postId,
  initialComments,
  onCountChange,
}: {
  postId: string;
  initialComments: Comment[];
  /** Lets the surrounding post card keep its reply count in step. */
  onCountChange?: (count: number) => void;
}) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const content = draft.trim();
    if (!content || busy) return;

    setBusy(true);
    setError(null);

    try {
      const created = await createComment(postId, content);
      setComments((prev) => {
        const next = [...prev, created];
        onCountChange?.(next.length);
        return next;
      });
      setDraft("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't post your reply. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" data-testid="comments">
      <h2 className="text-lg font-semibold">
        {comments.length === 0
          ? "No replies yet"
          : `${comments.length} repl${comments.length === 1 ? "y" : "ies"}`}
      </h2>

      {comments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-testid="comment"
              className="rounded-card glass flex flex-col gap-2 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="bg-natural-bg flex size-7 shrink-0 items-center justify-center rounded-full">
                  <Sprout className="text-natural-text size-3.5" aria-hidden="true" />
                </span>
                <span className="font-semibold">
                  {comment.author?.name ?? "A farmer"}
                  {comment.is_mine && (
                    <span className="text-muted font-normal"> · you</span>
                  )}
                </span>
                <span className="text-muted text-sm">{timeAgo(comment.created_at)}</span>
              </div>
              <p className="text-base whitespace-pre-wrap">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="comment-input">
          Your reply
        </label>
        <textarea
          id="comment-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={1}
          placeholder="Write a reply…"
          disabled={busy}
          className="input max-h-32 flex-1"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Post reply"
          data-testid="reply-button"
          className="bg-accent min-h-tap min-w-tap rounded-card flex items-center justify-center px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-5" aria-hidden="true" />
          )}
        </button>
      </form>
    </section>
  );
}
