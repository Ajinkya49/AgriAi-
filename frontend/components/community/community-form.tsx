"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, createCommunity } from "@/lib/api";

/** Create-a-community form. Per the App Flow this is `/community/new`. */
export function CommunityForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 3;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const community = await createCommunity(name.trim(), description.trim());
      // "After creating a community" the App Flow sends the farmer into it.
      router.push(`/community/${community.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't create that community. Please try again.",
      );
      setBusy(false);
    }
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
        <span className="font-semibold">Community name</span>
        <span className="text-muted text-sm">
          Something other farmers will recognise, like &ldquo;Tomato Farmers&rdquo; or
          &ldquo;Pest &amp; Disease Help&rdquo;.
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
          className="input"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">What is it for? (optional)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={400}
          rows={3}
          className="input"
        />
      </label>

      <button
        type="submit"
        disabled={!valid || busy}
        className="bg-accent min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        Create community
      </button>
    </form>
  );
}
