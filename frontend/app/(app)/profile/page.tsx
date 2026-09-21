import { LogOut, MapPin, Pencil, ShieldCheck, Sprout } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOutAction } from "@/lib/auth/actions";
import { getCurrentUser, getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Profile — Agri AI" };

const ROLE_LABEL: Record<string, string> = {
  farmer: "Farmer",
  moderator: "Moderator",
  admin: "Administrator",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/profile");

  const profile = await getProfile();
  const name = profile?.name?.trim() || "Farmer";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>

      <section className="rounded-card glass shadow-card flex items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="bg-primary-soft text-primary flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-bold"
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-lg font-semibold">{name}</span>
          <span className="text-muted truncate text-base">
            {profile?.email ?? user.email}
          </span>
        </div>
      </section>

      <section className="rounded-card glass shadow-card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Your details</h2>

        <DetailRow icon={MapPin} label="Region" value={profile?.region ?? "Not set"} />
        <DetailRow
          icon={Sprout}
          label="Primary crops"
          value={
            profile?.primary_crops?.length ? profile.primary_crops.join(", ") : "Not set"
          }
        />
        <DetailRow
          icon={ShieldCheck}
          label="Account type"
          value={ROLE_LABEL[profile?.role ?? "farmer"] ?? "Farmer"}
        />

        <Link
          href="/settings"
          className="min-h-tap rounded-card border-border mt-1 inline-flex items-center justify-center gap-2 border px-5 font-semibold"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Update your details
        </Link>
      </section>

      <section className="rounded-card glass shadow-card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Your activity</h2>
        <p className="text-muted text-base">
          Past uploads and the communities you have joined will appear here once those
          features are built.
        </p>
      </section>

      <form action={signOutAction}>
        <button
          type="submit"
          className="min-h-tap rounded-card glass text-danger inline-flex w-full items-center justify-center gap-2 px-5 font-semibold sm:w-auto"
        >
          <LogOut className="size-5" aria-hidden="true" />
          Log out
        </button>
      </form>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border flex items-start gap-3 border-b pb-3 last:border-b-0 last:pb-0">
      <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex flex-col">
        <span className="text-muted text-sm">{label}</span>
        <span className="text-base">{value}</span>
      </div>
    </div>
  );
}
