import { Lightbulb } from "lucide-react";
import type { Metadata } from "next";

import { UploadForm } from "@/components/diagnosis/upload-form";

export const metadata: Metadata = { title: "Check a crop — Agri AI" };

const PHOTO_TIPS = [
  "Fill the frame with one affected leaf",
  "Use daylight — avoid flash and deep shade",
  "Hold steady so the photo is sharp",
  "Photograph the damaged area, not the whole field",
];

export default function UploadPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Check a crop</h1>
        <p className="text-muted text-base">
          Take a photo of the affected leaf and we&apos;ll tell you what it might be, with
          a confidence score.
        </p>
      </header>

      <section className="rounded-card glass shadow-card flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="text-primary size-5 shrink-0" aria-hidden="true" />
          <h2 className="font-semibold">For a better result</h2>
        </div>
        <ul className="text-muted flex list-disc flex-col gap-1 pl-6 text-base">
          {PHOTO_TIPS.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>

      <UploadForm />
    </div>
  );
}
