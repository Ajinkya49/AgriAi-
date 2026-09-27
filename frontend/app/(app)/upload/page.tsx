import { Info, Lightbulb } from "lucide-react";
import type { Metadata } from "next";

import { UploadForm } from "@/components/diagnosis/upload-form";
import { DIAGNOSABLE_CROPS } from "@/lib/validation/auth";

export const metadata: Metadata = { title: "Check a crop — Agri AI" };

const PHOTO_TIPS = [
  "Fill the frame with one affected leaf",
  "Use daylight — avoid flash and deep shade",
  "Hold steady so the photo is sharp",
  "Photograph the damaged area, not the whole field",
];

export default function UploadPage() {
  // Rendered from the same constant the picker uses, so the farmer is told the
  // model's real scope before spending a photo. The classifier has a fixed
  // output layer and cannot answer "not one of mine" — it would return its
  // best-fitting trained class and look confident — so saying so up front is
  // the honest option, not a disclaimer bolted on afterwards.
  const supported = DIAGNOSABLE_CROPS.join(", ");
  const supportedLabel =
    DIAGNOSABLE_CROPS.length > 1
      ? `${DIAGNOSABLE_CROPS.slice(0, -1).join(", ")} and ${DIAGNOSABLE_CROPS.at(-1)}`
      : supported;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Check a crop</h1>
        <p className="text-muted text-base">
          Take a photo of the affected leaf and we&apos;ll tell you what it might be, with
          a confidence score.
        </p>
      </header>

      <section className="rounded-card border-primary-soft bg-primary-soft/40 flex flex-col gap-2 border p-4">
        <div className="flex items-center gap-2">
          <Info className="text-primary size-5 shrink-0" aria-hidden="true" />
          <h2 className="font-semibold">Works with {supportedLabel} today</h2>
        </div>
        <p className="text-base">
          Photo checking currently covers <strong>{supported}</strong> —{" "}
          {DIAGNOSABLE_CROPS.length} of the crops you can add to your profile. More are
          coming.
        </p>
        <p className="text-muted text-sm">
          If you check a different crop, the result will not be reliable. For anything
          else, ask the assistant instead — it can help with any crop you grow.
        </p>
      </section>

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
