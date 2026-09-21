import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for the email confirmation link.
 *
 * Supabase can arrive here in two shapes depending on the flow:
 *   * `?code=...`                 — PKCE code exchange (default for @supabase/ssr)
 *   * `?token_hash=...&type=...`  — email OTP verification
 * Both are handled so the link works regardless of the project's email template.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Behind a proxy (Vercel/Render) request.url is the internal address, so
  // prefer the forwarded host when building the redirect target.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(request.url).origin;

  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const supabase = await createClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let failed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
  } else {
    failed = true;
  }

  if (failed) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That confirmation link has expired or was already used. Try logging in, or sign up again.",
      )}`,
    );
  }

  // Straight into onboarding — the App Flow routes new users there after
  // verification.
  return NextResponse.redirect(`${origin}${next}`);
}
