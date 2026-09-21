import { Leaf } from "lucide-react";
import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";

/**
 * Public footer.
 *
 * Carries the project's honesty statement — predictions always ship with a
 * confidence score and never claim certainty — because that is a product
 * commitment, not fine print, and the footer is where a sceptical visitor looks
 * for it.
 */
const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#features", label: "Features" },
      { href: "#solutions", label: "Solutions" },
      { href: "/assistant", label: "Ask the assistant" },
    ],
  },
  {
    heading: "Community",
    links: [
      { href: "#community", label: "Farmer community" },
      { href: "/community", label: "Browse discussions" },
      { href: "/signup", label: "Create an account" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { href: "#solutions", label: "Sourced guidance" },
      { href: "#safety", label: "Safety & limits" },
      { href: "/settings", label: "Your settings" },
    ],
  },
];

export function SiteFooter() {
  return (
    // No top margin: the section above (the closing CTA) already ends with
    // generous bottom padding, and adding to it left ~200px of dead space.
    <footer className="border-border relative border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-4">
          <Link href="/" className="min-h-tap flex w-fit items-center gap-2">
            <span className="from-primary-dark to-primary flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br">
              <Leaf className="size-4.5 text-white" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Agri<span className="text-primary"> AI</span>
            </span>
          </Link>
          <p className="text-muted max-w-xs text-sm">
            Crop disease detection and trusted solutions, for farmers.
          </p>
          {/* Development-only: confirms the browser can reach the API. */}
          {process.env.NODE_ENV === "development" && (
            <p className="text-muted/70 text-xs">
              API{" "}
              {isSupabaseConfigured
                ? "· Supabase configured"
                : "· Supabase not configured"}
            </p>
          )}
        </div>

        {COLUMNS.map((column) => (
          <div key={column.heading} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold tracking-[0.16em] uppercase">
              {column.heading}
            </h3>
            <ul className="flex flex-col gap-1">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-muted hover:text-ink min-h-tap min-w-tap inline-flex items-center text-sm transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-border border-t">
        <div className="text-muted mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            Agri AI — disease detection and conversational guidance are separate systems
            by design.
          </p>
          <p>Predictions always carry a confidence score and never claim certainty.</p>
        </div>
      </div>
    </footer>
  );
}
