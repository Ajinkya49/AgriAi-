"use client";

import { AlertCircle, Check, CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { saveSettingsAction, type AuthState } from "@/lib/auth/actions";
import {
  CROP_OPTIONS_ORDERED,
  INDIAN_STATES,
  isDiagnosableCrop,
} from "@/lib/validation/auth";

/**
 * Account settings form.
 *
 * Mirrors the onboarding fields plus the display name, because the name is what
 * other farmers see on a post — it is not decorative.
 */
export function SettingsForm({
  name,
  region,
  primaryCrops,
}: {
  name: string;
  region: string | null;
  primaryCrops: string[];
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    saveSettingsAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}

      {state.notice && (
        <p
          role="status"
          className="bg-primary-soft text-primary rounded-card flex items-start gap-2 p-3 text-base"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{state.notice}</span>
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your name</span>
        <span className="text-muted text-sm">
          This is the name other farmers see when you post in a community.
        </span>
        <input
          name="name"
          defaultValue={name}
          required
          minLength={2}
          maxLength={80}
          className="input"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your state or region</span>
        <span className="text-muted text-sm">
          Used to suggest guidance suited to your area.
        </span>
        <select name="region" defaultValue={region ?? ""} className="input">
          <option value="">Prefer not to say</option>
          {INDIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Crops you grow</legend>
        <p className="text-muted text-sm">
          Pick up to 12. Crops with a ✓ can be checked by photo today.
        </p>
        <div className="flex flex-wrap gap-2">
          {CROP_OPTIONS_ORDERED.map((crop) => {
            const supported = isDiagnosableCrop(crop);
            return (
              <label
                key={crop}
                className="glass has-checked:border-primary has-checked:bg-primary-soft min-h-tap rounded-card flex cursor-pointer items-center gap-2 px-3"
              >
                <input
                  type="checkbox"
                  name="primary_crops"
                  value={crop}
                  defaultChecked={primaryCrops.includes(crop)}
                  // Colour comes from the global `input[type=checkbox]` rule, which
                  // pins the browser accent to the brand green. It was set to
                  // `accent-confidence-high` — the confidence-band green, which is
                  // semantically wrong here and clashed with the highlight on its
                  // own label.
                  className="size-5"
                />
                <span className="text-base">{crop}</span>
                {supported && (
                  <>
                    <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only"> — photo check available</span>
                  </>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent min-h-tap rounded-card flex items-center justify-center gap-2 font-semibold text-white disabled:opacity-60"
      >
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        Save changes
      </button>
    </form>
  );
}
