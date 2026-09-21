import { Leaf } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppNav } from "@/components/app-nav";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Shell for every signed-in route.
 *
 * Defence in depth: `proxy.ts` already redirects unauthenticated visitors, but a
 * Server Component must never render protected content without checking the
 * session itself — middleware can be bypassed by a direct RSC request.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <AppNav />

      <div className="flex flex-1 flex-col">
        {/* Compact header — the sidebar is hidden on mobile, so the app identity
            needs somewhere to live. Sticky and blurred so it stays readable as
            content scrolls beneath it. */}
        <header className="border-border bg-surface/90 sticky top-0 z-30 flex items-center gap-2 border-b px-5 py-3 backdrop-blur-xl lg:hidden">
          <span className="from-primary-dark to-primary shadow-glow flex size-7 items-center justify-center rounded-lg bg-gradient-to-br">
            <Leaf className="size-4 text-white" aria-hidden="true" />
          </span>
          <span className="font-display font-semibold tracking-tight">
            Agri<span className="text-primary"> AI</span>
          </span>
        </header>

        {/* pb-28 clears the floating bottom bar (44px tap target + padding). */}
        <main className="flex flex-1 flex-col pb-[var(--app-nav-height)] lg:pb-0">
          {children}
        </main>

        {/* Content dissolves into the canvas before it reaches the floating tab
            bar, instead of being cut off by it. Sits below the bar (z-40). */}
        <div
          aria-hidden="true"
          className="from-surface pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-t to-transparent lg:hidden"
        />
      </div>
    </div>
  );
}
