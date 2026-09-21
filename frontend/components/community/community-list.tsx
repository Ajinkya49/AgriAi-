"use client";

import { Check, Loader2, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { joinCommunity, leaveCommunity, type Community } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Community discovery list.
 *
 * Per the App Flow this shows joined and suggested communities together, with
 * membership marked. Joining is optimistic — the button flips immediately and
 * rolls back if the write fails.
 */
export function CommunityList({ communities }: { communities: Community[] }) {
  const [state, setState] = useState<Community[]>(communities);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleMembership(community: Community) {
    if (busyId) return;
    setBusyId(community.id);

    const joining = !community.is_member;
    setState((prev) =>
      prev.map((c) =>
        c.id === community.id
          ? {
              ...c,
              is_member: joining,
              member_count: Math.max(0, c.member_count + (joining ? 1 : -1)),
            }
          : c,
      ),
    );

    try {
      const result = joining
        ? await joinCommunity(community.id)
        : await leaveCommunity(community.id);
      setState((prev) =>
        prev.map((c) =>
          c.id === community.id
            ? { ...c, is_member: result.is_member, member_count: result.member_count }
            : c,
        ),
      );
    } catch {
      setState((prev) =>
        prev.map((c) =>
          c.id === community.id
            ? {
                ...c,
                is_member: community.is_member,
                member_count: community.member_count,
              }
            : c,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/community/new"
        className="border-primary text-primary min-h-tap rounded-card flex items-center justify-center gap-2 border-2 border-dashed font-semibold"
      >
        <Plus className="size-5" aria-hidden="true" />
        Start a new community
      </Link>

      {state.length === 0 ? (
        <p className="text-muted rounded-card glass p-5 text-base">
          No communities yet. Be the first to start one for your crop or your district.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.map((community) => (
            <li
              key={community.id}
              data-testid="community-card"
              className="rounded-card glass shadow-card flex flex-col gap-3 p-4"
            >
              <Link href={`/community/${community.id}`} className="flex flex-col gap-1">
                <span className="font-semibold">{community.name}</span>
                {community.description && (
                  <span className="text-muted text-base">{community.description}</span>
                )}
              </Link>

              <div className="flex items-center justify-between gap-3">
                <span className="text-muted flex items-center gap-1.5 text-sm">
                  <Users className="size-4" aria-hidden="true" />
                  {community.member_count} member{community.member_count === 1 ? "" : "s"}{" "}
                  · {community.post_count} post{community.post_count === 1 ? "" : "s"}
                </span>

                <button
                  type="button"
                  onClick={() => toggleMembership(community)}
                  disabled={busyId === community.id}
                  aria-pressed={community.is_member}
                  data-testid="join-button"
                  className={cn(
                    "min-h-tap rounded-card flex items-center gap-1.5 px-4 font-semibold",
                    community.is_member ? "glass text-muted" : "bg-accent text-white",
                  )}
                >
                  {busyId === community.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : community.is_member ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : null}
                  {community.is_member ? "Joined" : "Join"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
