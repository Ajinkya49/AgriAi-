"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { joinCommunity, leaveCommunity } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Join / leave control for a single community header. */
export function CommunityJoinButton({
  communityId,
  initialMember,
  initialCount,
}: {
  communityId: string;
  initialMember: boolean;
  initialCount: number;
}) {
  const [isMember, setIsMember] = useState(initialMember);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const joining = !isMember;

    // Optimistic, rolled back on failure.
    setIsMember(joining);
    setCount((n) => Math.max(0, n + (joining ? 1 : -1)));

    try {
      const result = joining
        ? await joinCommunity(communityId)
        : await leaveCommunity(communityId);
      setIsMember(result.is_member);
      setCount(result.member_count);
    } catch {
      setIsMember(!joining);
      setCount((n) => Math.max(0, n + (joining ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted text-sm">
        {count} member{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={isMember}
        data-testid="join-button"
        className={cn(
          "min-h-tap rounded-card flex items-center gap-1.5 px-4 font-semibold",
          isMember ? "glass text-muted" : "bg-accent text-white",
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : isMember ? (
          <Check className="size-4" aria-hidden="true" />
        ) : null}
        {isMember ? "Joined" : "Join"}
      </button>
    </div>
  );
}
