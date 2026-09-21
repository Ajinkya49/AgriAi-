import { Leaf } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getCurrentUser, getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Welcome — Agri AI" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/onboarding");

  const profile = await getProfile();

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <Leaf className="text-primary size-8" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome{profile?.name ? `, ${profile.name.split(/\s+/)[0]}` : ""}
        </h1>
        <p className="text-muted text-base">
          Two quick questions so the advice you get fits your farm. Both are optional —
          you can skip and set them later from your profile.
        </p>
      </header>

      <OnboardingForm
        defaultRegion={profile?.region}
        defaultCrops={profile?.primary_crops}
      />
    </div>
  );
}
