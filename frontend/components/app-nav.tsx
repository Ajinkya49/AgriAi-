"use client";

import {
  Camera,
  LayoutDashboard,
  Leaf,
  MessageCircle,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Primary navigation.
 *
 * Mobile: fixed bottom tab bar. Desktop (>=1024px): left sidebar with the same
 * five sections. Per the UI/UX brief every icon is paired with a text label —
 * never icon-only navigation — because the audience has varying digital
 * literacy.
 *
 * NOTE on ordering: the App Flow lists the tabs as "Dashboard, Upload (center,
 * prominent), Assistant, Community, Profile". Five tabs have no second-position
 * centre, so Upload sits in the actual centre (position 3) to honour the
 * "center, prominent" instruction. See supabase/../DECISIONS or the Phase 3
 * summary.
 *
 * Visual treatment: the bottom bar is a floating, blurred glass panel that does
 * not quite touch the screen edges, and the active tab gets a violet glow. This
 * matches the reference recording while keeping the bar legible over content.
 */
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  prominent?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/upload", label: "Upload", icon: Camera, prominent: true },
  { href: "/community", label: "Community", icon: Users },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* ---- Desktop sidebar ---- */}
      <aside className="border-border hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:px-3 lg:py-5">
        <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-3">
          <span className="from-primary-dark to-primary shadow-glow flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br">
            <Leaf className="size-4.5 text-white" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            Agri<span className="text-primary"> AI</span>
          </span>
        </Link>

        {NAV_ITEMS.map(({ href, label, icon: Icon, prominent }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "min-h-tap flex items-center gap-3 rounded-2xl px-3 font-medium transition-colors",
                active
                  ? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_rgba(46,125,50,0.18)]"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
                prominent && "font-semibold",
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </aside>

      {/* ---- Mobile bottom tab bar ----
          Floats above the content with a margin, so it reads as a panel rather
          than a hard edge. The safe-area inset keeps it clear of the home
          indicator on notched phones. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <ul className="glass-nav mx-auto flex max-w-lg items-stretch rounded-3xl p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]">
          {NAV_ITEMS.map(({ href, label, icon: Icon, prominent }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="min-h-tap flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-colors"
                >
                  {prominent ? (
                    <span
                      className={cn(
                        "from-primary-dark to-primary flex size-10 items-center justify-center rounded-full bg-gradient-to-br transition-shadow",
                        active && "shadow-glow",
                      )}
                    >
                      <Icon className="size-5 text-white" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="relative flex items-center justify-center">
                      {active && (
                        <span
                          aria-hidden="true"
                          className="bg-primary/25 absolute -inset-1.5 rounded-full blur-md"
                        />
                      )}
                      <Icon
                        className={cn(
                          "relative size-6 transition-colors",
                          active ? "text-primary" : "text-muted",
                        )}
                        aria-hidden="true"
                      />
                    </span>
                  )}
                  <span
                    className={cn(
                      // Tab labels sit below the 16px body-text minimum on purpose:
                      // five tabs across a 390px screen leave ~78px each, and
                      // "Community" at 16px would not fit. 12px with the icon above
                      // it is the largest that works, and the tap target stays 44px.
                      "text-xs leading-tight transition-colors",
                      active ? "text-primary font-semibold" : "text-muted",
                    )}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
