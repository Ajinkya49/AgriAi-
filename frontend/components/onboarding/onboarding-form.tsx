"use client";

import { AlertCircle, Check, Loader2, MapPin, Sprout } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { saveOnboardingAction, type AuthState } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import {
  CROP_OPTIONS_ORDERED,
  INDIAN_STATES,
  isDiagnosableCrop,
} from "@/lib/validation/auth";

const INITIAL_STATE: AuthState = {};

/**
 * Onboarding: region + primary crops. Both optional and skippable, per the App
 * Flow ("optional, skippable").
 *
 * Saving writes to the caller's own `public.users` row. RLS
 * (`users_update_own_or_admin`) is what makes that safe.
 */
export function OnboardingForm({
  defaultRegion,
  defaultCrops,
}: {
  defaultRegion?: string | null;
  defaultCrops?: string[] | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveOnboardingAction,
    INITIAL_STATE,
  );
  const selected = new Set(defaultCrops ?? []);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}

      {/* ---- Region ---- */}
      <section className="rounded-card glass shadow-card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <MapPin className="text-primary size-5 shrink-0" aria-hidden="true" />
          <h2 className="font-semibold">Which region are you farming in?</h2>
        </div>
        <p className="text-muted text-sm">
          We use this to show solutions that suit your area. You can change it later.
        </p>
        <label htmlFor="region" className="sr-only">
          Region
        </label>
        <select
          id="region"
          name="region"
          defaultValue={defaultRegion ?? ""}
          className="input"
        >
          <option value="">Prefer not to say</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </section>

      {/* ---- Crops ---- */}
      <section className="rounded-card glass shadow-card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <Sprout className="text-primary size-5 shrink-0" aria-hidden="true" />
          <h2 className="font-semibold">Which crops do you grow?</h2>
        </div>
        <p className="text-muted text-sm">
          Choose as many as you like. Crops with a ✓ can be checked by photo today.
        </p>

        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Primary crops</legend>
          {CROP_OPTIONS_ORDERED.map((crop) => {
            const supported = isDiagnosableCrop(crop);
            return (
              <label
                key={crop}
                className={cn(
                  "min-h-tap rounded-card border-border bg-surface inline-flex cursor-pointer items-center gap-1.5 border px-4 text-base",
                  "has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:checked]:font-semibold",
                )}
              >
                <input
                  type="checkbox"
                  name="primary_crops"
                  value={crop}
                  defaultChecked={selected.has(crop)}
                  className="sr-only"
                />
                {supported && (
                  <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                )}
                {crop}
                {/* Screen-reader equivalent of the tick. Visually the tick plus
                    the hint above carries it; a bare tick would be unlabelled
                    for assistive tech and invisible to anyone who misses the
                    hint line. */}
                {supported && <span className="sr-only"> — photo check available</span>}
              </label>
            );
          })}
        </fieldset>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={pending}
          className="min-h-tap rounded-card bg-accent inline-flex flex-1 items-center justify-center gap-2 px-6 font-semibold text-white"
        >
          {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
          {pending ? "Saving…" : "Save and continue"}
        </button>

        <Link
          href="/dashboard"
          className="min-h-tap rounded-card glass inline-flex flex-1 items-center justify-center px-6 font-semibold"
        >
          Skip for now
        </Link>
      </div>
    </form>
  );
}
