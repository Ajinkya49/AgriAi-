import { LogOut, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsForm } from "@/components/settings/settings-form";
import { signOutAction } from "@/lib/auth/actions";
import { getCurrentUser, getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings — Agri AI" };

const ROLE_LABEL: Record<string, string> = {
  farmer: "Farmer",
  moderator: "Moderator",
  admin: "Administrator",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/settings");

  const profile = await getProfile();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted text-base">
          Your details and how you appear to other farmers.
        </p>
      </header>

      <section className="rounded-card glass shadow-card flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted text-sm">Signed in as</span>
          <span className="truncate text-base font-semibold">
            {profile?.email ?? user.email}
          </span>
        </div>
        <div className="border-border flex items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted flex items-center gap-1.5 text-sm">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Account type
          </span>
          <span className="text-base font-semibold">
            {ROLE_LABEL[profile?.role ?? "farmer"] ?? "Farmer"}
          </span>
        </div>
      </section>

      <SettingsForm
        name={profile?.name?.trim() ?? ""}
        region={profile?.region ?? null}
        primaryCrops={profile?.primary_crops ?? []}
      />

      <section className="rounded-card glass flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Account</h2>
        <p className="text-muted text-base">
          Signing out keeps your crop records, diagnoses and posts — you can sign back in
          at any time.
        </p>
        <form action={signOutAction}>
          <button
            type="submit"
            className="border-border text-muted min-h-tap rounded-card flex items-center justify-center gap-2 border px-5 font-semibold"
          >
            <LogOut className="size-5" aria-hidden="true" />
            Log out
          </button>
        </form>
      </section>
    </div>
  );
}
