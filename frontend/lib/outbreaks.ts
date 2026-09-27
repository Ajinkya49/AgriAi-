import { createClient } from "@/lib/supabase/server";

/**
 * Regional outbreak signals.
 *
 * Read through `public.regional_outbreaks()`, a SECURITY DEFINER function that
 * returns **aggregates only** for the caller's own region — never individual
 * rows. That function is where the privacy boundary lives; see its migration
 * (`supabase/migrations/20260922000001_regional_outbreaks.sql`) for the
 * k-anonymity floor and the region scoping.
 *
 * Why this is a direct Supabase call rather than a FastAPI route, unlike
 * diagnosis: it is a read of the caller's own data with no server-side logic to
 * apply, which is the same shape as the dashboard's existing `diagnoses` query.
 * Routing it through the backend would add a network hop and make a dashboard
 * banner depend on the API being warm (its cold start is ~8.5 s, since the model
 * and FAISS index load at boot). The aggregate belongs in SQL; the presentation
 * belongs here.
 */

export type Outbreak = {
  region: string;
  crop_type: string;
  predicted_disease: string;
  display_disease: string;
  farmer_count: number;
  report_count: number;
  last_reported_at: string;
};

/** How far back an alert looks. Matches the SQL default. */
export const OUTBREAK_WINDOW_DAYS = 14;

/**
 * Outbreaks near the caller, most-reported first. Empty when there is nothing
 * to report, when the caller has no region set, or when the query fails.
 *
 * Never throws. An outbreak alert is supplementary information — a farmer must
 * still be able to check a crop and read their history if this query is slow,
 * errors, or the function is missing on an older database. A failed alert
 * degrades to no alert, which is the correct failure for a banner.
 */
export async function getRegionalOutbreaks(
  days: number = OUTBREAK_WINDOW_DAYS,
): Promise<Outbreak[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("regional_outbreaks", {
      p_days: days,
      // Sent explicitly so the intent is visible at the call site. The function
      // clamps this to a floor of 3 regardless, so this cannot lower the
      // k-anonymity guarantee.
      p_min_reports: 3,
    });

    if (error || !data) return [];
    return data as Outbreak[];
  } catch {
    return [];
  }
}

/**
 * "today" / "yesterday" / "3 days ago" — for a farmer, "3 days ago" is more
 * immediately meaningful than a date, because what matters is whether the
 * outbreak is still active.
 */
export function relativeDays(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
}
