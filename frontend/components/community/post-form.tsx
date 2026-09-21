"use client";

import { AlertCircle, Loader2, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, createPost, type Community } from "@/lib/api";

/**
 * Create-a-post form. Per the App Flow this is `/post/new`, optionally carrying
 * a diagnosis or an image.
 *
 * Reached two ways: from a community feed (community preselected) and from a
 * diagnosis result via "Share with community" (diagnosis preselected).
 */
export function PostForm({
  communities,
  initialCommunityId,
  diagnosisId,
  diagnosisSummary,
}: {
  communities: Community[];
  initialCommunityId?: string;
  diagnosisId?: string;
  diagnosisSummary?: string;
}) {
  const router = useRouter();
  const [communityId, setCommunityId] = useState(
    initialCommunityId ?? communities[0]?.id ?? "",
  );
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = Boolean(communityId) && content.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const post = await createPost({
        communityId,
        content: content.trim(),
        diagnosisId,
      });
      router.push(`/community/${communityId}/post/${post.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't publish your post. Please try again.",
      );
      setBusy(false);
    }
  }

  if (communities.length === 0) {
    return (
      <p className="text-muted rounded-card glass p-5 text-base">
        You need to join a community before you can post.{" "}
        <Link href="/community" className="text-primary font-semibold underline">
          Find one here.
        </Link>
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Post to</span>
        <select
          value={communityId}
          onChange={(event) => setCommunityId(event.target.value)}
          className="input"
        >
          {communities.map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>
      </label>

      {diagnosisSummary && (
        <p className="bg-natural-bg text-natural-text rounded-card flex items-start gap-2 p-3 text-base">
          <Stethoscope className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>
            Attaching your result: <strong>{diagnosisSummary}</strong>
          </span>
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your question or update</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={2000}
          rows={5}
          required
          placeholder="Describe what you are seeing, and ask what you need to know…"
          className="input"
        />
      </label>

      <button
        type="submit"
        disabled={!valid || busy}
        className="bg-accent min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        Publish post
      </button>
    </form>
  );
}
