import type { Metadata } from "next";

import { AssistantChat } from "@/components/assistant/assistant-chat";

export const metadata: Metadata = { title: "Assistant — Agri AI" };

export default function AssistantPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Farming assistant</h1>
        <p className="text-muted text-base">
          Ask about your crop in your own words. Answers come from a reviewed knowledge
          base, and the sources are always shown.
        </p>
      </header>

      <AssistantChat />
    </div>
  );
}
