import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CommunityForm } from "@/components/community/community-form";

export const metadata: Metadata = { title: "New community — Agri AI" };

export default function NewCommunityPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-6">
      <Link
        href="/community"
        className="text-primary inline-flex w-fit items-center gap-2 text-base font-semibold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        All communities
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Start a community</h1>
        <p className="text-muted text-base">
          Communities are grouped by crop or by problem — tomato growers, pest and disease
          help, your district. You will be its first member.
        </p>
      </header>

      <CommunityForm />
    </div>
  );
}
