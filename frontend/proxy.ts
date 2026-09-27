import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/session";

/**
 * Next.js 16 request interceptor.
 *
 * NOTE: in Next.js 16 this file convention was renamed from `middleware.ts` to
 * `proxy.ts`, and the exported function from `middleware` to `proxy`. The old
 * names are deprecated. Keep this file at the project root, alongside `app/`.
 *
 * Auth is Supabase Auth end to end. This runs the session refresh and the route
 * table from the App Flow, both implemented in `lib/supabase/session.ts`.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Run on everything except static assets and image optimisation, which never
   * need an auth check. Keeping the matcher tight avoids paying for a Supabase
   * round-trip on every asset request.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
