import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-side session helpers.
 *
 * `cache()` dedupes the Supabase round-trip within a single render pass, so a
 * page and its layout can both ask for the profile without two network calls.
 */

export type AppRole = "farmer" | "moderator" | "admin";

export type Profile = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  region: string | null;
  primary_crops: string[] | null;
  role: AppRole;
  created_at: string;
};

/** The signed-in Supabase auth user, or null. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The caller's `public.users` row, or null.
 *
 * Read through the anon-key client, so RLS applies: a user can only ever load
 * their own row (`users_select_own_or_admin`).
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, phone, name, region, primary_crops, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Profile;
});
