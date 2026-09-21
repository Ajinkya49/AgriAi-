import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Backend client for Server Components.
 *
 * The access token comes from the request's Supabase session cookie, so the
 * backend still sees the farmer's own identity and RLS still applies.
 *
 * Returns `null` on any failure so callers can render a not-found / error state
 * instead of a stack trace.
 */
export async function serverApiFetch<T>(path: string): Promise<T | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return null;

  try {
    const response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      // Diagnosis results are per-user and must never be cached across sessions.
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
