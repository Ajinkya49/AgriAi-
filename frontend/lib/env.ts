import { z } from "zod";

/**
 * Environment contract for the frontend, validated with Zod (per the TRD).
 *
 * Only `NEXT_PUBLIC_*` variables are readable in the browser. The
 * service-role key is deliberately absent here — it must only ever live in the
 * backend environment.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:8000"),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});

if (!parsed.success) {
  // Surfaced as a warning rather than a thrown error: Phase 1 has no real
  // Supabase project attached yet, and a hard crash would block local startup.
  console.warn(
    "[Agri AI] Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
}

export const env = parsed.success
  ? parsed.data
  : {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000",
    };

/**
 * True when enough configuration exists to open a Supabase connection.
 * The UI uses this to show a clear "not configured yet" state instead of
 * failing with a cryptic network error.
 */
export const isSupabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
