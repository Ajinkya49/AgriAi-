import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Session refresh + route protection, executed by `proxy.ts` on every request.
 *
 * Two jobs:
 *  1. Refresh the Supabase auth cookie so an expired access token is rotated
 *     before Server Components read it. Without this, sessions silently die
 *     mid-visit.
 *  2. Redirect unauthenticated users away from protected routes, preserving the
 *     original path in `?redirect=` (per the App Flow "Redirect Logic" table).
 */

/** Routes that require a signed-in user. Prefix match, so `/community/abc` counts. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/upload",
  "/assistant",
  "/community",
  "/post",
  "/profile",
  "/settings",
  "/onboarding",
] as const;

/** Routes a signed-in user should not see (they get bounced to the dashboard). */
const AUTH_ROUTES = ["/login", "/signup"] as const;

function isUnder(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // If Supabase is not configured yet, skip auth entirely rather than crashing
  // every route. The UI surfaces a "not configured" state instead.
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() rather than getSession(). getSession() trusts whatever
  // is in the cookie; getUser() validates the JWT against the auth server, which
  // is what makes this a real access check rather than a cosmetic one.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isUnder(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirect", pathname + search);
    return NextResponse.redirect(url);
  }

  if (user && isUnder(pathname, AUTH_ROUTES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
