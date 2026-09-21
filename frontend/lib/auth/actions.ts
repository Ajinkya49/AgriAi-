"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  onboardingSchema,
  settingsSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

/**
 * Auth server actions.
 *
 * Everything that touches the session runs on the server so the auth cookies are
 * written by `@supabase/ssr` rather than being handled in browser JS.
 */

export type AuthState = {
  error?: string;
  notice?: string;
};

/**
 * Only allow same-site relative paths as a post-login destination.
 * Blocks open-redirect attempts such as `?redirect=https://evil.example`
 * and protocol-relative `//evil.example`.
 */
function safeRedirect(target: unknown, fallback: string): string {
  const value = typeof target === "string" ? target.trim() : "";
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Where the confirmation email link lands. It must also be listed under
      // Authentication -> URL Configuration -> Redirect URLs in Supabase.
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      // Read by the `on_auth_user_created` trigger to populate users.name.
      data: { name: parsed.data.name },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // With email confirmation enabled (the Supabase default) there is no session
  // yet — the farmer has to confirm first.
  if (!data.session) {
    return {
      notice:
        "Almost there — we've sent a confirmation link to your email. Open it to finish setting up your account.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic: do not reveal whether the email exists.
    return { error: "That email and password combination did not work." };
  }

  const destination = safeRedirect(formData.get("redirect"), "/dashboard");
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function saveOnboardingAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/onboarding");
  }

  const parsed = onboardingSchema.safeParse({
    region: formData.get("region") ?? "",
    primary_crops: formData.getAll("primary_crops").map(String),
  });

  if (!parsed.success) {
    return { error: "Please check your selections and try again." };
  }

  // RLS restricts this to the caller's own row (`users_update_own_or_admin`),
  // so no user_id filter would be needed — but filtering is explicit and cheap.
  const { error } = await supabase
    .from("users")
    .update({
      region: parsed.data.region?.trim() ? parsed.data.region.trim() : null,
      primary_crops: parsed.data.primary_crops ?? [],
    })
    .eq("id", user.id);

  if (error) {
    return { error: "We could not save your details. Please try again." };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Save account settings.
 *
 * Updates `users.name`, `region` and `primary_crops` for the caller's own row.
 * RLS (`users_update_own_or_admin`) is what actually enforces ownership — the
 * explicit `.eq("id", user.id)` is belt-and-braces.
 *
 * The name matters beyond this screen: it is what the community feed shows as an
 * author, resolved through `public.public_profiles()`.
 */
export async function saveSettingsAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const parsed = settingsSchema.safeParse({
    name: formData.get("name") ?? "",
    region: formData.get("region") ?? "",
    primary_crops: formData.getAll("primary_crops").map(String),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }

  const { error } = await supabase
    .from("users")
    .update({
      name: parsed.data.name,
      region: parsed.data.region?.trim() ? parsed.data.region.trim() : null,
      primary_crops: parsed.data.primary_crops ?? [],
    })
    .eq("id", user.id);

  if (error) {
    return { error: "We could not save your details. Please try again." };
  }

  // The name appears on the profile, the dashboard greeting and in every
  // community post, so all three need to re-render.
  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  revalidatePath("/community");

  return { notice: "Your details have been saved." };
}
